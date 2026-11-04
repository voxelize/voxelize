use std::sync::Arc;

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
/// change state (compact clients' metadata lane). The full JSON is shared,
/// not copied: an unchanged entity hands every tick the same string.
pub struct MetadataSnapshot {
    pub full_json: Arc<str>,
    pub is_full_updated: bool,
    /// The non-motion subset JSON without the world's on-request keys
    /// (`WorldConfig::on_request_metadata_keys`), present only when it
    /// changed since the previous snapshot: what every compact client gets.
    pub updated_non_motion_json: Option<String>,
    /// The non-motion subset with the on-request keys, present only when
    /// asked for and changed: what a client that asked for them gets.
    pub updated_requested_non_motion_json: Option<String>,
}

/// One metadata key as the last snapshot serialized it.
#[derive(Debug, Clone)]
struct KeyFragment {
    value: Value,
    /// The key, JSON-escaped.
    key_json: String,
    /// The value's JSON.
    json: String,
    /// `target` only: the JSON with the motion-lane position stripped.
    non_motion_json: Option<String>,
    /// The metadata version at which the value last changed.
    changed_at: u64,
    /// The version at which what the metadata lanes carry of it changed:
    /// `changed_at`, except for `target`, whose position alone moving is
    /// not a metadata-lane change.
    non_motion_changed_at: u64,
}

impl KeyFragment {
    fn new(key: &str, value: &Value, version: u64) -> Self {
        let non_motion_json = match value {
            Value::Object(target) if key == TARGET_METADATA_KEY => {
                let mut stripped = target.clone();
                stripped.remove(TARGET_POSITION_FIELD);
                Some(serde_json::to_string(&stripped).unwrap())
            }
            _ => None,
        };
        Self {
            value: value.clone(),
            key_json: serde_json::to_string(key).unwrap(),
            json: serde_json::to_string(value).unwrap(),
            non_motion_json,
            changed_at: version,
            non_motion_changed_at: version,
        }
    }

    /// Take a changed value at `version`, keeping `non_motion_changed_at`
    /// when the metadata lanes' view of it is the same.
    fn update(&mut self, key: &str, value: &Value, version: u64) {
        let previous_non_motion = self.non_motion_json.take();
        let previous_changed_at = self.non_motion_changed_at;
        *self = Self::new(key, value, version);
        if previous_non_motion.is_some() && previous_non_motion == self.non_motion_json {
            self.non_motion_changed_at = previous_changed_at;
        }
    }
}

/// A list of chunks that the entity is requesting to generate.
#[derive(Debug, Default, Component, Serialize, Deserialize, Clone)]
#[storage(VecStorage)]
pub struct MetadataComp {
    pub map: HashMap<String, Value>,

    /// Every key's value as last serialized, with its JSON. A snapshot
    /// compares values against these and re-serializes only the keys that
    /// changed: an entity whose metadata holds still costs a comparison,
    /// not a full JSON write, every tick.
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    fragments: HashMap<String, KeyFragment>,

    /// Counts changes to the fragments; each lane remembers the version it
    /// last emitted at, so it is rebuilt only when one of its own keys
    /// changed since, whoever else read the metadata in between.
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    version: u64,

    /// The version at which a key last went away.
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    removed_at: u64,

    /// The last JSON snapshot emitted, with the version it was built at.
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    last_emitted_json: Option<(Arc<str>, u64)>,

    /// The last non-motion subset emitted by `snapshot_for_replication`.
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    last_emitted_non_motion_json: Option<(String, u64)>,

    /// The last non-motion subset with the on-request keys emitted.
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    last_emitted_requested_non_motion_json: Option<(String, u64)>,
}

impl MetadataComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_map(map: HashMap<String, Value>) -> Self {
        Self {
            map,
            ..Self::default()
        }
    }

    pub fn set_value(&mut self, component: &str, value: Value) {
        // Metadata systems rewrite every key every tick, mostly with the
        // same value: update in place, without allocating the key again.
        match self.map.get_mut(component) {
            Some(existing) => {
                if *existing != value {
                    *existing = value;
                }
            }
            None => {
                self.map.insert(component.to_owned(), value);
            }
        }
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

    /// Get a component's metadata. Malformed metadata (a stale persisted
    /// shape, a bad client payload) reads as absent with a loud error
    /// instead of panicking: the panic unwound into the world actor's
    /// catch_unwind, which silently swallowed whatever operation carried
    /// it — entity spawns vanished without a trace.
    pub fn get<T: Component + DeserializeOwned>(&self, component: &str) -> Option<T> {
        let value = self.map.get(component)?;
        match serde_json::from_value(value.to_owned()) {
            Ok(data) => Some(data),
            Err(err) => {
                log::error!(
                    "metadata key '{}' failed to deserialize as {} and reads as absent: {} (value: {})",
                    component,
                    std::any::type_name::<T>(),
                    err,
                    value
                );
                None
            }
        }
    }

    /// Serialize to JSON, returning whether it changed since the last call.
    pub fn to_cached_str(&mut self) -> (String, bool) {
        let (json, is_updated) = self.full_snapshot();
        (json.to_string(), is_updated)
    }

    /// Bring `fragments` in line with `map`, re-serializing only the keys
    /// whose value changed, each stamped with a new version.
    fn refresh_fragments(&mut self) {
        for (key, value) in &self.map {
            match self.fragments.get_mut(key) {
                Some(fragment) if fragment.value == *value => {}
                Some(fragment) => {
                    self.version += 1;
                    fragment.update(key, value, self.version);
                }
                None => {
                    self.version += 1;
                    self.fragments
                        .insert(key.clone(), KeyFragment::new(key, value, self.version));
                }
            }
        }
        if self.fragments.len() != self.map.len() {
            let map = &self.map;
            self.fragments.retain(|key, _| map.contains_key(key));
            self.version += 1;
            self.removed_at = self.version;
        }
    }

    /// The JSON object of the fragments `is_kept` keeps, keys sorted so the
    /// output is deterministic; `is_non_motion` takes the target's stripped
    /// form.
    fn join_fragments(&self, is_kept: impl Fn(&str) -> bool, is_non_motion: bool) -> String {
        let mut keys: Vec<&String> = self
            .fragments
            .keys()
            .filter(|key| is_kept(key.as_str()))
            .collect();
        keys.sort_unstable();
        let mut out = String::with_capacity(
            2 + keys
                .iter()
                .map(|key| {
                    let fragment = &self.fragments[*key];
                    fragment.key_json.len() + fragment.json.len() + 2
                })
                .sum::<usize>(),
        );
        out.push('{');
        for (i, key) in keys.into_iter().enumerate() {
            let fragment = &self.fragments[key];
            if i > 0 {
                out.push(',');
            }
            out.push_str(&fragment.key_json);
            out.push(':');
            match (&fragment.non_motion_json, is_non_motion) {
                (Some(stripped), true) => out.push_str(stripped),
                _ => out.push_str(&fragment.json),
            }
        }
        out.push('}');
        out
    }

    /// The full map's JSON and whether it changed since the last snapshot.
    /// Unchanged metadata hands back the cached JSON without serializing.
    fn full_snapshot(&mut self) -> (Arc<str>, bool) {
        self.refresh_fragments();
        if let Some((json, version)) = &self.last_emitted_json {
            if *version == self.version {
                return (json.clone(), false);
            }
        }
        let json: Arc<str> = self.join_fragments(|_| true, false).into();
        self.last_emitted_json = Some((json.clone(), self.version));
        (json, true)
    }

    /// Whether a lane that last emitted at `emitted` (none: never) has a
    /// key `is_in_lane` keeps that changed since, or lost a key since.
    fn is_lane_stale(&self, emitted: Option<u64>, is_in_lane: impl Fn(&str) -> bool) -> bool {
        let Some(emitted) = emitted else {
            return true;
        };
        self.removed_at > emitted
            || self
                .fragments
                .iter()
                .any(|(key, fragment)| fragment.non_motion_changed_at > emitted && is_in_lane(key))
    }

    /// Serialize the replication shapes with change detection: the full map,
    /// and each metadata lane (the non-motion subset without
    /// `on_request_keys`; with them while `is_requested`) only when one of
    /// its own keys changed since that lane last went out. The common
    /// unchanged case serializes nothing and copies nothing.
    ///
    /// Keys a world sends only on request (debug views that change every
    /// tick) would otherwise dirty the subset every tick and resend all of
    /// it, static keys included, to every client.
    pub fn snapshot_for_replication(
        &mut self,
        on_request_keys: &[String],
        is_requested: bool,
    ) -> MetadataSnapshot {
        let (full_json, is_full_updated) = self.full_snapshot();

        let is_lane_key = |key: &str| !MOTION_METADATA_KEYS.contains(&key);
        let is_public_key =
            |key: &str| is_lane_key(key) && !on_request_keys.iter().any(|skipped| skipped == key);

        let mut updated_non_motion_json = None;
        let emitted = self.last_emitted_non_motion_json.as_ref().map(|(_, v)| *v);
        if self.is_lane_stale(emitted, is_public_key) {
            let non_motion = self.join_fragments(is_public_key, true);
            let is_new = self
                .last_emitted_non_motion_json
                .as_ref()
                .map_or(true, |(last, _)| *last != non_motion);
            self.last_emitted_non_motion_json = Some((non_motion.clone(), self.version));
            if is_new {
                updated_non_motion_json = Some(non_motion);
            }
        }

        let mut updated_requested_non_motion_json = None;
        if is_requested && !on_request_keys.is_empty() {
            let emitted = self
                .last_emitted_requested_non_motion_json
                .as_ref()
                .map(|(_, v)| *v);
            if self.is_lane_stale(emitted, is_lane_key) {
                let requested = self.join_fragments(is_lane_key, true);
                let is_new = self
                    .last_emitted_requested_non_motion_json
                    .as_ref()
                    .map_or(true, |(last, _)| *last != requested);
                self.last_emitted_requested_non_motion_json =
                    Some((requested.clone(), self.version));
                if is_new {
                    updated_requested_non_motion_json = Some(requested);
                }
            }
        }

        MetadataSnapshot {
            full_json,
            is_full_updated,
            updated_non_motion_json,
            updated_requested_non_motion_json,
        }
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
        self.last_emitted_requested_non_motion_json = None;
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
    fn cached_snapshots_parse_back_to_the_map() {
        let mut metadata = MetadataComp::new();
        metadata.set_value("text", json!("a \"quoted\" line"));
        metadata.set_value("brain", json!({ "heading": 0.25, "running": true }));
        metadata.set_value(
            "target",
            json!({ "targetType": "Players", "position": [1.0, 2.0, 3.0] }),
        );
        for step in 0..4 {
            match step {
                1 => metadata.set_value("brain", json!({ "heading": -1.5, "running": false })),
                2 => {
                    metadata.map.remove("text");
                }
                3 => metadata.set_value("new key", json!([1, 2, 3])),
                _ => {}
            }
            let snapshot = metadata.snapshot_for_replication(&[], false);
            let parsed: HashMap<String, Value> =
                serde_json::from_str(&snapshot.full_json).unwrap();
            assert_eq!(parsed, metadata.map, "step {step}");
        }
    }

    #[test]
    fn a_change_another_reader_saw_first_still_reaches_the_metadata_lane() {
        let mut metadata = MetadataComp::new();
        metadata.set_value("path", json!([1]));
        metadata.snapshot_for_replication(&[], false);

        metadata.set_value("path", json!([2]));
        let (_, updated) = metadata.to_cached_str();
        assert!(updated);
        let snapshot = metadata.snapshot_for_replication(&[], false);
        assert!(!snapshot.is_full_updated);
        assert_eq!(
            snapshot.updated_non_motion_json.as_deref(),
            Some(r#"{"path":[2]}"#)
        );
    }

    #[test]
    fn the_on_request_lane_catches_up_on_changes_made_while_unrequested() {
        let keys = vec!["debug".to_owned()];
        let mut metadata = MetadataComp::new();
        metadata.set_value("debug", json!(1));
        metadata.snapshot_for_replication(&keys, true);

        metadata.set_value("debug", json!(2));
        let snapshot = metadata.snapshot_for_replication(&keys, false);
        assert!(snapshot.updated_requested_non_motion_json.is_none());
        assert!(snapshot.updated_non_motion_json.is_none());

        let snapshot = metadata.snapshot_for_replication(&keys, true);
        assert_eq!(
            snapshot.updated_requested_non_motion_json.as_deref(),
            Some(r#"{"debug":2}"#)
        );
    }

    #[test]
    fn removing_a_key_is_an_update() {
        let mut metadata = MetadataComp::new();
        metadata.set_value("a", json!(1));
        metadata.set_value("b", json!(2));
        metadata.snapshot_for_replication(&[], false);

        metadata.map.remove("b");
        let snapshot = metadata.snapshot_for_replication(&[], false);
        assert!(snapshot.is_full_updated);
        assert_eq!(snapshot.updated_non_motion_json.as_deref(), Some(r#"{"a":1}"#));
    }

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

        let snapshot = metadata.snapshot_for_replication(&[], false);
        assert!(snapshot.is_full_updated);
        let non_motion = snapshot.updated_non_motion_json.unwrap();
        assert!(!non_motion.contains("position"));
        assert!(non_motion.contains("path"));

        // Motion keys churning every tick must not dirty the metadata lane.
        metadata.set_value("position", json!([4.0, 5.0, 6.0]));
        metadata.set_value("direction", json!([0.0, 1.0, 0.0]));
        metadata.set_value("rigidBody", json!({ "isInFluid": true }));
        let snapshot = metadata.snapshot_for_replication(&[], false);
        assert!(snapshot.is_full_updated);
        assert!(snapshot.updated_non_motion_json.is_none());

        // A genuine non-motion change does.
        metadata.set_value("path", json!({ "nodes": [4] }));
        let snapshot = metadata.snapshot_for_replication(&[], false);
        assert!(snapshot.updated_non_motion_json.is_some());
    }

    #[test]
    fn target_position_rides_the_motion_lane_but_target_identity_does_not() {
        let mut metadata = MetadataComp::new();
        metadata.set_value(
            "target",
            json!({ "targetType": "Players", "position": [1.0, 2.0, 3.0], "id": "abc" }),
        );
        let snapshot = metadata.snapshot_for_replication(&[], false);
        let non_motion = snapshot.updated_non_motion_json.unwrap();
        assert!(non_motion.contains("targetType"));
        assert!(!non_motion.contains("position"));

        // The target's position tracking a moving player is not a metadata
        // change...
        metadata.set_value(
            "target",
            json!({ "targetType": "Players", "position": [9.0, 9.0, 9.0], "id": "abc" }),
        );
        let snapshot = metadata.snapshot_for_replication(&[], false);
        assert!(snapshot.updated_non_motion_json.is_none());

        // ...but retargeting to another entity is.
        metadata.set_value(
            "target",
            json!({ "targetType": "Players", "position": [9.0, 9.0, 9.0], "id": "xyz" }),
        );
        let snapshot = metadata.snapshot_for_replication(&[], false);
        assert!(snapshot.updated_non_motion_json.is_some());
    }

    #[test]
    fn unchanged_metadata_snapshots_report_no_update() {
        let mut metadata = MetadataComp::new();
        metadata.set_value("text", json!("hello"));
        metadata.snapshot_for_replication(&[], false);

        metadata.set_value("text", json!("hello"));
        let snapshot = metadata.snapshot_for_replication(&[], false);
        assert!(!snapshot.is_full_updated);
        assert!(snapshot.updated_non_motion_json.is_none());
    }

    #[test]
    fn on_request_keys_change_only_the_requested_subset() {
        let keys = vec!["debug".to_owned()];
        let mut metadata = MetadataComp::new();
        metadata.set_value("health", json!(10));
        metadata.set_value("debug", json!({ "state": "wander" }));

        let snapshot = metadata.snapshot_for_replication(&keys, true);
        let plain = snapshot.updated_non_motion_json.unwrap();
        assert!(plain.contains("health") && !plain.contains("debug"));
        let requested = snapshot.updated_requested_non_motion_json.unwrap();
        assert!(requested.contains("health") && requested.contains("debug"));

        // A tick where only the on-request key moved: nothing for a client
        // that did not ask, the whole subset for one that did.
        metadata.set_value("debug", json!({ "state": "flee" }));
        let snapshot = metadata.snapshot_for_replication(&keys, true);
        assert!(snapshot.updated_non_motion_json.is_none());
        assert!(snapshot
            .updated_requested_non_motion_json
            .unwrap()
            .contains("flee"));

        // Nobody asking: the requested subset is not even built.
        metadata.set_value("debug", json!({ "state": "rest" }));
        let snapshot = metadata.snapshot_for_replication(&keys, false);
        assert!(snapshot.updated_non_motion_json.is_none());
        assert!(snapshot.updated_requested_non_motion_json.is_none());

        // Asked again later, it reports what changed while nobody asked.
        let snapshot = {
            metadata.set_value("health", json!(9));
            metadata.snapshot_for_replication(&keys, true)
        };
        assert!(snapshot.updated_non_motion_json.is_some());
        assert!(snapshot
            .updated_requested_non_motion_json
            .unwrap()
            .contains("rest"));
    }
}
