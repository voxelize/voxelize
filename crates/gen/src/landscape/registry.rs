//! `KindRegistry`: the factories compile builds a spec's kinds from.
//!
//! Built-in kinds register exactly as a game's kinds do; a spec names a
//! kind by its key and hands it params as JSON. The factory deserializes
//! the params into the kind's typed `Params` (unknown fields refused,
//! errors path-qualified), validates them, builds the kind, and returns the
//! params re-serialized from their typed form, which is what the identity
//! hash covers: an absent `Option` and an explicit `null`, or `1` and
//! `1.0` for an `f64` field, hash alike.
//!
//! It registers surfacers so far; landforms, region solvers, provinces and
//! site sets join with the planner. A kind registers once: a second
//! registration under the same key is a programming error and panics,
//! unless it says it replaces (`replace_surfacer`). (Named apart from
//! `voxelize::Registry`, which appears in the same compile call.)

use std::collections::BTreeMap;

use serde_json::Value;

use super::json;
use super::spec::{SpecError, Validator};
use super::surface::{DynSurfacer, PaintCtx, Surfacer};

type SurfacerFactory =
    fn(Value, &mut PaintCtx<'_>) -> Result<(Box<dyn DynSurfacer>, Value), SpecError>;

struct SurfacerEntry {
    version: u32,
    build: SurfacerFactory,
}

/// The kinds a spec may name.
#[derive(Default)]
pub struct KindRegistry {
    surfacers: BTreeMap<&'static str, SurfacerEntry>,
}

fn build_surfacer<S: Surfacer>(
    params: Value,
    cx: &mut PaintCtx<'_>,
) -> Result<(Box<dyn DynSurfacer>, Value), SpecError> {
    let path = cx.path().to_string();
    let typed: S::Params = json::from_value(params).map_err(|e| SpecError {
        path: if e.at.is_empty() {
            path.clone()
        } else {
            format!("{path}.{}", e.at)
        },
        message: e.message,
    })?;
    let mut v = Validator::new(path.clone());
    super::spec::Validate::validate(&typed, &mut v);
    v.finish()?;
    let canonical = serde_json::to_value(&typed)
        .map_err(|e| SpecError::new(path, format!("params do not serialize: {e}")))?;
    let built = S::build(typed, cx)?;
    Ok((Box::new(built), canonical))
}

impl KindRegistry {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Every built-in kind.
    pub fn with_builtins() -> Self {
        let mut r = Self::new();
        r.surfacer::<super::library::SurfaceRules>()
            .surfacer::<super::library::Ecotones>()
            .surfacer::<super::library::Zones>();
        r
    }

    /// Register surfacer `S` under `S::KIND`.
    ///
    /// # Panics
    ///
    /// When a surfacer is already registered under `S::KIND` (a built-in
    /// or an earlier game kind): replacing one is `replace_surfacer`.
    pub fn surfacer<S: Surfacer>(&mut self) -> &mut Self {
        assert!(
            !self.surfacers.contains_key(S::KIND),
            "surfacer kind {:?} is already registered; use replace_surfacer to replace it on purpose",
            S::KIND
        );
        self.replace_surfacer::<S>()
    }

    /// Register surfacer `S` under `S::KIND`, replacing any earlier kind
    /// with that key (its version stamps identity, so saved worlds see the
    /// change).
    pub fn replace_surfacer<S: Surfacer>(&mut self) -> &mut Self {
        self.surfacers.insert(
            S::KIND,
            SurfacerEntry {
                version: S::VERSION,
                build: build_surfacer::<S>,
            },
        );
        self
    }

    /// The version of a registered surfacer kind.
    pub fn surfacer_version(&self, kind: &str) -> Option<u32> {
        self.surfacers.get(kind).map(|e| e.version)
    }

    pub(crate) fn build_surfacer(
        &self,
        kind_path: &str,
        kind: &str,
        params: Value,
        cx: &mut PaintCtx<'_>,
    ) -> Result<(Box<dyn DynSurfacer>, Value, u32), SpecError> {
        let entry = self.surfacers.get(kind).ok_or_else(|| {
            SpecError::new(
                kind_path,
                format!(
                    "unknown surfacer kind {kind:?} (registered: {})",
                    self.surfacers
                        .keys()
                        .copied()
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
        })?;
        let (s, v) = (entry.build)(params, cx)?;
        Ok((s, v, entry.version))
    }
}
