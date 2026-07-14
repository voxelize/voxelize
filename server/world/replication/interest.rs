//! Interest management for the state replication layer: per-client relevance
//! filtering so a client only receives replicated state (entities, peers) it
//! can actually observe, instead of the whole world.
//!
//! Entities use a tracked interest set with enter/leave hysteresis because
//! their client-side lifecycle is driven by reliable CREATE / OUT_OF_RANGE
//! events. Peers have a reliable JOIN/LEAVE lifecycle of their own, so their
//! relevance check ([`is_peer_relevant`]) is a stateless radius test applied
//! at staging time.

use hashbrown::HashMap;

/// Whether a peer's state should replicate to a client, given the squared
/// distance between them. `None` (the default) replicates every peer to every
/// client — there is no wire-level "peer left your view" signal, so games must
/// opt into radius culling via `WorldConfig::peer_visible_radius`, knowingly
/// accepting that out-of-range players freeze at their last known position on
/// the client.
pub fn is_peer_relevant(distance_sq: f32, peer_visible_radius: Option<f32>) -> bool {
    match peer_visible_radius {
        Some(radius) => distance_sq <= radius * radius,
        None => true,
    }
}

/// How an entity's distance to a client should change that client's tracked
/// set, given the hysteresis band between the visible and release radii.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InterestTransition {
    /// Untracked entity moved within the visible radius: stream a full snapshot.
    Enter,
    /// Tracked entity is still within the release radius: keep streaming.
    Keep,
    /// Tracked entity moved beyond the release radius: notify and stop streaming.
    Leave,
    /// Untracked entity is still out of the visible radius: nothing to do.
    Ignore,
}

pub fn classify_interest(
    is_tracked: bool,
    distance_sq: f32,
    visible_radius: f32,
    release_radius: f32,
) -> InterestTransition {
    if is_tracked {
        if distance_sq > release_radius * release_radius {
            InterestTransition::Leave
        } else {
            InterestTransition::Keep
        }
    } else if distance_sq <= visible_radius * visible_radius {
        InterestTransition::Enter
    } else {
        InterestTransition::Ignore
    }
}

/// Per-client sets of entity ids currently streaming to that client. Each entry
/// remembers the tick of the last message sent for the entity so unchanged
/// entities can receive periodic keep-alive updates.
#[derive(Default)]
pub struct EntityInterests {
    clients: HashMap<String, HashMap<String, u64>>,
}

impl EntityInterests {
    pub fn is_tracked(&self, client_id: &str, entity_id: &str) -> bool {
        self.clients
            .get(client_id)
            .map(|tracked| tracked.contains_key(entity_id))
            .unwrap_or(false)
    }

    pub fn track(&mut self, client_id: &str, entity_id: &str, tick: u64) {
        self.clients
            .entry(client_id.to_owned())
            .or_default()
            .insert(entity_id.to_owned(), tick);
    }

    pub fn untrack(&mut self, client_id: &str, entity_id: &str) -> bool {
        self.clients
            .get_mut(client_id)
            .map(|tracked| tracked.remove(entity_id).is_some())
            .unwrap_or(false)
    }

    pub fn tracked_mut(&mut self, client_id: &str) -> Option<&mut HashMap<String, u64>> {
        self.clients.get_mut(client_id)
    }

    pub fn remove_client(&mut self, client_id: &str) {
        self.clients.remove(client_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VISIBLE: f32 = 100.0;
    const RELEASE: f32 = 112.5;

    fn classify(is_tracked: bool, distance: f32) -> InterestTransition {
        classify_interest(is_tracked, distance * distance, VISIBLE, RELEASE)
    }

    #[test]
    fn untracked_entity_enters_within_visible_radius() {
        assert_eq!(classify(false, 99.9), InterestTransition::Enter);
        assert_eq!(classify(false, 100.0), InterestTransition::Enter);
    }

    #[test]
    fn untracked_entity_is_ignored_outside_visible_radius() {
        assert_eq!(classify(false, 100.1), InterestTransition::Ignore);
        assert_eq!(classify(false, 500.0), InterestTransition::Ignore);
    }

    #[test]
    fn tracked_entity_is_kept_through_the_hysteresis_band() {
        assert_eq!(classify(true, 50.0), InterestTransition::Keep);
        assert_eq!(classify(true, 100.1), InterestTransition::Keep);
        assert_eq!(classify(true, 112.5), InterestTransition::Keep);
    }

    #[test]
    fn tracked_entity_leaves_beyond_release_radius() {
        assert_eq!(classify(true, 112.6), InterestTransition::Leave);
        assert_eq!(classify(true, 500.0), InterestTransition::Leave);
    }

    #[test]
    fn boundary_oscillation_between_radii_causes_no_transitions() {
        let mut is_tracked = false;
        let mut transitions = 0;

        for step in 0..40 {
            let distance = if step % 2 == 0 { 101.0 } else { 111.0 };
            match classify(is_tracked, distance) {
                InterestTransition::Enter => {
                    is_tracked = true;
                    transitions += 1;
                }
                InterestTransition::Leave => {
                    is_tracked = false;
                    transitions += 1;
                }
                _ => {}
            }
        }

        assert_eq!(transitions, 0);

        assert_eq!(classify(is_tracked, 99.0), InterestTransition::Enter);
        is_tracked = true;

        for step in 0..40 {
            let distance = if step % 2 == 0 { 101.0 } else { 111.0 };
            assert_eq!(classify(is_tracked, distance), InterestTransition::Keep);
        }
    }

    #[test]
    fn peer_relevance_defaults_to_unlimited() {
        assert!(is_peer_relevant(f32::MAX, None));
        assert!(is_peer_relevant(0.0, None));
    }

    #[test]
    fn peer_relevance_respects_configured_radius() {
        let radius = Some(50.0);
        assert!(is_peer_relevant(49.0 * 49.0, radius));
        assert!(is_peer_relevant(50.0 * 50.0, radius));
        assert!(!is_peer_relevant(50.1 * 50.1, radius));
    }

    #[test]
    fn rejoining_client_starts_with_a_fresh_interest_set() {
        let mut interests = EntityInterests::default();

        interests.track("client", "fish", 5);
        interests.track("client", "crab", 6);
        interests.remove_client("client");

        interests.track("client", "block::sign", 9);

        assert!(!interests.is_tracked("client", "fish"));
        assert!(!interests.is_tracked("client", "crab"));
        assert!(interests.is_tracked("client", "block::sign"));
    }

    #[test]
    fn interests_track_untrack_round_trip() {
        let mut interests = EntityInterests::default();

        assert!(!interests.is_tracked("client", "fish"));
        interests.track("client", "fish", 7);
        assert!(interests.is_tracked("client", "fish"));
        assert_eq!(
            interests.tracked_mut("client").unwrap().get("fish"),
            Some(&7)
        );

        assert!(interests.untrack("client", "fish"));
        assert!(!interests.is_tracked("client", "fish"));
        assert!(!interests.untrack("client", "fish"));

        interests.track("client", "fish", 9);
        interests.remove_client("client");
        assert!(!interests.is_tracked("client", "fish"));
    }
}
