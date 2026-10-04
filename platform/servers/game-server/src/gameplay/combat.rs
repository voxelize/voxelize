//! Ranged and explosive combat: blast charges and their explosions, and
//! arrows shot from bows (by players, and by archer creatures).
//!
//! A blast charge set off (fire striker, fire, another explosion) leaves its
//! block and burns a fuse; its explosion breaks blocks around it by their
//! blast resistance (never containers, never on land the one who lit it may
//! not build on), drops some of them, sets off other charges, and hurts and
//! pushes bodies nearby through their armor. Arrows fly under gravity; they
//! hit creatures, players (from a player only when their guilds are at war;
//! from a creature always) or stick into blocks, where a player's arrow can
//! be picked up again.

use platform_ticket::Realm;
use serde::{Deserialize, Serialize};
use serde_json::json;
use specs::WorldExt;
use voxelize::{Chunks, ClientFilter, Event, PositionComp, Vec3, VoxelAccess, World};

use super::inventory::Stack;
use super::rules::IntentError;
use super::survival::{DamageKind, EYE_HEIGHT};
use super::{client_position, now_ms, parse, reply, send_inventory, Gameplay};

/// What players near fuses and arrows see: `{ "fuses": [{ "at", "fuse" }], "arrows": [{ "id", "pos", "vel" }] }`.
pub const COMBAT_EVENT: &str = "platform.combat";
/// An explosion: `{ "at", "power" }`.
pub const EXPLOSION_EVENT: &str = "platform.explosion";
/// Pushes the player's body: `{ "velocity": [x, y, z] }`.
pub const PUSH_EVENT: &str = "platform.push";

/// Seconds a lit blast charge burns before it goes off.
pub const FUSE_SECONDS: f32 = 4.0;
/// Explosion power of a blast charge (its radius in blocks).
pub const BLAST_POWER: f32 = 4.0;
/// Arrow speed at a full draw, blocks per second, and gravity.
pub const ARROW_SPEED: f32 = 45.0;
pub const GRAVITY: f32 = 20.0;
/// Milliseconds to draw a bow fully.
pub const FULL_DRAW_MS: u64 = 1000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Fuse {
    pub at: [f32; 3],
    pub fuse: f32,
    /// The player who lit it, whose land rights bound the damage to blocks.
    pub by: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Shooter {
    Player(String),
    Mob(u64),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Arrow {
    pub id: u64,
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    pub shooter: Shooter,
    /// Becomes an arrow item where it lands (shot by a survival player).
    pub pickup: bool,
    pub age: f32,
}

/// Fuses and arrows of one world.
#[derive(Debug, Default)]
pub struct Combat {
    pub fuses: Vec<Fuse>,
    pub arrows: Vec<Arrow>,
    pub next_arrow: u64,
}

impl Combat {
    pub fn shoot(
        &mut self,
        from: [f32; 3],
        direction: [f32; 3],
        speed: f32,
        shooter: Shooter,
        pickup: bool,
    ) -> u64 {
        let len = (direction[0].powi(2) + direction[1].powi(2) + direction[2].powi(2))
            .sqrt()
            .max(1e-6);
        let d = [direction[0] / len, direction[1] / len, direction[2] / len];
        self.next_arrow += 1;
        self.arrows.push(Arrow {
            id: self.next_arrow,
            pos: [
                from[0] + d[0] * 0.6,
                from[1] + d[1] * 0.6,
                from[2] + d[2] * 0.6,
            ],
            vel: [d[0] * speed, d[1] * speed, d[2] * speed],
            shooter,
            pickup,
            age: 0.0,
        });
        self.next_arrow
    }
}

/// Damage an arrow does at `speed` (9 at a full draw).
pub fn arrow_damage(speed: f32) -> f32 {
    (speed * 0.2).ceil().max(1.0)
}

/// Damage to a body `distance` blocks from an explosion of `power`.
pub fn blast_damage(power: f32, distance: f32) -> f32 {
    let reach = power * 2.0;
    if distance >= reach {
        return 0.0;
    }
    let f = 1.0 - distance / reach;
    f * f * 6.0 * power
}

/// The cells an explosion at `center` breaks: those whose blast resistance
/// (`resist`, `None` for air and unbreakable cells) the blast overcomes at
/// their distance, with some randomness at the edge.
pub fn blast_cells(
    center: [f32; 3],
    power: f32,
    resist: impl Fn([i32; 3]) -> Option<f32>,
    mut random: impl FnMut() -> f32,
) -> Vec<[i32; 3]> {
    let r = power.ceil() as i32;
    let c = [
        center[0].floor() as i32,
        center[1].floor() as i32,
        center[2].floor() as i32,
    ];
    let mut out = Vec::new();
    for dx in -r..=r {
        for dy in -r..=r {
            for dz in -r..=r {
                let p = [c[0] + dx, c[1] + dy, c[2] + dz];
                let d = (((p[0] as f32 + 0.5 - center[0]).powi(2)
                    + (p[1] as f32 + 0.5 - center[1]).powi(2)
                    + (p[2] as f32 + 0.5 - center[2]).powi(2)) as f32)
                    .sqrt();
                if d > power {
                    continue;
                }
                let Some(resistance) = resist(p) else {
                    continue;
                };
                let force = power * (0.7 + 0.6 * random()) - d * 0.75;
                if force > (resistance + 0.3) * 0.3 {
                    out.push(p);
                }
            }
        }
    }
    out
}

/// Light the blast charge at `at` (its block is removed by the caller).
pub fn prime(g: &mut Gameplay, at: [i32; 3], fuse: f32, by: Option<String>) {
    g.combat.fuses.push(Fuse {
        at: [at[0] as f32 + 0.5, at[1] as f32 + 0.5, at[2] as f32 + 0.5],
        fuse,
        by,
    });
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ShootPayload {
    direction: [f32; 3],
}

pub(super) fn install(world: &mut World) {
    // Raising a bow starts the draw; the server times it.
    world.set_method_handle("platform.bow.draw", |world, id, _| {
        const INTENT: &str = "bow.draw";
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let bow = g.rules.content().item("bow").map(|i| i.id);
            match g.players.get_mut(id) {
                None => Err(IntentError::NothingThere),
                Some(p) if super::rules::active(p).is_err() => {
                    super::rules::active(p).map(|_| unreachable!())
                }
                Some(p) if p.inventory.selected_stack().map(|s| s.item) != bow => {
                    Err(IntentError::CannotUse)
                }
                Some(p) => {
                    p.bow_drawn = Some(now_ms());
                    Ok(json!({}))
                }
            }
        };
        reply(world, id, INTENT, result);
    });

    world.set_method_handle("platform.bow.shoot", |world, id, payload| {
        const INTENT: &str = "bow.shoot";
        let Some(p) = parse::<ShootPayload>(world, id, INTENT, payload) else {
            return;
        };
        let Some(eye) = client_position(world, id) else {
            return reply(world, id, INTENT, Err(IntentError::NothingThere));
        };
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let content = g.rules.content_arc();
            let (bow, arrow) = (
                content.item("bow").map(|i| i.id),
                content.item("arrow").map(|i| i.id),
            );
            let shot = match g.players.get_mut(id) {
                None => Err(IntentError::NothingThere),
                Some(pl) if super::rules::active(pl).is_err() => {
                    super::rules::active(pl).map(|_| unreachable!())
                }
                Some(pl) if pl.inventory.selected_stack().map(|s| s.item) != bow => {
                    Err(IntentError::CannotUse)
                }
                Some(pl) => match pl.bow_drawn.take() {
                    None => Err(IntentError::CannotUse),
                    Some(started) => {
                        let charge = (now_ms().saturating_sub(started) as f32
                            / FULL_DRAW_MS as f32)
                            .min(1.0);
                        let survival = pl.realm == Realm::Survival;
                        if charge < 0.1 {
                            Err(IntentError::TooFast)
                        } else if survival && !arrow.is_some_and(|a| pl.inventory.remove(a, 1)) {
                            Err(IntentError::NoArrows)
                        } else {
                            if survival {
                                pl.inventory.wear_selected();
                            }
                            Ok((charge, survival))
                        }
                    }
                },
            };
            shot.map(|(charge, survival)| {
                let speed = ARROW_SPEED * charge;
                let arrow = g.combat.shoot(
                    eye,
                    p.direction,
                    speed,
                    Shooter::Player(id.to_owned()),
                    survival,
                );
                json!({ "arrow": arrow, "charge": charge })
            })
        };
        let ok = result.is_ok();
        reply(world, id, INTENT, result);
        if ok {
            send_inventory(world, id);
        }
    });
}

/// Blocks no explosion breaks (they hold items or are buildings).
fn blast_proof(key: &str) -> bool {
    matches!(
        key,
        "chest" | "furnace" | "trade_stall" | "guild_vault" | "guild_hall" | "anvil"
    )
}

/// Runs fuses, explosions and arrows, and tells nearby players about them.
#[derive(Default)]
pub struct CombatSystem {
    last: Option<std::time::Instant>,
    since_sync: f32,
    synced_something: bool,
}

impl<'a> specs::System<'a> for CombatSystem {
    type SystemData = (
        specs::WriteExpect<'a, Chunks>,
        specs::ReadExpect<'a, voxelize::WorldConfig>,
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(
        &mut self,
        (mut chunks, config, clients, positions, mut g, mut events): Self::SystemData,
    ) {
        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0)
            .min(0.25);
        self.last = Some(now);
        let content = g.rules.content_arc();

        // Charges set off by fire.
        for at in g.broken.drain_primed() {
            prime(&mut g, at, FUSE_SECONDS, None);
        }

        let bodies: Vec<(String, [f32; 3])> = clients
            .iter()
            .filter_map(|(id, c)| {
                positions
                    .get(c.entity)
                    .map(|p| (id.clone(), [p.0 .0, p.0 .1, p.0 .2]))
            })
            .collect();
        let solid = |chunks: &Chunks, p: [i32; 3]| {
            content
                .block_by_id(chunks.get_voxel(p[0], p[1], p[2]))
                .is_some_and(|b| b.collision && b.fluid.is_none())
        };

        // Fuses.
        let mut due = Vec::new();
        g.combat.fuses.retain_mut(|f| {
            f.fuse -= dt;
            if f.fuse <= 0.0 {
                due.push(f.clone());
                false
            } else {
                true
            }
        });
        for fuse in due {
            explode(
                &mut g,
                &mut chunks,
                &bodies,
                &mut events,
                fuse.at,
                BLAST_POWER,
                fuse.by.clone(),
                config.chunk_size,
            );
        }

        // Arrows, in short steps so they do not pass through thin things.
        let arrows = std::mem::take(&mut g.combat.arrows);
        let mut flying = Vec::new();
        'arrows: for mut a in arrows {
            let mut left = dt;
            while left > 0.0 {
                let step = left.min(0.02);
                left -= step;
                a.age += step;
                a.vel[1] -= GRAVITY * step;
                let next = [
                    a.pos[0] + a.vel[0] * step,
                    a.pos[1] + a.vel[1] * step,
                    a.pos[2] + a.vel[2] * step,
                ];
                let speed = (a.vel[0].powi(2) + a.vel[1].powi(2) + a.vel[2].powi(2)).sqrt();
                // Creatures.
                let hit_mob = g
                    .mobs
                    .list
                    .iter()
                    .find(|m| {
                        if a.shooter == Shooter::Mob(m.id) {
                            return false;
                        }
                        let size = content.mob(&m.key).map(|d| d.size).unwrap_or([0.6, 1.8]);
                        (next[0] - m.position[0]).abs() < size[0] / 2.0 + 0.1
                            && (next[2] - m.position[2]).abs() < size[0] / 2.0 + 0.1
                            && next[1] >= m.position[1]
                            && next[1] <= m.position[1] + size[1]
                    })
                    .map(|m| (m.id, m.key.clone()));
                if let Some((mob, key)) = hit_mob {
                    let by = match &a.shooter {
                        Shooter::Player(p) => Some(p.clone()),
                        Shooter::Mob(_) => None,
                    };
                    let died = g.mobs.hurt(
                        &content,
                        mob,
                        arrow_damage(speed),
                        by.as_deref(),
                        Some(a.pos),
                    );
                    if let (true, Some(player)) = (died, by.as_ref()) {
                        if let (Some(def), Some(state)) =
                            (content.mob(&key), g.players.get_mut(player))
                        {
                            if state.realm == Realm::Survival {
                                state.xp = state.xp.saturating_add(def.experience());
                            }
                        }
                    }
                    continue 'arrows;
                }
                // Players.
                let hit_player = bodies
                    .iter()
                    .find(|(id, eye)| {
                        if a.shooter == Shooter::Player(id.clone()) {
                            return false;
                        }
                        let feet = eye[1] - EYE_HEIGHT;
                        (next[0] - eye[0]).abs() < 0.4
                            && (next[2] - eye[2]).abs() < 0.4
                            && next[1] >= feet
                            && next[1] <= feet + 1.8
                    })
                    .cloned();
                if let Some((victim, eye)) = hit_player {
                    let allowed = match &a.shooter {
                        Shooter::Mob(_) => true,
                        Shooter::Player(p) => g
                            .dimensions
                            .guilds
                            .read()
                            .is_ok_and(|i| i.at_war(p, &victim)),
                    };
                    if allowed {
                        hurt_player(
                            &mut g,
                            &mut events,
                            &victim,
                            eye,
                            arrow_damage(speed),
                            DamageKind::Arrow,
                        );
                        let back = [a.pos[0] - a.vel[0], a.pos[1], a.pos[2] - a.vel[2]];
                        knockback(&mut events, &victim, back, eye, 0.6);
                        continue 'arrows;
                    }
                }
                // Blocks: the arrow sticks; a player's arrow can be picked up.
                let cell = [
                    next[0].floor() as i32,
                    next[1].floor() as i32,
                    next[2].floor() as i32,
                ];
                if solid(&chunks, cell) {
                    if a.pickup {
                        if let Some(arrow) = content.item("arrow") {
                            g.drops.spawn(
                                Stack {
                                    item: arrow.id,
                                    count: 1,
                                    durability: None,
                                },
                                a.pos,
                                [0.0, 0.0, 0.0],
                                None,
                            );
                        }
                    }
                    continue 'arrows;
                }
                a.pos = next;
                if a.age > 30.0 || a.pos[1] < -64.0 {
                    continue 'arrows;
                }
            }
            flying.push(a);
        }
        g.combat.arrows = flying;

        // Tell players near anything in flight or burning, ten times a second.
        self.since_sync += dt;
        let busy = !g.combat.arrows.is_empty() || !g.combat.fuses.is_empty();
        if self.since_sync >= 0.1 && (busy || self.synced_something) {
            self.since_sync = 0.0;
            self.synced_something = busy;
            for (id, eye) in &bodies {
                let near = |p: [f32; 3]| {
                    (0..3).map(|i| (p[i] - eye[i]).powi(2)).sum::<f32>() < 96.0 * 96.0
                };
                let payload = json!({
                    "fuses": g.combat.fuses.iter().filter(|f| near(f.at)).map(|f| json!({ "at": f.at, "fuse": f.fuse })).collect::<Vec<_>>(),
                    "arrows": g.combat.arrows.iter().filter(|a| near(a.pos)).map(|a| json!({ "id": a.id, "pos": a.pos, "vel": a.vel })).collect::<Vec<_>>(),
                });
                events.dispatch(
                    Event::new(COMBAT_EVENT)
                        .payload(payload)
                        .filter(ClientFilter::Direct(id.clone()))
                        .build(),
                );
            }
        }
    }
}

/// Hurt a player through their armor; they die and spill as from any cause.
/// Knocks a player away from `from` (horizontal speed 7 × `strength`, with
/// a small hop), through [`PUSH_EVENT`].
pub(super) fn knockback(
    events: &mut voxelize::Events,
    victim: &str,
    from: [f32; 3],
    eye: [f32; 3],
    strength: f32,
) {
    let dx = eye[0] - from[0];
    let dz = eye[2] - from[2];
    let len = (dx * dx + dz * dz).sqrt();
    let (dx, dz) = if len < 1e-3 {
        (0.0, 0.0)
    } else {
        (dx / len, dz / len)
    };
    events.dispatch(
        Event::new(PUSH_EVENT)
            .payload(
                json!({ "velocity": [dx * 7.0 * strength, 4.0 * strength, dz * 7.0 * strength] }),
            )
            .filter(ClientFilter::Direct(victim.to_owned()))
            .build(),
    );
}

pub(super) fn hurt_player(
    g: &mut Gameplay,
    events: &mut voxelize::Events,
    victim: &str,
    eye: [f32; 3],
    damage: f32,
    cause: DamageKind,
) {
    let content = g.rules.content_arc();
    let Gameplay {
        players,
        store,
        drops,
        rng,
        ..
    } = g;
    let Some(state) = players.get_mut(victim) else {
        return;
    };
    if !state.vulnerable() || state.vitals.is_dead() || state.vitals.grace > 0.0 {
        return;
    }
    let damage = super::rules::absorb(&content, state, damage);
    state.vitals.damage(damage);
    events.dispatch(
        Event::new(super::VITALS_EVENT)
            .payload(super::vitals_payload(state, Some(cause)))
            .filter(ClientFilter::Direct(victim.to_owned()))
            .build(),
    );
    if state.vitals.is_dead() {
        super::on_player_death(victim, state, eye, store, drops, rng, events);
    }
}

#[allow(clippy::too_many_arguments)]
fn explode(
    g: &mut Gameplay,
    chunks: &mut Chunks,
    bodies: &[(String, [f32; 3])],
    events: &mut voxelize::Events,
    center: [f32; 3],
    power: f32,
    by: Option<String>,
    chunk_size: usize,
) {
    let content = g.rules.content_arc();
    let dimension = g.dimensions.current;
    let land = g.dimensions.land.clone();
    let blast = content.block("blast_charge").map(|b| b.id);
    let containers: std::collections::HashSet<[i32; 3]> =
        g.containers.map.keys().copied().collect();
    let resist = |p: [i32; 3]| -> Option<f32> {
        let coords = voxelize::ChunkUtils::map_voxel_to_chunk(p[0], p[1], p[2], chunk_size);
        if !chunks.is_chunk_ready(&coords) || containers.contains(&p) {
            return None;
        }
        let def = content.block_by_id(chunks.get_voxel(p[0], p[1], p[2]))?;
        if def.id == 0 || def.hardness < 0.0 || def.fluid.is_some() || blast_proof(&def.key) {
            return None;
        }
        // Claimed land breaks only for someone who may build there.
        let allowed = land
            .read()
            .is_ok_and(|l| match l.at(dimension, p[0], p[2]) {
                None => true,
                Some(claim) => by
                    .as_deref()
                    .is_some_and(|who| claim.allows(who, super::land::Action::Build)),
            });
        allowed.then_some(def.resistance)
    };
    let mut rolls = Vec::new();
    for _ in 0..512 {
        rolls.push(g.random() as f32);
    }
    let mut roll = rolls.into_iter().cycle();
    let cells = blast_cells(center, power, resist, || roll.next().unwrap_or(0.5));
    let mut writes = Vec::new();
    for p in cells {
        let id = chunks.get_voxel(p[0], p[1], p[2]);
        writes.push((Vec3(p[0], p[1], p[2]), 0u32));
        if Some(id) == blast {
            // Chained charges go off a little later.
            let fuse = 0.5 + g.random() as f32;
            prime(g, p, fuse, by.clone());
            continue;
        }
        // One block in `power` drops.
        if g.random() < 1.0 / power as f64 {
            if let Some(drop) = content
                .block_by_id(id)
                .and_then(|b| b.drops.first())
                .and_then(|d| content.item(&d.item))
            {
                g.drops.spawn(
                    Stack {
                        item: drop.id,
                        count: 1,
                        durability: drop.durability,
                    },
                    [p[0] as f32 + 0.5, p[1] as f32 + 0.5, p[2] as f32 + 0.5],
                    [0.0, 2.0, 0.0],
                    None,
                );
            }
        }
    }
    chunks.update_voxels(&writes);

    // Bodies: damage falls off with distance; the blast pushes them away.
    for (id, eye) in bodies {
        let body = [eye[0], eye[1] - EYE_HEIGHT + 0.9, eye[2]];
        let d = (0..3)
            .map(|i| (body[i] - center[i]).powi(2))
            .sum::<f32>()
            .sqrt();
        let damage = blast_damage(power, d);
        if damage <= 0.0 {
            continue;
        }
        hurt_player(g, events, id, *eye, damage, DamageKind::Explosion);
        let k = damage / (6.0 * power) * 12.0 / d.max(0.5);
        events.dispatch(
            Event::new(PUSH_EVENT)
                .payload(json!({ "velocity": [(body[0] - center[0]) * k, 4.0 + 6.0 * damage / (6.0 * power), (body[2] - center[2]) * k] }))
                .filter(ClientFilter::Direct(id.clone()))
                .build(),
        );
    }
    let hit: Vec<(u64, f32)> = g
        .mobs
        .list
        .iter()
        .map(|m| {
            let d = (0..3)
                .map(|i| (m.position[i] - center[i]).powi(2))
                .sum::<f32>()
                .sqrt();
            (m.id, blast_damage(power, d))
        })
        .filter(|(_, dmg)| *dmg > 0.0)
        .collect();
    for (mob, damage) in hit {
        g.mobs
            .hurt(&content, mob, damage, by.as_deref(), Some(center));
    }
    events.dispatch_near(
        Event::new(EXPLOSION_EVENT)
            .payload(json!({ "at": center, "power": power }))
            .build(),
        center,
        96.0,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explosions_break_by_resistance_and_hurt_by_distance() {
        // Dirt (0.5) all around, stone (6) beyond two blocks, bedrock below.
        let resist = |p: [i32; 3]| -> Option<f32> {
            if p[1] < -3 {
                return None;
            }
            let d = p[0].abs().max(p[1].abs()).max(p[2].abs());
            Some(if d <= 2 { 0.5 } else { 6.0 })
        };
        let cells = blast_cells([0.5, 0.5, 0.5], 4.0, resist, || 0.5);
        assert!(
            cells.contains(&[0, 0, 0]) && cells.contains(&[2, 0, 0]),
            "dirt near the centre goes"
        );
        assert!(!cells.contains(&[4, 0, 0]), "stone at the edge holds");
        assert!(cells.iter().all(|p| p[1] >= -3), "never the unbreakable");
        assert!(
            blast_damage(4.0, 0.0) > 20.0,
            "a body on the charge dies unarmored"
        );
        assert!(blast_damage(4.0, 4.0) < 7.0);
        assert_eq!(blast_damage(4.0, 8.0), 0.0);
        assert_eq!(arrow_damage(ARROW_SPEED), 9.0);
        assert_eq!(arrow_damage(4.0), 1.0);
    }

    #[test]
    fn arrows_leave_in_the_direction_aimed() {
        let mut c = Combat::default();
        let id = c.shoot(
            [0.0, 10.0, 0.0],
            [0.0, 0.0, 2.0],
            30.0,
            Shooter::Player("ann".into()),
            true,
        );
        assert_eq!(id, 1);
        let a = &c.arrows[0];
        assert!((a.vel[2] - 30.0).abs() < 1e-4 && a.vel[0].abs() < 1e-6);
        assert!((a.pos[2] - 0.6).abs() < 1e-4);
    }
}
