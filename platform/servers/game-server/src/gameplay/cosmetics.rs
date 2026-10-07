//! Cosmetics: what a player wears. The backend sells and equips them and
//! puts the result in the game ticket's `look` claim; the server checks its
//! shape and shows it to everyone in the world. A player who changes their
//! look in play presents a fresh ticket (`platform.look.set`).

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specs::WorldExt;
use voxelize::{ClientFilter, Event, SessionIdentities, World};

use super::rules::IntentError;
use super::{parse, reply, send, Gameplay};

/// `{ "player", "look": Look | null }` to everyone when a look changes, and
/// to a joining player for everyone already dressed.
pub const LOOK_EVENT: &str = "platform.look";

/// Hat pictures the client knows how to draw.
pub const HAT_ARTS: &[&str] = &["crown"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outfit {
    pub body: String,
    pub arms: String,
    pub legs: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hat {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Look {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outfit: Option<Outfit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hat: Option<Hat>,
}

fn colour(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|h| h.is_ascii_hexdigit())
}

impl Look {
    /// A look from a ticket claim, or `None` when it is absent, empty or
    /// not well formed (nothing odd is ever passed on to other clients).
    pub fn from_claim(claim: Option<&Value>) -> Option<Look> {
        let look: Look = serde_json::from_value(claim?.clone()).ok()?;
        if let Some(o) = &look.outfit {
            if ![&o.body, &o.arms, &o.legs].iter().all(|c| colour(c)) {
                return None;
            }
        }
        if let Some(h) = &look.hat {
            let art_ok = h.art.as_deref().is_none_or(|a| HAT_ARTS.contains(&a));
            let colour_ok = h.color.as_deref().is_none_or(colour);
            if !art_ok || !colour_ok || (h.art.is_none() && h.color.is_none()) {
                return None;
            }
        }
        (look != Look::default()).then_some(look)
    }
}

fn broadcast(world: &mut World, id: &str, look: Option<&Look>) {
    world.events_mut().dispatch(
        Event::new(LOOK_EVENT)
            .payload(json!({ "player": id, "look": look }))
            .filter(ClientFilter::All)
            .build(),
    );
}

/// Put on a look (or take everything off) and tell everyone.
fn wear(world: &mut World, id: &str, look: Option<Look>) {
    {
        let mut g = world.ecs().write_resource::<Gameplay>();
        match &look {
            Some(l) => g.looks.insert(id.to_owned(), l.clone()),
            None => g.looks.remove(id),
        };
    }
    broadcast(world, id, look.as_ref());
}

pub(super) fn on_join(world: &mut World, id: &str) {
    let others: Vec<(String, Look)> = {
        let g = world.ecs().read_resource::<Gameplay>();
        g.looks
            .iter()
            .filter(|(other, _)| other.as_str() != id)
            .map(|(other, look)| (other.clone(), look.clone()))
            .collect()
    };
    for (player, look) in others {
        send(
            world,
            id,
            LOOK_EVENT,
            json!({ "player": player, "look": look }),
        );
    }
    let look = Look::from_claim(
        world
            .read_resource::<SessionIdentities>()
            .get(id)
            .and_then(|identity| identity.claims.get("look")),
    );
    if look.is_some() {
        wear(world, id, look);
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LookPayload {
    /// A fresh game ticket for this player, carrying the new look.
    ticket: String,
}

pub(super) fn install(world: &mut World) {
    world.set_method_handle("platform.look.set", |world, id, payload| {
        const INTENT: &str = "look.set";
        let Some(p) = parse::<LookPayload>(world, id, INTENT, payload) else {
            return;
        };
        let verifier = world
            .ecs()
            .read_resource::<Gameplay>()
            .dimensions
            .tickets
            .clone();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        // Without tickets (insecure development) there is nothing to trust.
        let claims = verifier.and_then(|v| v.redeem(&p.ticket, now).ok());
        let Some(claims) = claims.filter(|c| c.sub == id) else {
            return reply(world, id, INTENT, Err(IntentError::BadTicket));
        };
        let look = Look::from_claim(claims.look.as_ref());
        wear(world, id, look.clone());
        reply(world, id, INTENT, Ok(json!({ "look": look })));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_are_checked_before_anyone_sees_them() {
        let good = json!({ "outfit": { "body": "#3d6b35", "arms": "#2F5229", "legs": "#5b4630" }, "hat": { "art": "crown" } });
        let look = Look::from_claim(Some(&good)).expect("well formed");
        assert_eq!(look.hat.unwrap().art.as_deref(), Some("crown"));
        assert_eq!(Look::from_claim(None), None);
        assert_eq!(Look::from_claim(Some(&json!(null))), None);
        assert_eq!(Look::from_claim(Some(&json!({}))), None, "nothing worn");
        let hat_only = json!({ "hat": { "color": "#c0392b" } });
        assert!(Look::from_claim(Some(&hat_only)).is_some_and(|l| l.outfit.is_none()));
        for bad in [
            json!({ "outfit": { "body": "red", "arms": "#000000", "legs": "#000000" } }),
            json!({ "outfit": { "body": "#00000g", "arms": "#000000", "legs": "#000000" } }),
            json!({ "hat": { "art": "<script>" } }),
            json!({ "hat": {} }),
            json!({ "hat": { "color": "#fff" } }),
            json!({ "cape": "#ffffff" }),
        ] {
            let parsed = Look::from_claim(Some(&bad));
            // Unknown fields are ignored; what is shown must be well formed.
            assert!(parsed.is_none(), "{bad} must be refused, got {parsed:?}");
        }
    }
}
