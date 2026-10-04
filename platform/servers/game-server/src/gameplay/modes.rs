//! Game modes within a realm: adventure and spectator. Moderators (`admin`
//! or `moderator` role in the game ticket) set anyone's mode in their
//! world; in a creative world players may switch their own.

use platform_ticket::Realm;
use serde::Deserialize;
use serde_json::json;
use specs::WorldExt;
use voxelize::{ClientFilter, Event, SessionIdentities, World};

use super::rules::{GameMode, IntentError};
use super::{parse, persist, reply, send, Gameplay};

/// `{ "player", "mode" }` to everyone in the world when a mode changes, and
/// to a joining player for everyone not in normal mode. Clients hide
/// spectators.
pub const MODE_EVENT: &str = "platform.mode";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ModePayload {
    mode: GameMode,
    /// Another player (moderators only); yourself when absent.
    #[serde(default)]
    player: Option<String>,
}

/// Whether the session's ticket names a moderating role.
fn moderator(world: &World, id: &str) -> bool {
    world
        .read_resource::<SessionIdentities>()
        .get(id)
        .and_then(|identity| identity.claims.get("roles").cloned())
        .and_then(|roles| serde_json::from_value::<Vec<String>>(roles).ok())
        .is_some_and(|roles| roles.iter().any(|r| r == "admin" || r == "moderator"))
}

/// Who may set `target`'s mode: moderators anyone's; players in a creative
/// world their own.
pub fn may_set(is_moderator: bool, self_realm: Realm, own: bool) -> bool {
    is_moderator || (own && self_realm == Realm::Creative)
}

pub(super) fn install(world: &mut World) {
    world.set_method_handle("platform.mode.set", |world, id, payload| {
        const INTENT: &str = "mode.set";
        let Some(p) = parse::<ModePayload>(world, id, INTENT, payload) else {
            return;
        };
        let target = p.player.clone().unwrap_or_else(|| id.to_owned());
        let is_moderator = moderator(world, id);
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let realm = g.players.get(id).map(|s| s.realm);
            match (realm, g.players.contains_key(&target)) {
                (None, _) => Err(IntentError::NothingThere),
                (_, false) => Err(IntentError::NothingThere),
                (Some(realm), true) if !may_set(is_moderator, realm, target == id) => {
                    Err(IntentError::GameMode)
                }
                _ => {
                    let state = g.players.get_mut(&target).expect("checked");
                    state.mode = p.mode;
                    state.mining = None;
                    Ok(json!({ "player": target, "mode": p.mode }))
                }
            }
        };
        let changed = result.is_ok();
        reply(world, id, INTENT, result);
        if changed {
            super::items_api::close_window(world, &target);
            world.events_mut().dispatch(
                Event::new(MODE_EVENT)
                    .payload(json!({ "player": target, "mode": p.mode }))
                    .filter(ClientFilter::All)
                    .build(),
            );
            super::send_vitals(world, &target, None);
            persist(world, &target);
        }
    });
}

/// Tell a joining player who is not in normal mode, and everyone else the
/// joiner's mode when it is not normal.
pub(super) fn on_join(world: &mut World, id: &str) {
    let (others, own) = {
        let g = world.ecs().read_resource::<Gameplay>();
        let others: Vec<(String, GameMode)> = g
            .players
            .iter()
            .filter(|(other, s)| other.as_str() != id && s.mode != GameMode::Normal)
            .map(|(other, s)| (other.clone(), s.mode))
            .collect();
        (others, g.players.get(id).map(|s| s.mode))
    };
    for (player, mode) in others {
        send(
            world,
            id,
            MODE_EVENT,
            json!({ "player": player, "mode": mode }),
        );
    }
    if let Some(mode) = own.filter(|m| *m != GameMode::Normal) {
        world.events_mut().dispatch(
            Event::new(MODE_EVENT)
                .payload(json!({ "player": id, "mode": mode }))
                .filter(ClientFilter::All)
                .build(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moderators_set_anyone_and_creative_players_themselves() {
        assert!(may_set(true, Realm::Survival, false));
        assert!(may_set(false, Realm::Creative, true));
        assert!(!may_set(false, Realm::Creative, false));
        assert!(!may_set(false, Realm::Survival, true));
    }
}
