//! Per-player state on disk, next to the world's chunks.
//!
//! `<save_dir>/<world>/players/<player id>.json`, written atomically (temp
//! file, fsync, rename) so a crash leaves the old or the new record, never a
//! torn one. Phase 6 moves this to `player_world_states` in the backend.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::inventory::Inventory;
use super::survival::Vitals;

pub const RECORD_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerRecord {
    pub version: u32,
    pub id: String,
    pub inventory: Inventory,
    /// Last known position, restored on the next join.
    #[serde(default)]
    pub position: Option<[f32; 3]>,
    /// Records written before survival existed load with full vitals.
    #[serde(default)]
    pub vitals: Vitals,
    #[serde(default)]
    pub armor: Vec<Option<super::inventory::Stack>>,
    #[serde(default)]
    pub offhand: Option<super::inventory::Stack>,
    /// The dimension the player is in; records from before dimensions
    /// existed are in the overworld.
    #[serde(default)]
    pub dimension: platform_content::Dimension,
    /// Set while travelling: where the player is to arrive.
    #[serde(default)]
    pub arrival: Option<super::travel::Arrival>,
    /// Listings taken from the inventory, not yet confirmed by the backend.
    #[serde(default)]
    pub outbox: Vec<super::bridge::OutboxEntry>,
    /// Ids of market deliveries already handed over.
    #[serde(default)]
    pub delivered: Vec<String>,
}

pub struct PlayerStore {
    dir: PathBuf,
    /// The dimension whose world uses this store; every dimension of a
    /// world shares one players directory.
    dimension: platform_content::Dimension,
}

/// Player ids become file names, so only a conservative alphabet is
/// accepted (ticket subjects are ULIDs).
pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[derive(Debug)]
pub enum StoreError {
    UnsafeId,
    Io(std::io::Error),
    Corrupt(serde_json::Error),
    UnsupportedVersion(u32),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::UnsafeId => write!(f, "player id is not safe to store"),
            StoreError::Io(e) => write!(f, "io: {e}"),
            StoreError::Corrupt(e) => write!(f, "corrupt record: {e}"),
            StoreError::UnsupportedVersion(v) => write!(f, "unsupported record version {v}"),
        }
    }
}

impl PlayerStore {
    pub fn new(world_dir: impl AsRef<Path>) -> Self {
        Self::for_dimension(world_dir, platform_content::Dimension::Overworld)
    }

    pub fn for_dimension(
        world_dir: impl AsRef<Path>,
        dimension: platform_content::Dimension,
    ) -> Self {
        Self {
            dir: world_dir.as_ref().join("players"),
            dimension,
        }
    }

    /// The record of a player in this store's dimension.
    pub fn record(
        &self,
        id: &str,
        player: &super::rules::PlayerState,
        position: Option<[f32; 3]>,
    ) -> PlayerRecord {
        PlayerRecord {
            version: RECORD_VERSION,
            id: id.to_owned(),
            inventory: player.inventory.clone(),
            position,
            vitals: player.vitals.clone(),
            armor: player.armor.clone(),
            offhand: player.offhand.clone(),
            dimension: self.dimension,
            arrival: player.travel.arrival.clone(),
            outbox: player.market.outbox.clone(),
            delivered: player.market.delivered.iter().cloned().collect(),
        }
    }

    fn path(&self, id: &str) -> Result<PathBuf, StoreError> {
        if !is_safe_id(id) {
            return Err(StoreError::UnsafeId);
        }
        Ok(self.dir.join(format!("{id}.json")))
    }

    /// `Ok(None)` for a player who has never been saved.
    pub fn load(&self, id: &str) -> Result<Option<PlayerRecord>, StoreError> {
        let path = self.path(id)?;
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(StoreError::Io(e)),
        };
        let record: PlayerRecord = serde_json::from_str(&text).map_err(StoreError::Corrupt)?;
        if record.version != RECORD_VERSION {
            return Err(StoreError::UnsupportedVersion(record.version));
        }
        Ok(Some(record))
    }

    pub fn save(&self, record: &PlayerRecord) -> Result<(), StoreError> {
        let path = self.path(&record.id)?;
        fs::create_dir_all(&self.dir).map_err(StoreError::Io)?;
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(record).map_err(StoreError::Corrupt)?;
        let result = (|| {
            let mut file = fs::File::create(&tmp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&tmp, &path)
        })();
        if let Err(e) = result {
            let _ = fs::remove_file(&tmp);
            return Err(StoreError::Io(e));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("platform-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn round_trip_and_missing_player() {
        let dir = temp_dir("roundtrip");
        let store = PlayerStore::new(&dir);
        assert!(store.load("01ABC").unwrap().is_none());
        let record = PlayerRecord {
            version: RECORD_VERSION,
            id: "01ABC".into(),
            inventory: Inventory::default(),
            position: Some([1.0, 70.0, -3.5]),
            vitals: Vitals::default(),
            armor: vec![None; 4],
            offhand: None,
            dimension: platform_content::Dimension::Underworld,
            arrival: Some(super::super::travel::Arrival {
                from: platform_content::Dimension::Overworld,
                at: [12.0, 64.0, -4.0],
                portal: Some([90, 70, -30]),
                exact: false,
            }),
            outbox: vec![super::super::bridge::OutboxEntry {
                id: "o1".into(),
                item: "coal".into(),
                count: 3,
                durability: None,
                kind: "fixed".into(),
                price: 9,
                buyout: None,
                hours: 48,
            }],
            delivered: vec!["d1".into()],
        };
        store.save(&record).unwrap();
        assert_eq!(store.load("01ABC").unwrap(), Some(record));
        assert!(!dir.join("players/01ABC.json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsafe_ids_and_corrupt_files_fail_loudly() {
        let dir = temp_dir("unsafe");
        let store = PlayerStore::new(&dir);
        assert!(matches!(
            store.load("../etc/passwd"),
            Err(StoreError::UnsafeId)
        ));
        fs::create_dir_all(dir.join("players")).unwrap();
        fs::write(dir.join("players/bad.json"), "{not json").unwrap();
        assert!(matches!(store.load("bad"), Err(StoreError::Corrupt(_))));
        let _ = fs::remove_dir_all(&dir);
    }
}
