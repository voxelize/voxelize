//! Process-wide runtime switches for performance fixes.
//!
//! Each fix that changes how the tick spends its time ships behind one of
//! these, on by default, so its cost can be A/B tested inside one running
//! core: flip it, measure, flip it back, under the same host load and the
//! same world state. A switch is read with one relaxed atomic load per use.
//! A host can expose them over HTTP (e.g. `GET/POST /perf/toggles`).

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

/// A performance fix that can be switched off at runtime.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PerfToggle {
    /// Under `client_only_meshing`, an edited chunk goes straight onto the
    /// send queue. Off restores the old round trip through a mesh job that
    /// only clears the (already empty) meshes: a Space build and a Registry
    /// clone on the tick thread, and one tick of delay before the chunk
    /// reaches clients.
    SkipNoopRemesh,
    /// A world with no clients dispatches once per
    /// `WorldConfig::hibernation_interval_ms` instead of every tick. Off makes
    /// every world tick at full rate whether or not anyone is in it.
    HibernateEmptyWorlds,
    /// A world whose tick ran past its next timer slot gets the next Tick as
    /// soon as it finishes. Off waits for the Server timer's next 16 ms slot,
    /// which turns a 17 ms tick into a 32 ms interval.
    CatchUpLateTicks,
    /// A dispatch advances `stats.tick` by the world steps the real time since
    /// the last one covers, and chunks players return to are paid the random
    /// ticks they missed. Off advances one tick per dispatch, so a slow or
    /// hibernating world's timers fall behind real time.
    CatchUpWorldTime,
}

struct ToggleSlot {
    toggle: PerfToggle,
    name: &'static str,
    description: &'static str,
    enabled: AtomicBool,
}

static SLOTS: [ToggleSlot; 4] = [
    ToggleSlot {
        toggle: PerfToggle::SkipNoopRemesh,
        name: "skipNoopRemesh",
        description: "Edited chunks go straight to clients under client-only meshing, \
                      instead of round-tripping through a no-op mesh job",
        enabled: AtomicBool::new(true),
    },
    ToggleSlot {
        toggle: PerfToggle::HibernateEmptyWorlds,
        name: "hibernateEmptyWorlds",
        description: "Worlds with no clients dispatch at their hibernation interval \
                      instead of every tick",
        enabled: AtomicBool::new(true),
    },
    ToggleSlot {
        toggle: PerfToggle::CatchUpLateTicks,
        name: "catchUpLateTicks",
        description: "A world whose tick overran its next slot is ticked again as soon \
                      as it finishes, instead of at the timer's next 16 ms slot",
        enabled: AtomicBool::new(true),
    },
    ToggleSlot {
        toggle: PerfToggle::CatchUpWorldTime,
        name: "catchUpWorldTime",
        description: "Ticks advance by the real time since the last dispatch, and chunks \
                      players return to catch up on the random ticks they missed",
        enabled: AtomicBool::new(true),
    },
];

fn slot(toggle: PerfToggle) -> &'static ToggleSlot {
    SLOTS
        .iter()
        .find(|slot| slot.toggle == toggle)
        .expect("every PerfToggle has a slot")
}

/// Whether a fix is on.
pub fn perf_toggle(toggle: PerfToggle) -> bool {
    slot(toggle).enabled.load(Ordering::Relaxed)
}

/// One switch as `GET /perf/toggles` lists it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfToggleState {
    pub name: &'static str,
    pub description: &'static str,
    pub enabled: bool,
}

/// Every switch and its current value.
pub fn perf_toggles() -> Vec<PerfToggleState> {
    SLOTS
        .iter()
        .map(|slot| PerfToggleState {
            name: slot.name,
            description: slot.description,
            enabled: slot.enabled.load(Ordering::Relaxed),
        })
        .collect()
}

/// Set a switch by its listed name. Returns the value it had, or an error
/// naming the known switches.
pub fn set_perf_toggle(name: &str, enabled: bool) -> Result<bool, String> {
    let Some(slot) = SLOTS.iter().find(|slot| slot.name == name) else {
        let known: Vec<&str> = SLOTS.iter().map(|slot| slot.name).collect();
        return Err(format!(
            "no perf toggle named `{name}`; known: {}",
            known.join(", ")
        ));
    };
    let previous = slot.enabled.swap(enabled, Ordering::Relaxed);
    if previous != enabled {
        log::info!("[perf-toggle] {name} = {enabled}");
    }
    Ok(previous)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_toggle_has_one_named_slot() {
        for toggle in [
            PerfToggle::SkipNoopRemesh,
            PerfToggle::HibernateEmptyWorlds,
            PerfToggle::CatchUpLateTicks,
            PerfToggle::CatchUpWorldTime,
        ] {
            assert_eq!(SLOTS.iter().filter(|s| s.toggle == toggle).count(), 1);
        }
        let mut names: Vec<&str> = SLOTS.iter().map(|s| s.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), SLOTS.len());
    }

    #[test]
    fn unknown_names_are_refused_with_the_known_list() {
        let err = set_perf_toggle("noSuchToggle", false).unwrap_err();
        assert!(err.contains("skipNoopRemesh"));
        assert!(err.contains("hibernateEmptyWorlds"));
        assert!(err.contains("catchUpLateTicks"));
        assert!(err.contains("catchUpWorldTime"));
    }
}
