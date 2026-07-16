use hashbrown::HashMap;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use specs::{Component, VecStorage};

/// Metadata keys owned by the MOTION replication lane (see
/// `world::replication`): they are captured straight from the ECS components
/// each tick, so the compact metadata lane strips them from its JSON.
pub const MOTION_METADATA_KEYS: [&str; 3] = ["position", "direction", "rigidBody"];

/// The `target` key straddles both lanes: its high-frequency `position`
/// field rides the motion lane, while the rest (`targetType`, `id`) stays on
/// the metadata lane.
const TARGET_METADATA_KEY: &str = "target";
const TARGET_POSITION_FIELD: &str = "position";

/// One tick's replication view of an entity's metadata: the full map (CREATE
/// snapshots, persistence, legacy clients) plus the non-motion subset's
/// change state (compact clients' metadata lane).
pub struct MetadataSnapshot {
    pub full_json: String,
    pub is_full_updated: bool,
    /// The non-motion subset JSON, present only when it changed since the
    /// previous snapshot.
    pub updated_non_motion_json: Option<String>,
}

/// A list of chunks that the entity is requesting to generate.
#[derive(Debug, Default, Component, Serialize, Deserialize, Clone)]
#[storage(VecStorage)]
pub struct MetadataComp {
    pub map: HashMap<String, Value>,

    /// The last JSON snapshot emitted by `to_cached_str`, used to detect changes.
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    last_emitted_json: Option<String>,

    /// The last non-motion subset emitted by `snapshot_for_replication`.
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    last_emitted_non_motion_json: Option<String>,
}

impl MetadataComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_map(map: HashMap<String, Value>) -> Self {
        Self {
            map,
            last_emitted_json: None,
            last_emitted_non_motion_json: None,
        }
    }

    pub fn set_value(&mut self, component: &str, value: Value) {
        self.map.insert(component.to_owned(), value);
    }

    /// Set a component's metadata (dynamic - sent every update)
    pub fn set<T: Component + Serialize>(&mut self, component: &str, data: &T) {
        let value = json!(data);
        self.set_value(component, value);
    }

    /// Set static metadata only if it doesn't already exist (sent on CREATE, not every UPDATE)
    pub fn set_once<T: Component + Serialize>(&mut self, component: &str, data: &T) {
        if !self.map.contains_key(component) {
            self.map.insert(component.to_owned(), json!(data));
        }
    }

    /// Get a component's metadata
    pub fn get<T: Component + DeserializeOwned>(&self, component: &str) -> Option<T> {
        if let Some(component) = self.map.get(component) {
            return Some(serde_json::from_value(component.to_owned()).unwrap());
        }

        None
    }

    /// Serialize to JSON, returning whether it changed since the last call.
    pub fn to_cached_str(&mut self) -> (String, bool) {
        let json_str = self.to_string();
        let updated = self.last_emitted_json.as_deref() != Some(json_str.as_str());

        if updated {
            self.last_emitted_json = Some(json_str.clone());
        }

        (json_str, updated)
    }

    /// Serialize both replication shapes with change detection: the full map
    /// and — only when the full map changed at all — the non-motion subset,
    /// compared against its own cache. The non-motion subset never changes
    /// without the full map changing (it is a projection of it), so the
    /// common unchanged case costs a single serialization, as before.
    pub fn snapshot_for_replication(&mut self) -> MetadataSnapshot {
        let full_json = self.to_string();
        let is_full_updated = self.last_emitted_json.as_deref() != Some(full_json.as_str());
        if is_full_updated {
            self.last_emitted_json = Some(full_json.clone());
        }

        let updated_non_motion_json = if is_full_updated {
            let non_motion = self.to_non_motion_string();
            if self.last_emitted_non_motion_json.as_deref() != Some(non_motion.as_str()) {
                self.last_emitted_non_motion_json = Some(non_motion.clone());
                Some(non_motion)
            } else {
                None
            }
        } else {
            None
        };

        MetadataSnapshot {
            full_json,
            is_full_updated,
            updated_non_motion_json,
        }
    }

    /// The metadata map without the motion-lane keys, and with the target's
    /// high-frequency position field stripped. Serialized through
    /// `serde_json::Map` (ordered), so the output is deterministic.
    fn to_non_motion_string(&self) -> String {
        let mut filtered = serde_json::Map::new();
        for (key, value) in &self.map {
            if MOTION_METADATA_KEYS.contains(&key.as_str()) {
                continue;
            }
            if key == TARGET_METADATA_KEY {
                if let Value::Object(target) = value {
                    let mut stripped = target.clone();
                    stripped.remove(TARGET_POSITION_FIELD);
                    filtered.insert(key.clone(), Value::Object(stripped));
                    continue;
                }
            }
            filtered.insert(key.clone(), value.clone());
        }
        serde_json::to_string(&filtered).unwrap()
    }

    /// Get a clean JSON string with no side-effects.
    pub fn to_string(&self) -> String {
        serde_json::to_string(&self.map).unwrap()
    }

    /// Force the next `to_cached_str` / `snapshot_for_replication` to report
    /// a change, so this metadata is re-emitted to consumers even if its
    /// content did not change. Used to deterministically re-sync peer state
    /// when world membership changes.
    pub fn mark_dirty(&mut self) {
        self.last_emitted_json = None;
        self.last_emitted_non_motion_json = None;
    }

    /// Is the metadata empty?
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// Reset this metadata
    pub fn reset(&mut self) {
        self.map.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchanged_metadata_reports_no_update() {
        let mut metadata = MetadataComp::new();
        metadata.set_value("position", json!([1.0, 2.0, 3.0]));

        let (first, updated) = metadata.to_cached_str();
        assert!(updated);

        // Rewriting the same value every tick (as the metadata systems do)
        // must not report a change.
        for _ in 0..10 {
            metadata.set_value("position", json!([1.0, 2.0, 3.0]));
            let (json_str, updated) = metadata.to_cached_str();
            assert!(!updated);
            assert_eq!(json_str, first);
        }
    }

    #[test]
    fn changed_metadata_reports_an_update_once() {
        let mut metadata = MetadataComp::new();
        metadata.set_value("position", json!([1.0, 2.0, 3.0]));
        metadata.to_cached_str();

        metadata.set_value("position", json!([4.0, 5.0, 6.0]));
        let (_, updated) = metadata.to_cached_str();
        assert!(updated);

        let (_, updated) = metadata.to_cached_str();
        assert!(!updated);
    }

    #[test]
    fn mark_dirty_forces_a_reemit() {
        let mut metadata = MetadataComp::new();
        metadata.set_value("position", json!([1.0, 2.0, 3.0]));
        metadata.to_cached_str();

        metadata.mark_dirty();
        let (_, updated) = metadata.to_cached_str();
        assert!(updated);
    }

    #[test]
    fn motion_only_changes_do_not_update_the_non_motion_subset() {
        let mut metadata = MetadataComp::new();
        metadata.set_value("position", json!([1.0, 2.0, 3.0]));
        metadata.set_value("path", json!({ "nodes": [1, 2, 3] }));

        let snapshot = metadata.snapshot_for_replication();
        assert!(snapshot.is_full_updated);
        let non_motion = snapshot.updated_non_motion_json.unwrap();
        assert!(!non_motion.contains("position"));
        assert!(non_motion.contains("path"));

        // Motion keys churning every tick must not dirty the metadata lane.
        metadata.set_value("position", json!([4.0, 5.0, 6.0]));
        metadata.set_value("direction", json!([0.0, 1.0, 0.0]));
        metadata.set_value("rigidBody", json!({ "isInFluid": true }));
        let snapshot = metadata.snapshot_for_replication();
        assert!(snapshot.is_full_updated);
        assert!(snapshot.updated_non_motion_json.is_none());

        // A genuine non-motion change does.
        metadata.set_value("path", json!({ "nodes": [4] }));
        let snapshot = metadata.snapshot_for_replication();
        assert!(snapshot.updated_non_motion_json.is_some());
    }

    #[test]
    fn target_position_rides_the_motion_lane_but_target_identity_does_not() {
        let mut metadata = MetadataComp::new();
        metadata.set_value(
            "target",
            json!({ "targetType": "Players", "position": [1.0, 2.0, 3.0], "id": "abc" }),
        );
        let snapshot = metadata.snapshot_for_replication();
        let non_motion = snapshot.updated_non_motion_json.unwrap();
        assert!(non_motion.contains("targetType"));
        assert!(!non_motion.contains("position"));

        // The target's position tracking a moving player is not a metadata
        // change...
        metadata.set_value(
            "target",
            json!({ "targetType": "Players", "position": [9.0, 9.0, 9.0], "id": "abc" }),
        );
        let snapshot = metadata.snapshot_for_replication();
        assert!(snapshot.updated_non_motion_json.is_none());

        // ...but retargeting to another entity is.
        metadata.set_value(
            "target",
            json!({ "targetType": "Players", "position": [9.0, 9.0, 9.0], "id": "xyz" }),
        );
        let snapshot = metadata.snapshot_for_replication();
        assert!(snapshot.updated_non_motion_json.is_some());
    }

    #[test]
    fn unchanged_metadata_snapshots_report_no_update() {
        let mut metadata = MetadataComp::new();
        metadata.set_value("text", json!("hello"));
        metadata.snapshot_for_replication();

        metadata.set_value("text", json!("hello"));
        let snapshot = metadata.snapshot_for_replication();
        assert!(!snapshot.is_full_updated);
        assert!(snapshot.updated_non_motion_json.is_none());
    }
}
