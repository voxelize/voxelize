//! Guild features in the world: town halls and guild vaults (placed on
//! guild land in a settlement), the town hall as a respawn point, and
//! fighting between players of guilds at war.

use platform_content::Dimension;
use platform_ticket::Realm;
use serde::Deserialize;
use serde_json::json;
use specs::WorldExt;
use voxelize::{ClientFilter, Event, World};

use super::bridge::Request;
use super::rules::IntentError;
use super::survival::{DamageKind, EYE_HEIGHT};
use super::{client_position, now_ms, parse, reply, send_inventory, Gameplay};

/// Sent to a member using a town hall: `{ "guild": { "id", "tag", "name" }, "home": bool }`.
pub const HALL_EVENT: &str = "platform.guild.hall";

/// Reach for hitting another player.
const REACH: f32 = 4.5;
const ATTACK_COOLDOWN: f32 = 0.5;

/// Who may place a guild block: town halls need a leader or officer, vaults
/// any member, both on guild land that is part of a settlement.
pub fn may_place(
    g: &Gameplay,
    player: &str,
    voxel: [i32; 3],
    block: &str,
) -> Result<(), IntentError> {
    let land = g
        .dimensions
        .land
        .read()
        .map_err(|_| IntentError::NotInSettlement)?;
    may_place_in(&land, g.dimensions.current, player, voxel, block)
}

pub fn may_place_in(
    land: &super::land::LandIndex,
    dimension: Dimension,
    player: &str,
    voxel: [i32; 3],
    block: &str,
) -> Result<(), IntentError> {
    let roles: &[&str] = match block {
        "guild_hall" => &["owner", "manager"],
        "guild_vault" => &["owner", "manager", "builder"],
        _ => return Ok(()),
    };
    let here = land
        .at(dimension, voxel[0], voxel[2])
        .filter(|l| l.guild.is_some())
        .filter(|l| l.settlement.as_ref().is_some_and(|s| s.level != "none"))
        .ok_or(IntentError::NotInSettlement)?;
    match here.role_of(player) {
        Some(role) if roles.contains(&role) => Ok(()),
        _ => Err(IntentError::NotOwner),
    }
}

/// Using a town hall: a member of its guild makes it their respawn point
/// (overworld halls only) and is shown the guild. Returns false when the
/// block is not a town hall.
pub fn use_hall(world: &mut World, id: &str, voxel: [i32; 3]) -> bool {
    const INTENT: &str = "use";
    let is_hall = {
        let g = world.ecs().read_resource::<Gameplay>();
        let block =
            voxelize::VoxelAccess::get_voxel(&*world.chunks(), voxel[0], voxel[1], voxel[2]);
        g.rules
            .content()
            .block_by_id(block)
            .is_some_and(|b| b.key == "guild_hall")
    };
    if !is_hall {
        return false;
    }
    let position = client_position(world, id);
    let result = {
        let mut g = world.ecs().write_resource::<Gameplay>();
        let reach = g.rules.reach;
        let dimension = g.dimensions.current;
        let close = position.is_some_and(|p| {
            (0..3)
                .map(|i| (voxel[i] as f32 + 0.5 - p[i]).powi(2))
                .sum::<f32>()
                <= reach * reach
        });
        let guild = g.dimensions.land.read().ok().and_then(|l| {
            l.at(dimension, voxel[0], voxel[2])
                .filter(|land| matches!(land.role_of(id), Some("owner" | "manager" | "builder")))
                .and_then(|land| land.guild.clone())
        });
        match (close, guild, g.players.get_mut(id)) {
            (_, _, None) => Err(IntentError::NothingThere),
            (false, _, _) => Err(IntentError::OutOfReach),
            (_, None, _) => Err(IntentError::NotOwner),
            (true, Some(guild), Some(player)) => {
                let home = dimension == Dimension::Overworld;
                if home {
                    player.home = Some([voxel[0], voxel[1] + 1, voxel[2]]);
                }
                Ok((guild, home))
            }
        }
    };
    match result {
        Ok((guild, home)) => {
            super::persist(world, id);
            let payload = json!({ "guild": { "id": guild.id, "tag": guild.tag, "name": guild.name }, "home": home });
            reply(world, id, INTENT, Ok(payload.clone()));
            world.events_mut().dispatch(
                Event::new(HALL_EVENT)
                    .payload(payload)
                    .filter(ClientFilter::Direct(id.to_owned()))
                    .build(),
            );
        }
        Err(e) => reply(world, id, INTENT, Err(e)),
    }
    true
}

/// Where a respawning player appears: their town hall, if it still stands
/// (an unloaded hall is trusted until it is seen gone).
pub fn respawn_home(world: &mut World, id: &str) -> Option<[i32; 3]> {
    let home = {
        let g = world.ecs().read_resource::<Gameplay>();
        if g.dimensions.current != Dimension::Overworld {
            return None;
        }
        g.players.get(id)?.home?
    };
    let below = voxelize::VoxelAccess::get_voxel(&*world.chunks(), home[0], home[1] - 1, home[2]);
    let mut g = world.ecs().write_resource::<Gameplay>();
    let hall = g.rules.content().block("guild_hall").map(|b| b.id);
    // Air means the chunk is not loaded here; anything else but a hall: gone.
    if below != 0 && Some(below) != hall {
        if let Some(p) = g.players.get_mut(id) {
            p.home = None;
        }
        return None;
    }
    Some(home)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlayerTarget {
    player: String,
}

pub(super) fn install(world: &mut World) {
    world.set_method_handle("platform.attack.player", |world, id, payload| {
        const INTENT: &str = "attack.player";
        let Some(p) = parse::<PlayerTarget>(world, id, INTENT, payload) else {
            return;
        };
        let (Some(eye), Some(target)) = (
            client_position(world, id),
            client_position(world, &p.player),
        ) else {
            return reply(world, id, INTENT, Err(IntentError::NothingThere));
        };
        let world_name;
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            world_name = g
                .dimensions
                .world_of(g.dimensions.current)
                .map(str::to_owned);
            let at_war = p.player != id
                && g.dimensions
                    .guilds
                    .read()
                    .is_ok_and(|index| index.at_war(id, &p.player));
            let content = g.rules.content_arc();
            let Gameplay {
                players,
                store,
                drops,
                rng,
                ..
            } = &mut *g;
            let attacker_ok = players.get(id).map(|a| {
                (
                    a.realm == Realm::Survival,
                    a.vitals.is_dead(),
                    a.attack_cooldown,
                )
            });
            let victim_ok = players
                .get(&p.player)
                .map(|v| (v.realm == Realm::Survival, v.vitals.is_dead()));
            // The victim's body centre.
            let center = [target[0], target[1] - EYE_HEIGHT + 0.9, target[2]];
            let d2: f32 = (0..3).map(|i| (center[i] - eye[i]).powi(2)).sum();
            match (attacker_ok, victim_ok) {
                (None, _) | (_, None) => Err(IntentError::NothingThere),
                (Some((_, true, _)), _) => Err(IntentError::Dead),
                (Some((false, _, _)), _) | (_, Some((false, _))) => Err(IntentError::SurvivalOnly),
                (_, Some((_, true))) => Err(IntentError::NothingThere),
                _ if !at_war => Err(IntentError::NotAtWar),
                _ if d2 > (REACH + 1.0).powi(2) => Err(IntentError::OutOfReach),
                (Some((_, _, cooldown)), _) if cooldown > 0.0 => Err(IntentError::TooFast),
                _ => {
                    let attacker = players.get_mut(id).expect("checked");
                    attacker.attack_cooldown = ATTACK_COOLDOWN;
                    let weapon = attacker
                        .inventory
                        .selected_stack()
                        .and_then(|s| content.item_by_id(s.item))
                        .and_then(|i| i.tool.clone());
                    let damage = weapon
                        .as_ref()
                        .map(|t| t.attack_damage.max(1.0))
                        .unwrap_or(1.0);
                    if weapon.is_some() {
                        attacker.inventory.wear_selected();
                    }
                    let victim = players.get_mut(&p.player).expect("checked");
                    victim.vitals.damage(damage);
                    let killed = victim.vitals.is_dead();
                    let vitals = super::vitals_payload(victim, Some(DamageKind::Player));
                    let mut events = Vec::new();
                    events.push(
                        Event::new(super::VITALS_EVENT)
                            .payload(vitals)
                            .filter(ClientFilter::Direct(p.player.clone()))
                            .build(),
                    );
                    if killed {
                        let mut death_events = voxelize::Events::new();
                        super::on_player_death(
                            &p.player,
                            victim,
                            target,
                            store,
                            drops,
                            rng,
                            &mut death_events,
                        );
                        events.extend(death_events.queue);
                    }
                    Ok((damage, killed, events))
                }
            }
        };
        match result {
            Ok((damage, killed, events)) => {
                for e in events {
                    world.events_mut().dispatch(e);
                }
                if killed {
                    let bridge = world
                        .ecs()
                        .read_resource::<Gameplay>()
                        .dimensions
                        .bridge
                        .clone();
                    if let (Some(bridge), Some(world_name)) = (bridge, world_name) {
                        bridge.request(Request::WarKill {
                            world: world_name,
                            key: format!(
                                "k{:x}{}",
                                now_ms(),
                                &p.player[p.player.len().saturating_sub(8)..]
                            ),
                            killer: id.to_owned(),
                            victim: p.player.clone(),
                        });
                    }
                }
                reply(
                    world,
                    id,
                    INTENT,
                    Ok(json!({ "player": p.player, "damage": damage, "killed": killed })),
                );
                send_inventory(world, id);
            }
            Err(e) => reply(world, id, INTENT, Err(e)),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::land::{Feed, LandIndex};

    #[test]
    fn guild_blocks_need_a_settlement_and_a_role() {
        let index = LandIndex::from_feed(
            serde_json::from_value::<Feed>(json!({
                "world": "main",
                "lands": [{
                    "id": "V", "dimension": "overworld", "min": [0, 0], "max": [1, 1],
                    "owner": { "id": "lead" },
                    "guild": { "id": "G", "name": "Wardens", "tag": "WW" },
                    "settlement": { "name": "Wardens", "level": "village" },
                    "members": [{ "id": "off", "role": "manager" }, { "id": "mem", "role": "builder" }, { "id": "ally", "role": "visitor" }]
                }, {
                    "id": "O", "dimension": "overworld", "min": [5, 5], "max": [5, 5],
                    "owner": { "id": "lead" },
                    "guild": { "id": "G", "name": "Wardens", "tag": "WW" },
                    "members": [{ "id": "mem", "role": "builder" }]
                }]
            }))
            .unwrap(),
        );
        let check = |player: &str, at: [i32; 3], block: &str| {
            may_place_in(&index, Dimension::Overworld, player, at, block)
        };
        assert_eq!(check("off", [3, 64, 3], "guild_hall"), Ok(()));
        assert_eq!(
            check("mem", [3, 64, 3], "guild_hall"),
            Err(IntentError::NotOwner)
        );
        assert_eq!(check("mem", [3, 64, 3], "guild_vault"), Ok(()));
        assert_eq!(
            check("ally", [3, 64, 3], "guild_vault"),
            Err(IntentError::NotOwner)
        );
        assert_eq!(
            check("lead", [85, 64, 85], "guild_vault"),
            Err(IntentError::NotInSettlement),
            "an outpost"
        );
        assert_eq!(
            check("lead", [300, 64, 0], "guild_hall"),
            Err(IntentError::NotInSettlement)
        );
    }
}
