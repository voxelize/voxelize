//! Guild features in the world: town halls and guild vaults (placed on
//! guild land in a settlement), the town hall as a respawn point, and
//! fighting between players of guilds at war.

use platform_content::Dimension;
use platform_ticket::Realm;
use serde::Deserialize;
use serde_json::json;
use specs::WorldExt;
use voxelize::{ClientFilter, Event, World};

use std::path::{Path, PathBuf};

use serde::Serialize;
use voxelize::{Chunks, PositionComp, Vec3, VoxelAccess};

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

/// Progress of the sieges near a player: `{ "at", "land", "attacker", "progress", "needed", "contested" }`.
pub const SIEGE_EVENT: &str = "platform.siege";
/// Blocks from the banner within which attackers hold it and defenders contest it.
pub const SIEGE_RADIUS: f32 = 12.0;

/// A siege banner on enemy guild land.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Siege {
    /// Capture key: the backend counts each siege once.
    pub id: String,
    pub at: [i32; 3],
    pub land: String,
    pub attacker_guild: String,
    pub defender_guild: String,
    /// The player who raised the banner (reported as the attacker).
    pub player: String,
    /// Seconds the banner has held.
    pub progress: f32,
    /// Sent to the backend, waiting for its answer.
    #[serde(default)]
    pub reported: bool,
}

/// This world's sieges, saved in `sieges.json`.
#[derive(Debug, Default)]
pub struct Sieges {
    path: Option<PathBuf>,
    pub list: Vec<Siege>,
}

impl Sieges {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let path = dir.join("sieges.json");
        let list = match std::fs::read(&path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display()))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        Ok(Self {
            path: Some(path),
            list,
        })
    }

    pub fn save(&self) {
        let Some(path) = &self.path else { return };
        let write = || -> std::io::Result<()> {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let tmp = path.with_extension("json.tmp");
            std::fs::write(
                &tmp,
                serde_json::to_vec(&self.list).expect("sieges serialize"),
            )?;
            std::fs::rename(tmp, path)
        };
        if let Err(e) = write() {
            log::error!("could not save sieges: {e}");
        }
    }
}

/// Whether `player` may raise a siege banner at `voxel`: on land of a guild
/// theirs is fighting, where no siege stands yet. Returns the siege to start.
pub fn may_siege(
    land: &super::land::LandIndex,
    guilds: &super::guilds::GuildIndex,
    sieges: &[Siege],
    dimension: Dimension,
    player: &str,
    voxel: [i32; 3],
) -> Result<Siege, IntentError> {
    let mine = guilds.guild_of(player).ok_or(IntentError::NotAtWar)?;
    let here = land
        .at(dimension, voxel[0], voxel[2])
        .ok_or(IntentError::NotAtWar)?;
    let defender = here.guild.as_ref().ok_or(IntentError::NotAtWar)?;
    if !mine.wars.contains(&defender.id) {
        return Err(IntentError::NotAtWar);
    }
    if sieges.iter().any(|s| s.land == here.id) {
        return Err(IntentError::SiegeUnderway);
    }
    Ok(Siege {
        id: format!("siege-{}-{}-{}-{}", here.id, voxel[0], voxel[1], voxel[2]),
        at: voxel,
        land: here.id.clone(),
        attacker_guild: mine.id.clone(),
        defender_guild: defender.id.clone(),
        player: player.to_owned(),
        progress: 0.0,
        reported: false,
    })
}

/// One step of a siege: the banner holds while its guild's players are
/// near and no defender is; returns whether it is contested.
pub fn advance(siege: &mut Siege, attackers_near: usize, defenders_near: usize, dt: f32) -> bool {
    let contested = defenders_near > 0;
    if attackers_near > 0 && !contested {
        siege.progress += dt;
    }
    contested
}

/// Keeps sieges going: drops those whose banner fell or whose war ended,
/// advances the rest, tells players near a banner how it stands and asks
/// the backend for the land once a banner has held long enough.
#[derive(Default)]
pub struct SiegeSystem {
    last: Option<std::time::Instant>,
    since_notice: f32,
}

impl<'a> specs::System<'a> for SiegeSystem {
    type SystemData = (
        specs::ReadExpect<'a, Chunks>,
        specs::ReadExpect<'a, voxelize::WorldConfig>,
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (chunks, config, clients, positions, mut g, mut events): Self::SystemData) {
        let chunk_size = config.chunk_size;
        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0)
            .min(0.5);
        self.last = Some(now);
        if g.sieges.list.is_empty() {
            return;
        }
        self.since_notice += dt;
        let notify = self.since_notice >= 2.0;
        if notify {
            self.since_notice = 0.0;
        }
        let Some(banner) = g.rules.content().block("siege_banner").map(|b| b.id) else {
            return;
        };
        let needed = g.dimensions.siege_seconds;
        let world_name = g
            .dimensions
            .world_of(g.dimensions.current)
            .map(str::to_owned);
        let bridge = g.dimensions.bridge.clone();
        let guilds = g.dimensions.guilds.clone();
        let Ok(index) = guilds.read() else { return };
        let bodies: Vec<(String, [f32; 3], bool)> = clients
            .iter()
            .filter_map(|(id, c)| {
                let p = positions.get(c.entity)?;
                let alive = g
                    .players
                    .get(id)
                    .is_some_and(|s| s.realm == Realm::Survival && !s.vitals.is_dead());
                Some((id.clone(), [p.0 .0, p.0 .1, p.0 .2], alive))
            })
            .collect();
        let mut changed = false;
        let Gameplay { sieges, .. } = &mut *g;
        sieges.list.retain(|s| {
            let [x, y, z] = s.at;
            let coords = voxelize::ChunkUtils::map_voxel_to_chunk(x, y, z, chunk_size);
            // An unloaded banner is left alone; a fallen one ends the siege.
            let fallen = chunks.is_chunk_ready(&coords) && chunks.get_voxel(x, y, z) != banner;
            let war_over = !index
                .guild_of(&s.player)
                .is_some_and(|g| g.id == s.attacker_guild && g.wars.contains(&s.defender_guild));
            let keep = s.reported || !(fallen || war_over);
            changed |= !keep;
            keep
        });
        for siege in sieges.list.iter_mut().filter(|s| !s.reported) {
            let center = [
                siege.at[0] as f32 + 0.5,
                siege.at[1] as f32 + 0.5,
                siege.at[2] as f32 + 0.5,
            ];
            let near = |guild: &str| {
                bodies
                    .iter()
                    .filter(|(id, p, alive)| {
                        *alive
                            && index.is_member(id, guild)
                            && (0..3).map(|i| (p[i] - center[i]).powi(2)).sum::<f32>()
                                <= SIEGE_RADIUS * SIEGE_RADIUS
                    })
                    .count()
            };
            let (attackers, defenders) = (near(&siege.attacker_guild), near(&siege.defender_guild));
            let contested = advance(siege, attackers, defenders, dt);
            if notify {
                let payload = json!({
                    "at": siege.at, "land": siege.land, "attacker": siege.attacker_guild,
                    "progress": siege.progress, "needed": needed, "contested": contested,
                });
                for (id, p, _) in &bodies {
                    if (0..3).map(|i| (p[i] - center[i]).powi(2)).sum::<f32>() <= 32.0 * 32.0 {
                        events.dispatch(
                            Event::new(SIEGE_EVENT)
                                .payload(payload.clone())
                                .filter(ClientFilter::Direct(id.clone()))
                                .build(),
                        );
                    }
                }
            }
            if siege.progress >= needed {
                if let (Some(bridge), Some(world)) = (&bridge, &world_name) {
                    siege.reported = true;
                    changed = true;
                    bridge.request(Request::Capture {
                        world: world.clone(),
                        key: siege.id.clone(),
                        attacker: siege.player.clone(),
                        land: siege.land.clone(),
                    });
                }
            }
        }
        if changed {
            sieges.save();
        }
    }
}

/// The backend's answer to a capture: the banner is spent on success.
pub fn on_captured(
    g: &mut Gameplay,
    chunks: &mut Chunks,
    events: &mut voxelize::Events,
    key: &str,
    outcome: Option<Result<(), String>>,
) {
    let Some(i) = g.sieges.list.iter().position(|s| s.id == key) else {
        return;
    };
    match outcome {
        None => {
            // Not sent: ask again on a later tick.
            g.sieges.list[i].reported = false;
            g.sieges.list[i].progress = g.dimensions.siege_seconds;
        }
        Some(result) => {
            let siege = g.sieges.list.remove(i);
            if result.is_ok() {
                chunks.update_voxel(&Vec3(siege.at[0], siege.at[1], siege.at[2]), 0);
            }
            let payload = match &result {
                Ok(()) => {
                    json!({ "captured": siege.land, "by": siege.attacker_guild, "at": siege.at })
                }
                Err(code) => json!({ "failed": siege.land, "code": code, "at": siege.at }),
            };
            events.dispatch_near(
                Event::new(SIEGE_EVENT).payload(payload).build(),
                [siege.at[0] as f32, siege.at[1] as f32, siege.at[2] as f32],
                48.0,
            );
        }
    }
    g.sieges.save();
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
                    let damage = attacker.vitals.melee(
                        weapon
                            .as_ref()
                            .map(|t| t.attack_damage.max(1.0))
                            .unwrap_or(1.0),
                    );
                    if weapon.is_some() {
                        attacker.inventory.wear_selected();
                    }
                    let victim = players.get_mut(&p.player).expect("checked");
                    let damage = super::rules::absorb(&content, victim, damage);
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

    #[test]
    fn sieges_need_war_hold_and_no_defenders() {
        let land = LandIndex::from_feed(
            serde_json::from_value::<Feed>(json!({
                "world": "main",
                "lands": [{
                    "id": "K", "dimension": "overworld", "min": [0, 0], "max": [0, 0],
                    "owner": { "id": "ann" }, "guild": { "id": "A", "name": "Alpha", "tag": "AA" }
                }, {
                    "id": "P", "dimension": "overworld", "min": [4, 4], "max": [4, 4], "owner": { "id": "carl" }
                }]
            }))
            .unwrap(),
        );
        let guilds =
            crate::gameplay::guilds::GuildIndex::from_feed(crate::gameplay::guilds::GuildFeed {
                guilds: vec![
                    crate::gameplay::guilds::GuildInfo {
                        id: "A".into(),
                        tag: "AA".into(),
                        name: "Alpha".into(),
                        members: vec!["ann".into()],
                        allies: vec![],
                        wars: vec!["B".into()],
                    },
                    crate::gameplay::guilds::GuildInfo {
                        id: "B".into(),
                        tag: "BB".into(),
                        name: "Bravo".into(),
                        members: vec!["bob".into()],
                        allies: vec![],
                        wars: vec!["A".into()],
                    },
                    crate::gameplay::guilds::GuildInfo {
                        id: "C".into(),
                        tag: "CC".into(),
                        name: "Charlie".into(),
                        members: vec!["cat".into()],
                        allies: vec![],
                        wars: vec![],
                    },
                ],
            });
        let o = Dimension::Overworld;
        let mut siege = may_siege(&land, &guilds, &[], o, "bob", [3, 64, 3]).unwrap();
        assert_eq!(
            (
                siege.land.as_str(),
                siege.attacker_guild.as_str(),
                siege.defender_guild.as_str()
            ),
            ("K", "B", "A")
        );
        assert_eq!(
            may_siege(&land, &guilds, &[siege.clone()], o, "bob", [5, 64, 5]),
            Err(IntentError::SiegeUnderway),
            "one siege per land"
        );
        assert_eq!(
            may_siege(&land, &guilds, &[], o, "cat", [3, 64, 3]),
            Err(IntentError::NotAtWar),
            "not at war"
        );
        assert_eq!(
            may_siege(&land, &guilds, &[], o, "bob", [70, 64, 70]),
            Err(IntentError::NotAtWar),
            "a player's own plot"
        );
        assert_eq!(
            may_siege(&land, &guilds, &[], o, "bob", [300, 64, 0]),
            Err(IntentError::NotAtWar),
            "wilderness"
        );
        assert_eq!(
            may_siege(&land, &guilds, &[], o, "ann", [3, 64, 3]),
            Err(IntentError::NotAtWar),
            "their own land"
        );

        assert!(!advance(&mut siege, 1, 0, 2.0));
        assert!(advance(&mut siege, 2, 1, 5.0), "a defender contests");
        advance(&mut siege, 0, 0, 5.0);
        assert_eq!(
            siege.progress, 2.0,
            "held only while attackers stand by, uncontested"
        );
    }
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
