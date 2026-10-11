//! Virtue in play: deeds in Paradise change a player's virtue; they are
//! told at once, everyone sees titles on name tags, and a new level is
//! announced in Paradise. Guardians and above are kept in regeneration
//! there; the Divine may fly (the anti-cheat lets them hover). Healing:
//! `platform.bless { player }` pours the held bottle of honey over a hurt
//! player within reach.

use platform_content::{Dimension, EffectKind};
use serde::Deserialize;
use serde_json::{json, Value};
use specs::WorldExt;
use voxelize::{ClientFilter, Clients, Event, PositionComp, World};

use super::rules::{IntentError, PlayerState};
use super::virtue::{title_of, Deed, DIVINE, GUARDIAN, SAINT};
use super::{parse, persist, reply, send_inventory, send_vitals, Gameplay};

/// To the player: `{ "points", "level", "title", "toNext", "builtToday", "helpedToday",
/// "buildCap", "helpCap", "divine" }`; to everyone: `{ "players": [{ "id", "level", "title", "glow" }] }`.
pub const VIRTUE_EVENT: &str = "platform.virtue";
/// How far a blessing reaches, in blocks.
pub const BLESS_REACH: f32 = 5.0;

/// A change in someone's virtue, to tell about.
#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub player: String,
    pub delta: i64,
    pub before: i8,
    pub after: i8,
}

/// Weigh a deed by `id`, if this world is Paradise and they play there in
/// survival (creative builders earn nothing).
pub fn deed_in(g: &mut Gameplay, id: &str, deed: Deed) -> Option<Change> {
    if g.dimensions.current != Dimension::Paradise {
        return None;
    }
    let player = g.players.get_mut(id)?;
    if player.realm != platform_ticket::Realm::Survival {
        return None;
    }
    let before = player.virtue.level();
    let delta = player.virtue.record(deed, super::virtue::today());
    let after = player.virtue.level();
    Some(Change {
        player: id.to_owned(),
        delta,
        before,
        after,
    })
}

/// Weigh a deed and tell about it.
pub fn deed(world: &mut World, id: &str, deed: Deed) {
    let change = deed_in(&mut world.ecs().write_resource::<Gameplay>(), id, deed);
    if let Some(change) = change {
        announce(world, &change);
    }
}

fn own_payload(g: &Gameplay, id: &str) -> Value {
    let Some(p) = g.players.get(id) else {
        return json!(null);
    };
    let v = &p.virtue;
    let level = v.level();
    json!({
        "points": v.points,
        "level": level,
        "title": title_of(level),
        "toNext": v.to_next(),
        "builtToday": v.built_today,
        "helpedToday": v.helped_today,
        "buildCap": super::virtue::BUILD_CAP,
        "helpCap": super::virtue::HELP_CAP,
        "divine": level >= DIVINE,
    })
}

fn tag(id: &str, level: i8) -> Value {
    json!({ "id": id, "level": level, "title": title_of(level), "glow": level >= SAINT })
}

/// Tell the player their virtue; on a new level, tell everyone their title
/// and announce it in chat.
pub fn announce(world: &mut World, change: &Change) {
    let own = own_payload(&world.ecs().read_resource::<Gameplay>(), &change.player);
    super::send(world, &change.player, VIRTUE_EVENT, own);
    if change.before == change.after {
        return;
    }
    world.events_mut().dispatch(
        Event::new(VIRTUE_EVENT)
            .payload(json!({ "players": [tag(&change.player, change.after)] }))
            .filter(ClientFilter::All)
            .build(),
    );
    let name = world
        .read_resource::<Clients>()
        .get(&change.player)
        .map(|c| c.username.clone())
        .unwrap_or_else(|| change.player.clone());
    if change.after > change.before {
        bestow(world, &change.player, change.after);
    }
    let line = if change.after > change.before {
        if change.after >= DIVINE {
            format!("✦ {name} has reached the Divine. ✦")
        } else {
            format!("✦ {name} rises to {}.", title_of(change.after))
        }
    } else {
        format!("{name} falls to {}.", title_of(change.after))
    };
    world.events_mut().dispatch(
        Event::new(super::chat::CHAT_EVENT)
            .payload(json!({ "channel": "system", "from": null, "to": null, "body": line }))
            .filter(ClientFilter::All)
            .build(),
    );
}

/// A level reached: it counts as a milestone, and the gifts of levels
/// reached for the first time go into the inventory (what does not fit
/// falls at the player's feet); the player is told what they received.
fn bestow(world: &mut World, id: &str, level: i8) {
    let at = super::client_position(world, id);
    let gifts = {
        let mut g = world.ecs().write_resource::<Gameplay>();
        let content = g.rules.content_arc();
        let Some(player) = g.players.get_mut(id) else {
            return;
        };
        player.note(
            platform_content::TriggerKind::Reach,
            &super::virtue::milestone_of(level),
            1,
        );
        let mut given = Vec::new();
        let mut overflow = Vec::new();
        for due in player.virtue.take_blessings() {
            for (key, count) in super::virtue::GIFTS[due as usize] {
                let Some(item) = content.item(key) else {
                    continue;
                };
                let left = player.inventory.add(&content, item.id, *count);
                if left > 0 {
                    overflow.push(super::inventory::Stack {
                        item: item.id,
                        count: left,
                        durability: item.durability,
                    });
                }
                given.push(json!({ "item": key, "name": item.name, "count": count }));
            }
        }
        if let Some(at) = at {
            super::items_api::spill_at(&mut g, overflow, at, Some(id));
        }
        given
    };
    if !gifts.is_empty() {
        super::send(
            world,
            id,
            VIRTUE_EVENT,
            json!({ "blessing": { "level": level, "title": title_of(level), "gifts": gifts } }),
        );
        send_inventory(world, id);
        persist(world, id);
    }
}

/// A joining player learns their virtue and everyone's titles; everyone
/// learns theirs.
pub fn on_join(world: &mut World, id: &str) {
    let (own, all, mine) = {
        let g = world.ecs().read_resource::<Gameplay>();
        let all: Vec<Value> = g
            .players
            .iter()
            .map(|(pid, p)| tag(pid, p.virtue.level()))
            .collect();
        let mine = g.players.get(id).map(|p| tag(id, p.virtue.level()));
        (own_payload(&g, id), all, mine)
    };
    super::send(world, id, VIRTUE_EVENT, own);
    super::send(world, id, VIRTUE_EVENT, json!({ "players": all }));
    // The level they stand at counts as reached (earlier players catch up).
    if world.ecs().read_resource::<Gameplay>().dimensions.current == Dimension::Paradise {
        let mut g = world.ecs().write_resource::<Gameplay>();
        if let Some(p) = g.players.get_mut(id) {
            let level = p.virtue.level();
            p.note(
                platform_content::TriggerKind::Reach,
                &super::virtue::milestone_of(level),
                1,
            );
        }
    }
    if let Some(mine) = mine {
        world.events_mut().dispatch(
            Event::new(VIRTUE_EVENT)
                .payload(json!({ "players": [mine] }))
                .filter(ClientFilter::All)
                .build(),
        );
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BlessPayload {
    player: String,
}

pub(super) fn install(world: &mut World) {
    world.set_method_handle("platform.bless", |world, id, payload| {
        const INTENT: &str = "bless";
        let Some(p) = parse::<BlessPayload>(world, id, INTENT, payload) else {
            return;
        };
        let (me, them) = {
            let clients = world.read_resource::<Clients>();
            let positions = world.read_component::<PositionComp>();
            let at = |pid: &str| {
                clients
                    .get(pid)
                    .and_then(|c| positions.get(c.entity))
                    .map(|q| [q.0 .0, q.0 .1, q.0 .2])
            };
            (at(id), at(&p.player))
        };
        let (Some(me), Some(them)) = (me, them) else {
            return reply(world, id, INTENT, Err(IntentError::NothingThere));
        };
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            bless(&mut g, id, &p.player, me, them)
        };
        match result {
            Err(e) => reply(world, id, INTENT, Err(e)),
            Ok(change) => {
                reply(world, id, INTENT, Ok(json!({ "player": p.player })));
                send_inventory(world, id);
                send_vitals(world, &p.player, None);
                persist(world, id);
                persist(world, &p.player);
                if let Some(change) = change {
                    announce(world, &change);
                }
            }
        }
    });
}

/// Pour the held bottle of honey over `target`: they heal and regenerate,
/// the bottle comes back empty, and the healer gains virtue in Paradise.
pub fn bless(
    g: &mut Gameplay,
    id: &str,
    target: &str,
    me: [f32; 3],
    them: [f32; 3],
) -> Result<Option<Change>, IntentError> {
    if id == target {
        return Err(IntentError::CannotUse);
    }
    let d = (0..3)
        .map(|i| (me[i] - them[i]).powi(2))
        .sum::<f32>()
        .sqrt();
    if d > BLESS_REACH {
        return Err(IntentError::OutOfReach);
    }
    let content = g.rules.content_arc();
    let mut target_state = g.players.remove(target).ok_or(IntentError::NothingThere)?;
    let poured = match g.players.get_mut(id) {
        Some(healer) => pour_honey(&content, healer, &mut target_state),
        None => Err(IntentError::NothingThere),
    };
    g.players.insert(target.to_owned(), target_state);
    poured?;
    Ok(deed_in(g, id, Deed::Healed))
}

/// The healer's held honey heals a hurt, living target; the bottle comes
/// back empty.
pub fn pour_honey(
    content: &platform_content::Content,
    healer: &mut PlayerState,
    target: &mut PlayerState,
) -> Result<(), IntentError> {
    let (Some(honey), Some(glass)) = (content.item("honey_bottle"), content.item("glass_bottle"))
    else {
        return Err(IntentError::CannotUse);
    };
    if healer.vitals.is_dead() {
        return Err(IntentError::Dead);
    }
    let slot = healer.inventory.selected;
    if healer.inventory.get(slot).map(|s| s.item) != Some(honey.id) {
        return Err(IntentError::CannotUse);
    }
    if target.vitals.is_dead() || target.vitals.health >= super::survival::MAX_HEALTH {
        return Err(IntentError::NothingThere);
    }
    healer.inventory.take_one(slot)?;
    healer.inventory.add(content, glass.id, 1);
    target.vitals.apply_effect(EffectKind::Healing, 1, 0.0);
    target
        .vitals
        .apply_effect(EffectKind::Regeneration, 1, 10.0);
    Ok(())
}

/// Guardians and above stay in regeneration while in Paradise.
#[derive(Default)]
pub struct VirtueSystem {
    last: Option<std::time::Instant>,
    since: f32,
}

impl<'a> specs::System<'a> for VirtueSystem {
    type SystemData = (
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (mut g, mut events): Self::SystemData) {
        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0);
        self.last = Some(now);
        self.since += dt;
        if self.since < 3.0 || g.dimensions.current != Dimension::Paradise {
            return;
        }
        self.since = 0.0;
        for (id, p) in g.players.iter_mut() {
            if p.virtue.level() < GUARDIAN || p.vitals.is_dead() {
                continue;
            }
            p.vitals.apply_effect(EffectKind::Regeneration, 0, 5.0);
            events.dispatch(
                Event::new(super::VITALS_EVENT)
                    .payload(super::vitals_payload(p, None))
                    .filter(ClientFilter::Direct(id.clone()))
                    .build(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::inventory::Inventory;
    use crate::gameplay::survival::{Vitals, MAX_HEALTH};
    use platform_ticket::Realm;

    #[test]
    fn honey_heals_the_hurt_and_the_bottle_comes_back() {
        let c = platform_content::Content::load(platform_content::default_pack_dir()).unwrap();
        let mut healer = PlayerState::new(Inventory::default(), Realm::Survival, Vitals::default());
        let mut target = PlayerState::new(Inventory::default(), Realm::Survival, Vitals::default());
        let honey = c.item("honey_bottle").unwrap().id;
        let glass = c.item("glass_bottle").unwrap().id;
        assert_eq!(
            pour_honey(&c, &mut healer, &mut target),
            Err(IntentError::CannotUse),
            "no honey in hand"
        );
        healer.inventory.add(&c, honey, 2);
        healer.inventory.select(0).unwrap();
        assert_eq!(
            pour_honey(&c, &mut healer, &mut target),
            Err(IntentError::NothingThere),
            "a whole player needs no healing"
        );
        target.vitals.health = 6.0;
        pour_honey(&c, &mut healer, &mut target).unwrap();
        assert_eq!(target.vitals.health, 14.0, "healed at once");
        assert_eq!(target.vitals.effect(EffectKind::Regeneration), Some(1));
        assert_eq!(healer.inventory.count_of(honey), 1);
        assert_eq!(healer.inventory.count_of(glass), 1);
        assert!(target.vitals.health < MAX_HEALTH);
    }
}
