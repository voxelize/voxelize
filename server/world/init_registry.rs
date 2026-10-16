//! The block registry as the INIT packet carries it: serialized once per
//! server, shared by every world, and named by a digest so a client that
//! already holds it can be told so instead of being sent it again.
//!
//! The registry is fixed when the server is built (`ServerBuilder::registry`)
//! and cloned into every world, so its text never changes for the life of
//! the process. It is also the bulk of INIT by far (megabytes of block
//! definitions against kilobytes of everything else), so a returning client
//! that kept it from an earlier join sends its digest on JOIN, and an INIT
//! answering a matching digest leaves the block definitions out.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use log::info;
use serde_json::value::RawValue;

use super::{Registry, World};

/// INIT key: the digest of the registry text this server sends.
pub const INIT_REGISTRY_DIGEST_KEY: &str = "registryDigest";

/// INIT key, set to `true` when the INIT leaves the block definitions out
/// because the client's JOIN named the same digest.
pub const INIT_REGISTRY_CACHED_KEY: &str = "registryCached";

/// INIT key on a full INIT: the length of the block registry text in UTF-16
/// code units (what a JavaScript string's `length` counts). The INIT JSON
/// always starts with `{"blocks":`, the registry text follows, and the
/// digest key right after it, so a client can cut the exact text out of the
/// INIT string without re-serializing it.
pub const INIT_REGISTRY_LENGTH_KEY: &str = "registryBlocksLength";

/// The block registry exactly as INIT carries it.
pub struct InitRegistry {
    /// `blocks_by_name` as JSON, keys sorted by block name. Sorting makes the
    /// text (and so the digest) the same in every process serving the same
    /// registry: the map's own iteration order is seeded per process.
    pub blocks: Box<RawValue>,

    /// Digest of `blocks`. Stable across processes and restarts for an
    /// unchanged registry; any change to any block changes it.
    pub digest: String,

    /// Length of `blocks` in UTF-16 code units.
    pub utf16_len: usize,
}

impl InitRegistry {
    pub fn new(registry: &Registry) -> Self {
        let sorted: BTreeMap<&String, _> = registry.blocks_by_name.iter().collect();
        let serialized =
            serde_json::to_string(&sorted).expect("the block registry serializes to JSON");
        let digest = registry_digest(serialized.as_bytes());
        let utf16_len = if serialized.is_ascii() {
            serialized.len()
        } else {
            serialized.encode_utf16().count()
        };
        let blocks = RawValue::from_string(serialized).expect("serde_json output is valid JSON");
        Self {
            blocks,
            digest,
            utf16_len,
        }
    }

    /// Whether a JOIN's `registryDigest` names exactly this registry.
    pub fn is_known_by(&self, client_digest: Option<&str>) -> bool {
        client_digest == Some(self.digest.as_str())
    }
}

/// One lazily built [`InitRegistry`], shared by every world of a server
/// (cloning shares it). A world built outside a server keeps its own.
#[derive(Clone, Default)]
pub struct SharedInitRegistry(Arc<Shared>);

#[derive(Default)]
struct Shared {
    text: OnceLock<InitRegistry>,
    /// How long the last INIT of each shape took to encode and how many bytes
    /// it went out at: `[full, cached]`. An INIT's `serverTiming` cannot carry
    /// its own encode, so it carries the previous one of its shape.
    last_encodes: Mutex<[Option<(f64, usize)>; 2]>,
}

impl SharedInitRegistry {
    /// The registry text, serialized on first use from `registry`.
    pub fn get_or_init(&self, world_name: &str, registry: &Registry) -> &InitRegistry {
        self.0.text.get_or_init(|| {
            let started = Instant::now();
            let init_registry = InitRegistry::new(registry);
            info!(
                "[{}] serialized {} block definitions for INIT once ({} bytes, digest {}, {:?}); \
                 every world of this server reuses it",
                world_name,
                registry.blocks_by_name.len(),
                init_registry.blocks.get().len(),
                init_registry.digest,
                started.elapsed()
            );
            init_registry
        })
    }

    /// The registry text, if it has been serialized.
    pub fn get(&self) -> Option<&InitRegistry> {
        self.0.text.get()
    }

    pub fn is_shared_with(&self, other: &SharedInitRegistry) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }

    /// Record an INIT's encode time and wire size, by shape.
    pub(crate) fn record_init_encode(
        &self,
        registry_cached: bool,
        encode_ms: f64,
        wire_bytes: usize,
    ) {
        if let Ok(mut last) = self.0.last_encodes.lock() {
            last[registry_cached as usize] = Some((encode_ms, wire_bytes));
        }
    }

    /// The last recorded INIT encode of this shape, if any.
    pub(crate) fn last_init_encode(&self, registry_cached: bool) -> Option<(f64, usize)> {
        self.0
            .last_encodes
            .lock()
            .ok()
            .and_then(|last| last[registry_cached as usize])
    }
}

impl World {
    /// Serve INIT from `shared`, the server's one copy of the registry text,
    /// instead of this world serializing its own. The server hands every
    /// world it adds the same one, right after inserting its registry.
    pub(crate) fn share_init_registry(&mut self, shared: &SharedInitRegistry) {
        self.init_registry = shared.clone();
    }

    /// The registry text INIT carries, serialized on first use.
    pub(crate) fn init_registry(&self) -> &InitRegistry {
        self.init_registry.get_or_init(&self.name, &self.registry())
    }

    /// The server's shared registry copy this world serves INIT from.
    pub(crate) fn shared_init_registry(&self) -> &SharedInitRegistry {
        &self.init_registry
    }

    #[cfg(test)]
    pub(crate) fn shares_init_registry_with(&self, shared: &SharedInitRegistry) -> bool {
        self.init_registry.is_shared_with(shared)
    }
}

/// A 128-bit content digest (two independent 64-bit multiplicative lanes over
/// the bytes, plus the length). Spelled out instead of borrowed from `std`,
/// whose hashers may change between toolchains: clients keep the digest
/// across server restarts and upgrades, and it must only move when the
/// bytes do.
pub fn registry_digest(bytes: &[u8]) -> String {
    let mut a: u64 = 0xcbf2_9ce4_8422_2325;
    let mut b: u64 = 0x6a09_e667_f3bc_c909;
    for &byte in bytes {
        a = (a ^ byte as u64).wrapping_mul(0x0000_0100_0000_01b3);
        b = (b ^ byte as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    }
    b ^= b >> 31;
    b = b.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    b ^= b >> 29;
    format!("{:016x}{:016x}-{}", a, b, bytes.len())
}

#[cfg(test)]
mod tests {
    use hashbrown::HashMap;

    use super::*;
    use crate::Block;

    fn registry() -> Registry {
        let mut registry = Registry::new();
        registry.register_blocks(&[
            Block::new("Stone").id(1).build(),
            Block::new("Dirt").id(2).build(),
            Block::new("Glass").id(3).is_transparent(true).build(),
            Block::new("Lamp").id(4).torch_light_level(12).build(),
        ]);
        registry.generate();
        registry
    }

    #[test]
    fn the_digest_ignores_the_maps_per_process_order() {
        let first = registry();
        let mut second = first.clone();
        // A fresh map with its own random seed, filled in reverse: the
        // iteration order a different process would see.
        let mut reordered = HashMap::new();
        let mut names: Vec<_> = first.blocks_by_name.keys().cloned().collect();
        names.reverse();
        for name in names {
            let block = first.blocks_by_name[&name].clone();
            reordered.insert(name, block);
        }
        second.blocks_by_name = reordered;

        let a = InitRegistry::new(&first);
        let b = InitRegistry::new(&second);
        assert_eq!(a.blocks.get(), b.blocks.get());
        assert_eq!(a.digest, b.digest);
    }

    #[test]
    fn any_block_change_moves_the_digest() {
        let base = InitRegistry::new(&registry());
        let mut changed = registry();
        changed
            .blocks_by_name
            .get_mut("glass")
            .expect("Glass is registered")
            .is_see_through = true;
        assert_ne!(base.digest, InitRegistry::new(&changed).digest);
    }

    #[test]
    fn the_text_is_the_block_map_sorted_by_name_and_its_utf16_length() {
        let init = InitRegistry::new(&registry());
        let parsed: serde_json::Value = serde_json::from_str(init.blocks.get()).unwrap();
        let names: Vec<_> = parsed.as_object().unwrap().keys().cloned().collect();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted);
        assert!(names.contains(&"stone".to_owned()));
        assert_eq!(init.utf16_len, init.blocks.get().encode_utf16().count());
    }

    #[test]
    fn the_utf16_length_counts_code_units_not_bytes() {
        let mut registry = registry();
        registry.register_blocks(&[Block::new("Café Tile").id(5).build()]);
        let init = InitRegistry::new(&registry);
        assert!(init.utf16_len < init.blocks.get().len());
        assert_eq!(init.utf16_len, init.blocks.get().encode_utf16().count());
    }

    #[test]
    fn the_digest_is_pinned() {
        // Clients persist digests across server upgrades; the algorithm must
        // not drift with the toolchain.
        assert_eq!(registry_digest(b"{\"Air\":{}}"), PINNED_AIR_DIGEST);
        assert_ne!(registry_digest(b"a"), registry_digest(b"b"));
        assert!(registry_digest(b"").ends_with("-0"));
    }

    const PINNED_AIR_DIGEST: &str = "ae7a1f0670ea2eeba01e4c24fe94bb13-10";
}
