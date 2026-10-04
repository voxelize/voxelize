//! Engine wiring for creatures: the per-tick mob system, attack and feed
//! intents, damage to players, drops, and persistence of animals.

use std::fs;
use std::io::Write;
use std::path::Path;

use platform_content::{MobKind, ToolKind};
use platform_ticket::Realm;
use serde::Deserialize;
use serde_json::{json, Value};
use specs::WorldExt;
use voxelize::{ClientFilter, Event, PositionComp, VoxelAccess, World};

use super::combat::{knockback, Shooter};
use super::inventory::Stack;
use super::mobs::{Mob, MobEvent, MobWorld, Mobs, PlayerInfo};
use super::rules::IntentError;
use super::survival::{DamageKind, EYE_HEIGHT};
use super::{client_position, not_joined, parse, persist, reply, send_inventory, Gameplay};

pub const MOBS_EVENT: &str = "platform.mobs";
const REACH: f32 = 4.5;
const ATTACK_COOLDOWN: f32 = 0.5;

/// Animals persist; monsters are recreated by the night.
pub(super) fn load(world_dir: &Path) -> Result<Mobs, String> {
    let path = world_dir.join("mobs.json");
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Mobs::default()),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let list: Vec<Mob> =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let next_id = list.iter().map(|m| m.id).max().unwrap_or(0);
    Ok(Mobs { list, next_id })
}

fn save(g: &Gameplay) -> Result<(), String> {
    let content = g.rules.content();
    let animals: Vec<&Mob> = g
        .mobs
        .list
        .iter()
        .filter(|m| {
            content
                .mob(&m.key)
                .is_some_and(|d| d.kind != MobKind::Hostile)
        })
        .collect();
    let bytes = serde_json::to_vec(&animals).map_err(|e| e.to_string())?;
    let path = g.world_dir.join("mobs.json");
    let tmp = path.with_extension("json.tmp");
    fs::create_dir_all(&g.world_dir).map_err(|e| e.to_string())?;
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, &path)
    })();
    result.map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

struct EngineMobWorld<'a> {
    chunks: &'a voxelize::Chunks,
    content: &'a platform_content::Content,
    chunk_size: usize,
    max_height: i32,
    day: bool,
    biome: &'a (dyn Fn(i32, i32) -> String + Send + Sync),
}

impl EngineMobWorld<'_> {
    fn ready(&self, x: i32, z: i32) -> bool {
        self.chunks
            .is_chunk_ready(&voxelize::ChunkUtils::map_voxel_to_chunk(
                x,
                0,
                z,
                self.chunk_size,
            ))
    }
}

impl MobWorld for EngineMobWorld<'_> {
    fn block(&self, x: i32, y: i32, z: i32) -> u32 {
        if y < 0 || y >= self.max_height || !self.ready(x, z) {
            return 0;
        }
        self.chunks.get_voxel(x, y, z)
    }
    fn solid(&self, x: i32, y: i32, z: i32) -> bool {
        if y < 0 {
            return true;
        }
        if !self.ready(x, z) {
            return true; // unloaded ground holds creatures still
        }
        let id = self.block(x, y, z);
        self.content
            .block_by_id(id)
            .is_some_and(|b| b.collision && b.fluid.is_none())
    }
    fn water(&self, x: i32, y: i32, z: i32) -> bool {
        let id = self.block(x, y, z);
        self.content
            .block_by_id(id)
            .is_some_and(|b| b.fluid == Some(platform_content::FluidKind::Water))
    }
    fn heat(&self, x: i32, y: i32, z: i32) -> f32 {
        match self.content.block_by_id(self.block(x, y, z)) {
            Some(b) if b.fluid == Some(platform_content::FluidKind::Lava) => 4.0,
            Some(b) if b.key == "fire" => 1.0,
            _ => 0.0,
        }
    }
    fn sky_light(&self, x: i32, y: i32, z: i32) -> u32 {
        if y >= self.max_height {
            return 15;
        }
        if !self.ready(x, z) {
            return 0;
        }
        self.chunks.get_sunlight(x, y, z)
    }
    fn block_light(&self, x: i32, y: i32, z: i32) -> u32 {
        if !self.ready(x, z) || y < 0 || y >= self.max_height {
            return 0;
        }
        self.chunks
            .get_red_light(x, y, z)
            .max(self.chunks.get_green_light(x, y, z))
            .max(self.chunks.get_blue_light(x, y, z))
    }
    fn is_day(&self) -> bool {
        self.day
    }
    fn biome(&self, x: i32, z: i32) -> Option<String> {
        Some((self.biome)(x, z))
    }
    fn loaded(&self, x: i32, z: i32) -> bool {
        self.ready(x, z)
    }
}

pub(super) fn mob_payload(m: &Mob) -> Value {
    json!({
        "id": m.id,
        "key": m.key,
        "p": m.position,
        "yaw": m.yaw,
        "health": m.health,
        "hurt": m.hurt_timer > 0.0,
        "baby": m.is_baby(),
        "moving": m.moving(),
        "love": m.love_timer > 0.0,
    })
}

#[derive(Default)]
pub struct MobSystem {
    last: Option<std::time::Instant>,
    since_spawn: f32,
    since_sent: f32,
    since_saved: f32,
}

impl<'a> specs::System<'a> for MobSystem {
    type SystemData = (
        specs::ReadExpect<'a, voxelize::Chunks>,
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadExpect<'a, voxelize::WorldConfig>,
        specs::ReadExpect<'a, voxelize::Stats>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(
        &mut self,
        (chunks, clients, config, stats, positions, mut g, mut events): Self::SystemData,
    ) {
        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0)
            .min(0.1);
        self.last = Some(now);
        if dt <= 0.0 {
            return;
        }
        let content = g.rules.content_arc();
        let fraction = (stats.time / config.time_per_day as f32).rem_euclid(1.0);
        // The undead do not burn under rain clouds.
        let day = (0.22..0.75).contains(&fraction) && !g.weather.raining();

        // Who is around, and what they hold.
        let mut players = Vec::new();
        let mut eyes = std::collections::HashMap::new();
        for (id, player) in g.players.iter_mut() {
            player.attack_cooldown = (player.attack_cooldown - dt).max(0.0);
            let Some(entity) = clients.get(id).map(|c| c.entity) else {
                continue;
            };
            let Some(p) = positions.get(entity).map(|p| [p.0 .0, p.0 .1, p.0 .2]) else {
                continue;
            };
            eyes.insert(id.clone(), p);
            let holding = player
                .inventory
                .selected_stack()
                .and_then(|s| content.item_by_id(s.item))
                .map(|i| i.key.clone());
            players.push(PlayerInfo {
                id: id.clone(),
                feet: [p[0], p[1] - EYE_HEIGHT, p[2]],
                holding,
                targetable: player.vulnerable() && !player.vitals.is_dead(),
            });
        }

        let biome = g.biome.clone();
        let view = EngineMobWorld {
            chunks: &chunks,
            content: &content,
            chunk_size: config.chunk_size,
            max_height: config.max_height as i32,
            day,
            biome: &*biome,
        };
        let Gameplay {
            mobs,
            mob_rng,
            players: states,
            drops,
            store,
            rng,
            combat,
            ..
        } = &mut *g;
        let mob_events = mobs.step(&content, &view, &players, dt, mob_rng);
        self.since_spawn += dt;
        if self.since_spawn >= 1.0 {
            self.since_spawn = 0.0;
            mobs.spawn_around(&content, &view, &players, mob_rng);
        }

        for event in mob_events {
            match event {
                MobEvent::Shoot {
                    mob,
                    from,
                    direction,
                    speed,
                } => {
                    combat.shoot(from, direction, speed, Shooter::Mob(mob), false);
                }
                MobEvent::Attack {
                    player,
                    damage,
                    from,
                    effect,
                    ..
                } => {
                    let Some(state) = states.get_mut(&player) else {
                        continue;
                    };
                    if state.vitals.is_dead() || !state.vulnerable() {
                        continue;
                    }
                    let damage = super::rules::absorb(&content, state, damage);
                    state.vitals.damage(damage);
                    if let Some(hit) = effect.filter(|_| !state.vitals.is_dead()) {
                        state
                            .vitals
                            .apply_effect(hit.effect, hit.level, hit.seconds);
                    }
                    if let Some(eye) = eyes.get(&player) {
                        knockback(&mut events, &player, from, *eye, 1.0);
                    }
                    events.dispatch(
                        Event::new(super::VITALS_EVENT)
                            .payload(super::vitals_payload(state, Some(DamageKind::Mob)))
                            .filter(ClientFilter::Direct(player.clone()))
                            .build(),
                    );
                    if state.vitals.is_dead() {
                        let eye = eyes.get(&player).copied().unwrap_or([0.0, 80.0, 0.0]);
                        super::on_player_death(&player, state, eye, store, drops, rng, &mut events);
                    }
                }
                MobEvent::Died {
                    key,
                    position,
                    baby,
                    ..
                } => {
                    if baby {
                        continue;
                    }
                    let Some(def) = content.mob(&key) else {
                        continue;
                    };
                    for drop in &def.drops {
                        *rng = rng
                            .wrapping_mul(6364136223846793005)
                            .wrapping_add(1442695040888963407);
                        let roll = (*rng >> 11) as f64 / (1u64 << 53) as f64;
                        if roll >= drop.chance as f64 {
                            continue;
                        }
                        let span = drop.max - drop.min + 1;
                        let count = drop.min + ((*rng >> 7) % span as u64) as u32;
                        let Some(item) = content.item(&drop.item) else {
                            continue;
                        };
                        if count > 0 {
                            drops.spawn(
                                Stack {
                                    item: item.id,
                                    count,
                                    durability: item.durability,
                                },
                                [position[0], position[1] + 0.5, position[2]],
                                [0.0, 3.0, 0.0],
                                None,
                            );
                        }
                    }
                }
                MobEvent::Born { .. } => {}
            }
        }

        // Nearby creatures, ten times a second.
        self.since_sent += dt;
        if self.since_sent >= 0.1 {
            self.since_sent = 0.0;
            for client in clients.values() {
                let Some(p) = positions.get(client.entity) else {
                    continue;
                };
                let near: Vec<Value> = mobs
                    .list
                    .iter()
                    .filter(|m| {
                        (m.position[0] - p.0 .0).abs() < 64.0
                            && (m.position[2] - p.0 .2).abs() < 64.0
                    })
                    .map(mob_payload)
                    .collect();
                events.dispatch(
                    Event::new(MOBS_EVENT)
                        .payload(json!({ "mobs": near }))
                        .filter(ClientFilter::Direct(client.id.clone()))
                        .build(),
                );
            }
        }

        self.since_saved += dt;
        if self.since_saved >= 30.0 {
            self.since_saved = 0.0;
            if let Err(e) = save(&g) {
                log::error!("could not save mobs: {e}");
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MobPayload {
    mob: u64,
}

/// Whether the claim a creature stands in keeps `player` from hurting it:
/// animals (passive and neutral creatures) on land whose public permissions
/// do not allow it, for anyone but its owner and builders.
pub(super) fn animal_protected(
    g: &Gameplay,
    content: &platform_content::Content,
    player: &str,
    mob: u64,
) -> bool {
    let Some(m) = g.mobs.list.iter().find(|m| m.id == mob) else {
        return false;
    };
    if content
        .mob(&m.key)
        .is_none_or(|d| d.kind == MobKind::Hostile)
    {
        return false;
    }
    let cell = [
        m.position[0].floor() as i32,
        m.position[1].floor() as i32,
        m.position[2].floor() as i32,
    ];
    let here = g.dimensions.current;
    g.dimensions
        .land
        .read()
        .map(|index| !index.allows(here, player, cell, super::land::Action::Animals))
        .unwrap_or(true)
}

/// Trade with a villager: hand over an offer's `take` for its `give`, all
/// or nothing (the result must fit in the inventory).
pub fn npc_trade(
    content: &platform_content::Content,
    player: &mut super::rules::PlayerState,
    offer: &platform_content::TradeOfferDef,
) -> Result<(), IntentError> {
    super::rules::active(player)?;
    let id = |key: &str| {
        content
            .item(key)
            .map(|i| i.id)
            .ok_or(IntentError::UnknownItem)
    };
    let mut after = player.inventory.clone();
    for t in &offer.take {
        let item = id(&t.item)?;
        if after.count_of(item) < t.count {
            return Err(IntentError::MissingIngredients);
        }
        after.remove(item, t.count);
    }
    if after.add(content, id(&offer.give.item)?, offer.give.count) > 0 {
        return Err(IntentError::InventoryFull);
    }
    player.inventory = after;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NpcTradePayload {
    mob: u64,
    offer: usize,
}

pub(super) fn install(world: &mut World) {
    world.set_method_handle("platform.npc.trade", |world, id, payload| {
        const INTENT: &str = "npc.trade";
        let Some(p) = parse::<NpcTradePayload>(world, id, INTENT, payload) else {
            return;
        };
        let Some(eye) = client_position(world, id) else {
            return not_joined(world, id, INTENT);
        };
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let content = g.rules.content_arc();
            let Gameplay { players, mobs, .. } = &mut *g;
            let mob = mobs.list.iter().find(|m| m.id == p.mob).cloned();
            match (players.get_mut(id), mob) {
                (None, _) => Err(IntentError::NothingThere),
                (Some(_), None) => Err(IntentError::NothingThere),
                (Some(player), Some(mob)) => {
                    let d2: f32 = (0..3).map(|i| (mob.position[i] - eye[i]).powi(2)).sum();
                    let offer = content.mob(&mob.key).and_then(|d| d.trades.get(p.offer));
                    match offer {
                        None => Err(IntentError::CannotUse),
                        Some(_) if d2 > (REACH + 2.0).powi(2) => Err(IntentError::OutOfReach),
                        Some(offer) => npc_trade(&content, player, offer)
                            .map(|_| json!({ "mob": p.mob, "offer": p.offer, "got": offer.give })),
                    }
                }
            }
        };
        reply(world, id, INTENT, result);
        send_inventory(world, id);
        persist(world, id);
    });

    world.set_method_handle("platform.attack", |world, id, payload| {
        const INTENT: &str = "attack";
        let Some(p) = parse::<MobPayload>(world, id, INTENT, payload) else { return };
        let Some(eye) = client_position(world, id) else { return not_joined(world, id, INTENT) };
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let content = g.rules.content_arc();
            let protected = animal_protected(&g, &content, id, p.mob);
            let Gameplay { players, mobs, .. } = &mut *g;
            match (players.get_mut(id), mobs.list.iter().find(|m| m.id == p.mob).cloned()) {
                (None, _) => None,
                (Some(_), None) => Some(Err(IntentError::NothingThere)),
                (Some(_), Some(_)) if protected => Some(Err(IntentError::LandProtected)),
                (Some(player), Some(mob)) => {
                    let height = content.mob(&mob.key).map(|d| d.size[1]).unwrap_or(1.0);
                    let center = [mob.position[0], mob.position[1] + height / 2.0, mob.position[2]];
                    let d2: f32 = (0..3).map(|i| (center[i] - eye[i]).powi(2)).sum();
                    if let Err(e) = super::rules::active(player) {
                        Some(Err(e))
                    } else if d2 > (REACH + height).powi(2) {
                        Some(Err(IntentError::OutOfReach))
                    } else if player.attack_cooldown > 0.0 {
                        Some(Err(IntentError::TooFast))
                    } else {
                        player.attack_cooldown = ATTACK_COOLDOWN;
                        let weapon = player
                            .inventory
                            .selected_stack()
                            .and_then(|s| content.item_by_id(s.item))
                            .and_then(|i| i.tool.clone());
                        let damage = player.vitals.melee(weapon.as_ref().map(|t| t.attack_damage.max(1.0)).unwrap_or(1.0));
                        if weapon.is_some_and(|t| t.kind == ToolKind::Sword || t.attack_damage > 1.0) {
                            player.inventory.wear_selected();
                        }
                        let died = mobs.hurt(&content, p.mob, damage, Some(id), Some(eye));
                        // The killer earns the creature's experience (not for babies).
                        if died && player.realm == Realm::Survival && !mob.is_baby() {
                            if let Some(def) = content.mob(&mob.key) {
                                player.xp = player.xp.saturating_add(def.experience());
                            }
                            player.note(platform_content::TriggerKind::Kill, &mob.key, 1);
                        }
                        let health = mobs.list.iter().find(|m| m.id == p.mob).map(|m| m.health);
                        Some(Ok(json!({ "mob": p.mob, "damage": damage, "health": health, "killed": died })))
                    }
                }
            }
        };
        match result {
            None => not_joined(world, id, INTENT),
            Some(r) => {
                let killed = r.as_ref().is_ok_and(|v| v["killed"] == true);
                reply(world, id, INTENT, r);
                send_inventory(world, id);
                if killed {
                    super::send_vitals(world, id, None);
                }
            }
        }
    });

    world.set_method_handle("platform.interact", |world, id, payload| {
        const INTENT: &str = "interact";
        let Some(p) = parse::<MobPayload>(world, id, INTENT, payload) else {
            return;
        };
        let Some(eye) = client_position(world, id) else {
            return not_joined(world, id, INTENT);
        };
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let content = g.rules.content_arc();
            let Gameplay { players, mobs, .. } = &mut *g;
            let Some(player) = players.get_mut(id) else {
                drop(g);
                return not_joined(world, id, INTENT);
            };
            let mob = mobs.list.iter().find(|m| m.id == p.mob).cloned();
            match mob {
                None => Err(IntentError::NothingThere),
                Some(mob) => {
                    let d2: f32 = (0..3).map(|i| (mob.position[i] - eye[i]).powi(2)).sum();
                    let held = player
                        .inventory
                        .selected_stack()
                        .and_then(|s| content.item_by_id(s.item))
                        .map(|i| i.key.clone());
                    let trades = content
                        .mob(&mob.key)
                        .filter(|d| !d.trades.is_empty())
                        .map(|d| (d.name.clone(), d.trades.clone()));
                    if let Err(e) = super::rules::active(player) {
                        Err(e)
                    } else if d2 > (REACH + 2.0).powi(2) {
                        Err(IntentError::OutOfReach)
                    } else if let Some((name, trades)) = trades {
                        // A villager: show what it sells.
                        Ok(json!({ "mob": p.mob, "name": name, "trades": trades }))
                    } else if let Some(item) = held.filter(|item| mobs.feed(&content, p.mob, item))
                    {
                        if player.realm == Realm::Survival {
                            let slot = player.inventory.selected;
                            let _ = player.inventory.take_one(slot);
                        }
                        Ok(json!({ "mob": p.mob, "fed": item }))
                    } else {
                        Err(IntentError::CannotUse)
                    }
                }
            }
        };
        reply(world, id, INTENT, result);
        send_inventory(world, id);
        persist(world, id);
    });
}

/// Using a summoning item on one of its blocks calls up its creature above
/// the block (one of a kind within 64 blocks). Returns whether the held item
/// summons something, in which case the intent has been answered.
pub(super) fn summon(world: &mut World, id: &str, voxel: [i32; 3]) -> bool {
    const INTENT: &str = "use";
    let Some(eye) = client_position(world, id) else {
        return false;
    };
    let block = world.chunks().get_voxel(voxel[0], voxel[1], voxel[2]);
    let result = {
        let mut g = world.ecs().write_resource::<Gameplay>();
        let content = g.rules.content_arc();
        let Gameplay { players, mobs, .. } = &mut *g;
        let Some(player) = players.get_mut(id) else {
            return false;
        };
        let held = player
            .inventory
            .selected_stack()
            .and_then(|s| content.item_by_id(s.item))
            .map(|i| i.key.clone());
        let Some(def) = held.and_then(|item| {
            content
                .mobs()
                .iter()
                .find(|m| m.summon.as_ref().is_some_and(|s| s.item == item))
        }) else {
            return false;
        };
        let summon = def.summon.as_ref().expect("found by summon");
        let at = [
            voxel[0] as f32 + 0.5,
            voxel[1] as f32 + 1.0,
            voxel[2] as f32 + 0.5,
        ];
        let d2: f32 = (0..3).map(|i| (at[i] - eye[i]).powi(2)).sum();
        let on_altar = content
            .block_by_id(block)
            .is_some_and(|b| summon.on.contains(&b.key));
        let already = mobs.list.iter().any(|m| {
            m.key == def.key
                && (m.position[0] - at[0]).abs() < 64.0
                && (m.position[2] - at[2]).abs() < 64.0
        });
        if let Err(e) = super::rules::active(player) {
            Err(e)
        } else if d2 > (REACH + 1.0).powi(2) {
            Err(IntentError::OutOfReach)
        } else if !on_altar || already {
            Err(IntentError::CannotUse)
        } else {
            if player.realm == Realm::Survival {
                let slot = player.inventory.selected;
                let _ = player.inventory.take_one(slot);
            }
            let key = def.key.clone();
            match mobs.spawn(&content, &key, at, false) {
                Some(mob) => Ok(json!({ "voxel": voxel, "summoned": key, "mob": mob })),
                None => Err(IntentError::CannotUse),
            }
        }
    };
    reply(world, id, INTENT, result);
    send_inventory(world, id);
    persist(world, id);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::inventory::Inventory;
    use crate::gameplay::rules::PlayerState;
    use crate::gameplay::survival::Vitals;

    #[test]
    fn villagers_trade_all_or_nothing() {
        let c = platform_content::Content::load(platform_content::default_pack_dir()).unwrap();
        let farmer = c.mob("village_farmer").unwrap();
        let sell_wheat = &farmer.trades[0];
        assert_eq!(sell_wheat.take[0].item, "wheat");
        let mut p = PlayerState::new(Inventory::default(), Realm::Survival, Vitals::default());
        let wheat = c.item("wheat").unwrap().id;
        let gold = c.item("gold_ingot").unwrap().id;
        p.inventory.add(&c, wheat, 19);
        assert_eq!(
            npc_trade(&c, &mut p, sell_wheat),
            Err(IntentError::MissingIngredients)
        );
        assert_eq!(p.inventory.count_of(wheat), 19, "nothing taken");
        p.inventory.add(&c, wheat, 5);
        npc_trade(&c, &mut p, sell_wheat).unwrap();
        assert_eq!(
            (p.inventory.count_of(wheat), p.inventory.count_of(gold)),
            (4, 1)
        );
        // Buying bread with that gold.
        npc_trade(&c, &mut p, &farmer.trades[3]).unwrap();
        assert_eq!(p.inventory.count_of(gold), 0);
        assert_eq!(p.inventory.count_of(c.item("bread").unwrap().id), 6);
    }
}
