//! A landscape's identity, persisted next to its chunks and checked on
//! load.
//!
//! The identity covers everything that decides output: the preset and its
//! content version, the world seed and dimension, `spec_hash` (the
//! canonical writer over the spec with every kind's params replaced by
//! their typed re-serialization), the canonical writer's version, the
//! engine algorithm version, the version of every kind the spec uses, and
//! the resolved role table (role, block name, block id, fluid rules).
//!
//! **Where the file lives.** `<save_dir>/chunks/landscape.identity`: the
//! chunk manager stores chunks in that folder and `Chunks::wipe` deletes
//! every file in it, so a wipe resets chunks and identity together. The
//! extension is not `.json`, so nothing that enumerates chunk files sees
//! it. Drift events go to `landscape.drift.log` in the same folder.
//!
//! **Pristine chunks.** Worlds that do not save pristine chunks (the engine
//! default) regenerate unedited chunks with the current generator, so
//! drift shows only where chunks were saved, as seams. [`DriftPolicy`]
//! decides what a drift verdict does when saved chunks exist; with none
//! saved the file is rewritten silently, because nothing can seam.

use std::fmt;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use voxelize::WorldConfig;

use crate::spec::GenError;

use super::canon;
use super::json;
use super::spec::ContentVersion;

/// Bumped whenever engine arithmetic changes output for an unchanged spec.
pub const ENGINE_ALGO: u32 = 1;

/// The identity file's name inside the chunks folder.
pub const IDENTITY_FILE: &str = "landscape.identity";

/// The drift log's name inside the chunks folder.
pub const DRIFT_LOG: &str = "landscape.drift.log";

/// A kind the spec uses, with its version (and, for landforms, the
/// versions of the provinces it owns).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KindStamp {
    /// Registry key.
    pub kind: String,
    /// Its version.
    pub version: u32,
    /// Owned provinces and their versions.
    pub provinces: Vec<(String, u32)>,
}

/// Everything that decides a landscape's output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandscapeIdentity {
    /// Preset key.
    pub preset: String,
    /// Spec format.
    pub format: u32,
    /// Preset content version.
    pub content_version: ContentVersion,
    /// World seed.
    pub world_seed: u32,
    /// Dimension key.
    pub dimension: String,
    /// Canonical hash of the spec with typed params.
    pub spec_hash: u64,
    /// Canonical writer version.
    pub canon: u32,
    /// Engine algorithm version.
    pub algo: u32,
    /// Every kind the spec uses, sorted.
    pub kinds: Vec<KindStamp>,
    /// Digest of the resolved role table.
    pub roles_digest: u64,
}

/// How a recorded identity compares with the current one, most severe
/// difference first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Compat {
    /// Same output.
    Identical,
    /// The spec or its content version changed.
    ContentDrift,
    /// Engine arithmetic or the canonical writer changed.
    AlgoDrift,
    /// A kind's version changed, or the set of kinds.
    KindDrift,
    /// The resolved role table changed.
    RoleDrift,
    /// The spec format changed.
    FormatDrift,
    /// Another preset.
    DifferentPreset,
    /// Another world seed or dimension.
    DifferentSeed,
    /// No identity (or an unreadable one) next to saved chunks.
    Unknown,
}

impl fmt::Display for Compat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

/// What a drift verdict does when saved chunks exist.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DriftPolicy {
    /// Refuse to start.
    Refuse,
    /// Log the verdict with the saved-chunk count, rewrite, and append to
    /// the drift log.
    Warn,
    /// Rewrite and append silently.
    Allow,
}

impl LandscapeIdentity {
    /// The verdict of `self` (recorded) against `current`.
    pub fn compare(&self, current: &LandscapeIdentity) -> Compat {
        if self.preset != current.preset {
            Compat::DifferentPreset
        } else if self.world_seed != current.world_seed || self.dimension != current.dimension {
            Compat::DifferentSeed
        } else if self.format != current.format {
            Compat::FormatDrift
        } else if self.algo != current.algo || self.canon != current.canon {
            Compat::AlgoDrift
        } else if self.kinds != current.kinds {
            Compat::KindDrift
        } else if self.roles_digest != current.roles_digest {
            Compat::RoleDrift
        } else if self.spec_hash != current.spec_hash
            || self.content_version != current.content_version
        {
            Compat::ContentDrift
        } else {
            Compat::Identical
        }
    }

    /// The canonical text written to the identity file.
    pub fn to_file_text(&self) -> String {
        let mut s = canon::to_canonical(self).expect("an identity serializes");
        s.push('\n');
        s
    }
}

/// The outcome of checking an identity file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IdentityCheck {
    /// The verdict.
    pub verdict: Compat,
    /// Saved chunk files (`*.json`) in the folder.
    pub saved_chunks: usize,
    /// Whether the file was (re)written.
    pub wrote: bool,
    /// The identity file's path.
    pub path: PathBuf,
}

/// The identity file next to a world's chunks.
pub struct IdentityFile;

impl IdentityFile {
    /// The chunks folder of `cfg`, resolved the way the chunk manager does
    /// (a relative save dir is relative to the working directory), or
    /// `None` when the world does not save.
    pub fn chunks_dir(cfg: &WorldConfig) -> Option<PathBuf> {
        if !cfg.saving {
            return None;
        }
        let mut folder = PathBuf::from(&cfg.save_dir);
        if folder.is_relative() {
            if let Ok(cwd) = std::env::current_dir() {
                folder = cwd.join(folder);
            }
        }
        folder.push("chunks");
        Some(folder)
    }

    /// Check `id` against the file in `cfg`'s chunks folder and write it
    /// when it is missing or drifted (per `policy`). A world that does not
    /// save has nothing to check: `Identical`.
    pub fn check_or_write(
        cfg: &WorldConfig,
        id: &LandscapeIdentity,
        policy: DriftPolicy,
    ) -> Result<Compat, GenError> {
        match Self::chunks_dir(cfg) {
            None => Ok(Compat::Identical),
            Some(dir) => Ok(Self::check_dir(&dir, id, policy)?.verdict),
        }
    }

    /// [`IdentityFile::check_or_write`] on an explicit chunks folder, with
    /// the full report.
    pub fn check_dir(
        dir: &Path,
        id: &LandscapeIdentity,
        policy: DriftPolicy,
    ) -> Result<IdentityCheck, GenError> {
        let io = |e: std::io::Error| GenError::Content {
            message: format!("landscape identity in {}: {e}", dir.display()),
        };
        std::fs::create_dir_all(dir).map_err(io)?;
        let path = dir.join(IDENTITY_FILE);
        let saved_chunks = std::fs::read_dir(dir)
            .map_err(io)?
            .flatten()
            .filter(|e| {
                let p = e.path();
                p.is_file() && p.extension().is_some_and(|x| x == "json")
            })
            .count();
        let verdict = match std::fs::read_to_string(&path) {
            Ok(text) => match json::from_str::<LandscapeIdentity>(&text) {
                Ok(recorded) => recorded.compare(id),
                Err(_) => Compat::Unknown,
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if saved_chunks == 0 {
                    // A fresh world: record it.
                    Self::write(&path, id).map_err(io)?;
                    return Ok(IdentityCheck {
                        verdict: Compat::Identical,
                        saved_chunks,
                        wrote: true,
                        path,
                    });
                }
                Compat::Unknown
            }
            Err(e) => return Err(io(e)),
        };
        if verdict == Compat::Identical {
            return Ok(IdentityCheck {
                verdict,
                saved_chunks,
                wrote: false,
                path,
            });
        }
        if saved_chunks > 0 {
            match policy {
                DriftPolicy::Refuse => {
                    return Err(GenError::Content {
                        message: format!(
                            "landscape identity drift ({verdict}) with {saved_chunks} saved chunk(s) in {}: refusing to start (wipe the chunks or choose another policy)",
                            dir.display()
                        ),
                    })
                }
                DriftPolicy::Warn => eprintln!(
                    "warning: landscape identity drift ({verdict}) with {saved_chunks} saved chunk(s) in {}; saved chunks will seam against regenerated ones",
                    dir.display()
                ),
                DriftPolicy::Allow => {}
            }
            let mut log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join(DRIFT_LOG))
                .map_err(io)?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            writeln!(
                log,
                "{now} {verdict} saved_chunks={saved_chunks} preset={} spec_hash={:016x}",
                id.preset, id.spec_hash
            )
            .map_err(io)?;
        }
        Self::write(&path, id).map_err(io)?;
        Ok(IdentityCheck {
            verdict,
            saved_chunks,
            wrote: true,
            path,
        })
    }

    fn write(path: &Path, id: &LandscapeIdentity) -> std::io::Result<()> {
        let tmp = path.with_extension("identity.tmp");
        std::fs::write(&tmp, id.to_file_text())?;
        std::fs::rename(&tmp, path)
    }
}
