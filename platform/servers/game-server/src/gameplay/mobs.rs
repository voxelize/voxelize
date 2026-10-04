//! Creatures: physics against the voxel world, behaviour, breeding,
//! daylight burning, despawning and natural spawning. Pure logic over
//! [`MobWorld`]; `mobs_api.rs` connects it to the engine.
//!
//! Behaviour is a small utility state machine evaluated every tick:
//!
//! | kind | priority order |
//! | --- | --- |
//! | hostile | chase and attack the nearest survival player in sight → wander |
//! | neutral | like passive until hit, then like hostile towards the attacker |
//! | passive | flee after being hurt → seek a partner when fed → follow a player holding its food → wander / idle |

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

use platform_content::{Content, MobDef, MobKind, MobMovement, OnHitEffect, SpawnLight};
use serde::{Deserialize, Serialize};

const GRAVITY: f32 = 25.0;
const JUMP_SPEED: f32 = 7.5;
const BABY_SECONDS: f32 = 300.0;
const LOVE_SECONDS: f32 = 30.0;
const BREED_COOLDOWN: f32 = 300.0;
/// Seconds between path searches while chasing or following.
const REPATH_SECONDS: f32 = 1.0;
/// Cells A* may expand per search.
const PATH_NODES: usize = 600;
/// Bosses take this share of knockback.
const BOSS_KNOCKBACK: f32 = 0.15;

pub trait MobWorld {
    /// Block id at a voxel.
    fn block(&self, x: i32, y: i32, z: i32) -> u32;
    fn solid(&self, x: i32, y: i32, z: i32) -> bool;
    fn water(&self, x: i32, y: i32, z: i32) -> bool;
    /// Sky exposure 0..=15 at a voxel.
    fn sky_light(&self, x: i32, y: i32, z: i32) -> u32;
    /// Strongest block light 0..=15 at a voxel.
    fn block_light(&self, x: i32, y: i32, z: i32) -> u32;
    fn is_day(&self) -> bool;
    /// Biome key at a column, for spawn rules.
    fn biome(&self, x: i32, z: i32) -> Option<String>;
    /// Whether the column's chunk is loaded.
    fn loaded(&self, x: i32, z: i32) -> bool;
    /// Health per second a body loses in this cell (fire, lava).
    fn heat(&self, _x: i32, _y: i32, _z: i32) -> f32 {
        0.0
    }
}

#[derive(Debug, Clone)]
pub struct PlayerInfo {
    pub id: String,
    pub feet: [f32; 3],
    pub holding: Option<String>,
    /// Survival players are targets; creative ones are ignored.
    pub targetable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MobState {
    Idle,
    Wander,
    Flee,
    Follow,
    Chase,
    Mate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mob {
    pub id: u64,
    pub key: String,
    pub position: [f32; 3],
    #[serde(default)]
    pub velocity: [f32; 3],
    #[serde(default)]
    pub yaw: f32,
    pub health: f32,
    #[serde(default = "idle")]
    pub state: MobState,
    /// Player this mob is chasing (or fleeing from).
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub timer: f32,
    #[serde(default)]
    pub attack_timer: f32,
    #[serde(default)]
    pub hurt_timer: f32,
    #[serde(default)]
    pub love_timer: f32,
    #[serde(default)]
    pub breed_cooldown: f32,
    /// Negative while a baby; grows up at zero.
    #[serde(default)]
    pub age: f32,
    #[serde(default)]
    pub burn_timer: f32,
    #[serde(default)]
    pub on_ground: bool,
    /// Neutral mobs remember who hit them.
    #[serde(default)]
    pub angry_at: Option<String>,
    /// Seconds until a ranged creature may shoot again.
    #[serde(default)]
    pub shoot_timer: f32,
    /// Seconds a swimmer has spent out of water.
    #[serde(default)]
    pub dry_timer: f32,
    /// Cells still to walk to reach the goal (from A*).
    #[serde(skip)]
    pub path: Vec<[i32; 3]>,
    #[serde(skip)]
    pub repath: f32,
}

fn idle() -> MobState {
    MobState::Idle
}

impl Mob {
    pub fn is_baby(&self) -> bool {
        self.age < 0.0
    }

    pub fn moving(&self) -> bool {
        self.velocity[0].abs() + self.velocity[2].abs() > 0.1
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MobEvent {
    Attack {
        mob: u64,
        player: String,
        damage: f32,
        /// Where the blow came from, for knockback.
        from: [f32; 3],
        effect: Option<OnHitEffect>,
    },
    /// A ranged creature looses an arrow.
    Shoot {
        mob: u64,
        from: [f32; 3],
        direction: [f32; 3],
        speed: f32,
    },
    Died {
        mob: u64,
        key: String,
        position: [f32; 3],
        baby: bool,
    },
    Born {
        mob: u64,
    },
}

#[derive(Debug, Default)]
pub struct Mobs {
    pub list: Vec<Mob>,
    pub next_id: u64,
}

/// Small deterministic generator, so simulations replay in tests.
#[derive(Debug, Clone)]
pub struct Rng(pub u64);

impl Rng {
    pub fn next_f32(&mut self) -> f32 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.0 >> 40) as f32) / (1u64 << 24) as f32
    }

    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.next_f32()
    }
}

fn def<'a>(content: &'a Content, mob: &Mob) -> Option<&'a MobDef> {
    content.mob(&mob.key)
}

fn size(def: &MobDef, mob: &Mob) -> (f32, f32) {
    let scale = if mob.is_baby() { 0.5 } else { 1.0 };
    (def.size[0] * scale, def.size[1] * scale)
}

fn collides(world: &dyn MobWorld, p: [f32; 3], half: f32, height: f32) -> bool {
    let (x0, x1) = (
        (p[0] - half).floor() as i32,
        (p[0] + half - 0.001).floor() as i32,
    );
    let (y0, y1) = (p[1].floor() as i32, (p[1] + height - 0.001).floor() as i32);
    let (z0, z1) = (
        (p[2] - half).floor() as i32,
        (p[2] + half - 0.001).floor() as i32,
    );
    for x in x0..=x1 {
        for y in y0..=y1 {
            for z in z0..=z1 {
                if world.solid(x, y, z) {
                    return true;
                }
            }
        }
    }
    false
}

fn horizontal_distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

impl Mobs {
    pub fn spawn(
        &mut self,
        content: &Content,
        key: &str,
        position: [f32; 3],
        baby: bool,
    ) -> Option<u64> {
        let def = content.mob(key)?;
        self.next_id += 1;
        self.list.push(Mob {
            id: self.next_id,
            key: key.to_owned(),
            position,
            velocity: [0.0; 3],
            yaw: 0.0,
            health: def.health,
            state: MobState::Idle,
            target: None,
            timer: 0.0,
            attack_timer: 0.0,
            hurt_timer: 0.0,
            love_timer: 0.0,
            breed_cooldown: if baby { BREED_COOLDOWN } else { 0.0 },
            age: if baby { -BABY_SECONDS } else { 0.0 },
            burn_timer: 0.0,
            on_ground: false,
            angry_at: None,
            shoot_timer: 0.0,
            dry_timer: 0.0,
            path: Vec::new(),
            repath: 0.0,
        });
        Some(self.next_id)
    }

    pub fn get_mut(&mut self, id: u64) -> Option<&mut Mob> {
        self.list.iter_mut().find(|m| m.id == id)
    }

    /// A player hits a mob. Returns whether it died.
    pub fn hurt(
        &mut self,
        content: &Content,
        id: u64,
        damage: f32,
        from: Option<&str>,
        push_from: Option<[f32; 3]>,
    ) -> bool {
        let Some(mob) = self.get_mut(id) else {
            return false;
        };
        mob.health -= damage;
        mob.hurt_timer = 0.4;
        let push = if content.mob(&mob.key).is_some_and(|d| d.boss) {
            BOSS_KNOCKBACK
        } else {
            1.0
        };
        if let Some(src) = push_from {
            let dx = mob.position[0] - src[0];
            let dz = mob.position[2] - src[2];
            let len = (dx * dx + dz * dz).sqrt().max(0.01);
            mob.velocity[0] = dx / len * 6.0 * push;
            mob.velocity[2] = dz / len * 6.0 * push;
            mob.velocity[1] = 5.0 * push;
        }
        if let Some(def) = content.mob(&mob.key) {
            match def.kind {
                MobKind::Passive => {
                    mob.state = MobState::Flee;
                    mob.timer = 5.0;
                    mob.target = from.map(str::to_owned);
                }
                MobKind::Neutral => mob.angry_at = from.map(str::to_owned),
                MobKind::Hostile => mob.target = from.map(str::to_owned).or(mob.target.take()),
            }
        }
        mob.health <= 0.0
    }

    /// Feed a mob its breeding item. Returns whether it accepted.
    pub fn feed(&mut self, content: &Content, id: u64, item: &str) -> bool {
        let Some(mob) = self.get_mut(id) else {
            return false;
        };
        let Some(def) = content.mob(&mob.key) else {
            return false;
        };
        if def.breed_item.as_deref() != Some(item) {
            return false;
        }
        if mob.is_baby() {
            mob.age = (mob.age + BABY_SECONDS * 0.1).min(0.0); // feeding speeds growth
            return true;
        }
        if mob.breed_cooldown > 0.0 || mob.love_timer > 0.0 {
            return false;
        }
        mob.love_timer = LOVE_SECONDS;
        true
    }

    /// Advance every mob by `dt` seconds.
    pub fn step(
        &mut self,
        content: &Content,
        world: &dyn MobWorld,
        players: &[PlayerInfo],
        dt: f32,
        rng: &mut Rng,
    ) -> Vec<MobEvent> {
        let mut events = Vec::new();
        let snapshot: Vec<(u64, String, [f32; 3], bool, bool)> = self
            .list
            .iter()
            .map(|m| {
                (
                    m.id,
                    m.key.clone(),
                    m.position,
                    m.love_timer > 0.0 && !m.is_baby(),
                    m.is_baby(),
                )
            })
            .collect();
        let mut births: Vec<(String, [f32; 3])> = Vec::new();

        for mob in &mut self.list {
            let Some(def) = def(content, mob) else {
                mob.health = 0.0;
                continue;
            };
            let (width, height) = size(def, mob);
            let half = width / 2.0;
            for t in [
                &mut mob.timer,
                &mut mob.attack_timer,
                &mut mob.hurt_timer,
                &mut mob.love_timer,
                &mut mob.breed_cooldown,
                &mut mob.shoot_timer,
                &mut mob.repath,
            ] {
                *t = (*t - dt).max(0.0);
            }
            if mob.age < 0.0 {
                mob.age = (mob.age + dt).min(0.0);
            }

            // Burning in daylight under open sky.
            let head = [
                mob.position[0].floor() as i32,
                (mob.position[1] + height).floor() as i32,
                mob.position[2].floor() as i32,
            ];
            let in_water = world.water(head[0], mob.position[1].floor() as i32, head[2]);
            let feet = [head[0], mob.position[1].floor() as i32, head[2]];
            let heat = world
                .heat(feet[0], feet[1], feet[2])
                .max(world.heat(head[0], head[1], head[2]));
            let sunburn = def.burns_in_daylight
                && world.is_day()
                && !in_water
                && world.sky_light(head[0], head[1], head[2]) >= 15;
            if sunburn || heat > 0.0 {
                mob.burn_timer += dt;
                while mob.burn_timer >= 1.0 {
                    mob.burn_timer -= 1.0;
                    mob.health -= heat.max(1.0);
                    mob.hurt_timer = 0.3;
                }
            } else {
                mob.burn_timer = 0.0;
            }
            // Swimmers suffocate on land.
            let swimmer = def.movement == MobMovement::Swim;
            if swimmer && !in_water {
                mob.dry_timer += dt;
                if mob.dry_timer >= 2.0 {
                    mob.dry_timer -= 1.0;
                    mob.health -= 1.0;
                    mob.hurt_timer = 0.3;
                }
            } else {
                mob.dry_timer = 0.0;
            }

            // Pick what to do.
            let nearest = |pred: &dyn Fn(&PlayerInfo) -> bool| {
                players
                    .iter()
                    .filter(|p| pred(p))
                    .map(|p| {
                        (
                            p,
                            horizontal_distance(p.feet, mob.position)
                                + (p.feet[1] - mob.position[1]).abs() * 0.5,
                        )
                    })
                    .filter(|(_, d)| *d <= def.sight)
                    .min_by(|a, b| a.1.total_cmp(&b.1))
                    .map(|(p, _)| p.clone())
            };
            let aggressive_to = match def.kind {
                MobKind::Hostile => nearest(&|p: &PlayerInfo| p.targetable),
                MobKind::Neutral => mob
                    .angry_at
                    .clone()
                    .and_then(|id| nearest(&|p: &PlayerInfo| p.targetable && p.id == id)),
                MobKind::Passive => None,
            };
            let mut goal: Option<[f32; 3]> = None;
            let mut speed = def.speed;
            let mut seek = false; // goal worth a path search
            let mut face: Option<[f32; 3]> = None;
            if let Some(player) = aggressive_to {
                mob.state = MobState::Chase;
                mob.target = Some(player.id.clone());
                goal = Some(player.feet);
                seek = true;
                let close = horizontal_distance(player.feet, mob.position) <= half + 1.2
                    && (player.feet[1] - mob.position[1]).abs() < height.max(1.5);
                if close && mob.attack_timer <= 0.0 {
                    mob.attack_timer = def.attack_cooldown;
                    events.push(MobEvent::Attack {
                        mob: mob.id,
                        player: player.id.clone(),
                        damage: def.damage,
                        from: mob.position,
                        effect: def.on_hit,
                    });
                }
                if close {
                    goal = None;
                }
                if let Some(ranged) = def.ranged {
                    let eye = [
                        mob.position[0],
                        mob.position[1] + height * 0.85,
                        mob.position[2],
                    ];
                    let aim = [player.feet[0], player.feet[1] + 1.2, player.feet[2]];
                    let d = distance(eye, aim);
                    if d <= ranged.range && line_of_sight(world, eye, aim) {
                        face = Some(aim);
                        // Keep a distance and shoot.
                        if d < ranged.range * 0.6 && !close {
                            goal = None;
                        }
                        if mob.shoot_timer <= 0.0 && !close {
                            mob.shoot_timer = ranged.cooldown;
                            events.push(MobEvent::Shoot {
                                mob: mob.id,
                                from: eye,
                                direction: aim_with_drop(eye, aim, ranged.speed),
                                speed: ranged.speed,
                            });
                        }
                    }
                }
            } else if mob.state == MobState::Flee && mob.timer > 0.0 {
                speed *= 1.6;
                let from = mob
                    .target
                    .as_ref()
                    .and_then(|id| players.iter().find(|p| &p.id == id))
                    .map(|p| p.feet)
                    .unwrap_or([mob.position[0] + 1.0, mob.position[1], mob.position[2]]);
                goal = Some([
                    2.0 * mob.position[0] - from[0],
                    mob.position[1],
                    2.0 * mob.position[2] - from[2],
                ]);
            } else if mob.love_timer > 0.0 && !mob.is_baby() {
                mob.state = MobState::Mate;
                let partner = snapshot
                    .iter()
                    .filter(|(id, key, _, in_love, _)| *id != mob.id && *key == mob.key && *in_love)
                    .map(|(id, _, p, _, _)| (*id, *p, horizontal_distance(*p, mob.position)))
                    .filter(|(_, _, d)| *d < 8.0)
                    .min_by(|a, b| a.2.total_cmp(&b.2));
                if let Some((partner_id, p, d)) = partner {
                    if d < 1.5 {
                        mob.love_timer = 0.0;
                        mob.breed_cooldown = BREED_COOLDOWN;
                        // The mob with the lower id announces the birth.
                        if mob.id < partner_id {
                            births.push((mob.key.clone(), mob.position));
                        }
                    } else {
                        goal = Some(p);
                    }
                }
            } else if let Some(player) = def
                .breed_item
                .as_ref()
                .and_then(|item| {
                    nearest(&|p: &PlayerInfo| p.holding.as_deref() == Some(item.as_str()))
                })
                .filter(|p| horizontal_distance(p.feet, mob.position) < 8.0)
            {
                mob.state = MobState::Follow;
                if horizontal_distance(player.feet, mob.position) > 2.0 {
                    goal = Some(player.feet);
                    seek = true;
                }
            } else {
                if mob.timer <= 0.0 {
                    let wander = rng.next_f32() < 0.5;
                    mob.state = if wander {
                        MobState::Wander
                    } else {
                        MobState::Idle
                    };
                    mob.timer = rng.range(2.0, 6.0);
                    mob.yaw = rng.range(0.0, std::f32::consts::TAU);
                }
                if mob.state == MobState::Wander {
                    speed *= 0.6;
                    let ahead = [
                        mob.position[0] + mob.yaw.sin() * 4.0,
                        mob.position[1],
                        mob.position[2] + mob.yaw.cos() * 4.0,
                    ];
                    let cell = |p: [f32; 3]| {
                        [
                            p[0].floor() as i32,
                            p[1].floor() as i32,
                            p[2].floor() as i32,
                        ]
                    };
                    let [ax, ay, az] = cell([
                        mob.position[0] + mob.yaw.sin(),
                        mob.position[1],
                        mob.position[2] + mob.yaw.cos(),
                    ]);
                    if swimmer && in_water && !world.water(ax, ay, az) {
                        // Shore ahead: turn around.
                        mob.yaw += std::f32::consts::PI;
                        mob.timer = rng.range(1.0, 3.0);
                    } else {
                        goal = Some(ahead);
                    }
                }
            }
            if mob.state == MobState::Chase && aggressive_to_none(def, &mob.target, players) {
                mob.state = MobState::Idle;
                mob.target = None;
            }

            // Walkers find a way around walls and up stairs.
            if def.movement == MobMovement::Walk && seek {
                if let Some(g) = goal {
                    let from = cell_of(mob.position);
                    let to = cell_of(g);
                    let stale = mob
                        .path
                        .last()
                        .is_none_or(|end| (end[0] - to[0]).abs() + (end[2] - to[2]).abs() > 2);
                    if mob.repath <= 0.0 && (stale || mob.path.is_empty()) {
                        mob.repath = REPATH_SECONDS;
                        let tall = height.ceil().max(1.0) as i32;
                        mob.path = find_path(world, from, to, tall, PATH_NODES).unwrap_or_default();
                    }
                    while let Some(next) = mob.path.first() {
                        let center = [next[0] as f32 + 0.5, next[1] as f32, next[2] as f32 + 0.5];
                        if horizontal_distance(center, mob.position) < 0.4
                            && (next[1] as f32 - mob.position[1]).abs() < 1.1
                        {
                            mob.path.remove(0);
                        } else {
                            break;
                        }
                    }
                    if let Some(next) = mob.path.first() {
                        // The next waypoint, unless the goal itself is closer.
                        if horizontal_distance(g, mob.position) > 1.5 {
                            goal =
                                Some([next[0] as f32 + 0.5, next[1] as f32, next[2] as f32 + 0.5]);
                        }
                    }
                }
            } else if !seek {
                mob.path.clear();
            }

            // Steering.
            let (mut vx, mut vz) = (0.0, 0.0);
            if let Some(f) = face {
                mob.yaw = (f[0] - mob.position[0]).atan2(f[2] - mob.position[2]);
            }
            if let Some(g) = goal {
                let dx = g[0] - mob.position[0];
                let dz = g[2] - mob.position[2];
                let len = (dx * dx + dz * dz).sqrt();
                if len > 0.2 {
                    vx = dx / len * speed;
                    vz = dz / len * speed;
                    mob.yaw = dx.atan2(dz);
                }
            }
            // Knockback decays into steering.
            mob.velocity[0] = if mob.velocity[0].abs() > speed {
                mob.velocity[0] * 0.85
            } else {
                vx
            };
            mob.velocity[2] = if mob.velocity[2].abs() > speed {
                mob.velocity[2] * 0.85
            } else {
                vz
            };
            match def.movement {
                MobMovement::Fly => {
                    // Hover towards the goal's height (a little above a
                    // chased player's feet); hold altitude otherwise, but
                    // keep clear of the ground.
                    let ground_close = (1..=2)
                        .any(|d| world.solid(head[0], mob.position[1].floor() as i32 - d, head[2]));
                    let want = match goal {
                        Some(g) if mob.state == MobState::Chase => g[1] + 0.8,
                        _ if ground_close => mob.position[1] + 1.0,
                        _ => mob.position[1],
                    };
                    let target = ((want - mob.position[1]) * 2.0).clamp(-speed, speed);
                    mob.velocity[1] += (target - mob.velocity[1]) * (5.0 * dt).min(1.0);
                }
                MobMovement::Swim if in_water => {
                    let want = match goal {
                        Some(g) if mob.state != MobState::Wander => g[1],
                        _ => mob.position[1],
                    };
                    let mut target = ((want - mob.position[1]) * 2.0).clamp(-speed, speed);
                    let above = world.water(
                        head[0],
                        (mob.position[1] + height + 0.1).floor() as i32,
                        head[2],
                    );
                    if !above && target > 0.0 {
                        target = 0.0; // stay under the surface
                    }
                    mob.velocity[1] += (target - mob.velocity[1]) * (5.0 * dt).min(1.0);
                }
                _ if in_water => {
                    mob.velocity[1] = (mob.velocity[1] + 12.0 * dt).min(2.0); // swim up
                }
                _ => mob.velocity[1] -= GRAVITY * dt,
            }

            // Move axis by axis; step up one block when walking into it.
            let mut p = mob.position;
            for axis in [0usize, 2] {
                let mut next = p;
                next[axis] += mob.velocity[axis] * dt;
                if !collides(world, next, half, height) {
                    p = next;
                } else if def.movement == MobMovement::Fly {
                    mob.velocity[1] = speed * 0.8; // rise over the obstacle
                    mob.velocity[axis] = 0.0;
                } else if mob.on_ground {
                    let mut up = next;
                    up[1] += 1.01;
                    if !collides(world, up, half, height) {
                        mob.velocity[1] = JUMP_SPEED;
                    }
                    mob.velocity[axis] = 0.0;
                }
            }
            let mut next = p;
            next[1] += mob.velocity[1] * dt;
            if collides(world, next, half, height) {
                if mob.velocity[1] < 0.0 {
                    p[1] = p[1].floor().max(next[1].ceil());
                    mob.on_ground = true;
                }
                mob.velocity[1] = 0.0;
            } else {
                p = next;
                mob.on_ground = false;
            }
            if p[1] < -64.0 {
                mob.health = 0.0;
            }
            mob.position = p;
        }

        for (key, at) in births {
            if let Some(id) = self.spawn(content, &key, at, true) {
                events.push(MobEvent::Born { mob: id });
            }
        }

        // Deaths and despawning.
        let mut keep = Vec::with_capacity(self.list.len());
        for mob in self.list.drain(..) {
            let hostile = content
                .mob(&mob.key)
                .is_some_and(|d| d.kind == MobKind::Hostile && !d.boss);
            let nearest = players
                .iter()
                .map(|p| horizontal_distance(p.feet, mob.position))
                .fold(f32::MAX, f32::min);
            if mob.health <= 0.0 {
                events.push(MobEvent::Died {
                    mob: mob.id,
                    key: mob.key.clone(),
                    position: mob.position,
                    baby: mob.is_baby(),
                });
            } else if hostile && (nearest > 128.0 || (nearest > 32.0 && rng.next_f32() < dt / 40.0))
            {
                // Far from everyone: monsters vanish, animals stay.
            } else {
                keep.push(mob);
            }
        }
        self.list = keep;
        events
    }

    /// Try to spawn creatures around each player.
    pub fn spawn_around(
        &mut self,
        content: &Content,
        world: &dyn MobWorld,
        players: &[PlayerInfo],
        rng: &mut Rng,
    ) -> Vec<u64> {
        let mut spawned = Vec::new();
        for player in players {
            // Monsters, land animals and swimmers have separate caps.
            let class = |d: &MobDef| (d.kind == MobKind::Hostile, d.movement == MobMovement::Swim);
            let near = |of: (bool, bool), list: &[Mob]| {
                list.iter()
                    .filter(|m| horizontal_distance(m.position, player.feet) < 64.0)
                    .filter(|m| content.mob(&m.key).is_some_and(|d| class(d) == of))
                    .count()
            };
            let angle = rng.range(0.0, std::f32::consts::TAU);
            let distance = rng.range(24.0, 48.0);
            let x = (player.feet[0] + angle.cos() * distance).floor() as i32;
            let z = (player.feet[2] + angle.sin() * distance).floor() as i32;
            if !world.loaded(x, z) {
                continue;
            }
            let top = player.feet[1] as i32 + 16;
            // A standing spot: solid ground with two free cells above.
            let land = (top - 40..top).rev().find(|&y| {
                world.solid(x, y - 1, z)
                    && !world.solid(x, y, z)
                    && !world.solid(x, y + 1, z)
                    && !world.water(x, y, z)
            });
            // A swimming spot: the cell under the surface of water two deep.
            let water = (top - 40..top)
                .rev()
                .find(|&y| world.water(x, y, z))
                .filter(|&y| world.water(x, y - 1, z))
                .map(|y| y - 1);
            let light_ok = |d: &MobDef, y: i32| {
                let sky = world.sky_light(x, y, z);
                match d.spawn.light {
                    SpawnLight::Bright => world.is_day() && sky >= 9,
                    SpawnLight::Dark => {
                        (!world.is_day() || sky <= 7) && world.block_light(x, y, z) < 8
                    }
                }
            };
            let biome = world.biome(x, z);
            let candidates: Vec<(&MobDef, i32)> = content
                .mobs()
                .iter()
                .filter(|d| d.spawn.weight > 0)
                .filter_map(|d| {
                    let y = if d.movement == MobMovement::Swim {
                        water
                    } else {
                        land
                    }?;
                    light_ok(d, y).then_some((d, y))
                })
                .filter(|(d, _)| {
                    d.spawn.biomes.is_empty()
                        || biome.as_ref().is_some_and(|b| d.spawn.biomes.contains(b))
                })
                .collect();
            let total: u32 = candidates.iter().map(|(d, _)| d.spawn.weight).sum();
            if total == 0 {
                continue;
            }
            let mut pick = (rng.next_f32() * total as f32) as u32;
            let Some(&(def, y)) = candidates.iter().find(|(d, _)| {
                if pick < d.spawn.weight {
                    true
                } else {
                    pick -= d.spawn.weight;
                    false
                }
            }) else {
                continue;
            };
            let (hostile, swims) = class(def);
            let cap = match (hostile, swims) {
                (true, _) => 12,
                (false, true) => 6,
                (false, false) => 10,
            };
            if near((hostile, swims), &self.list) >= cap {
                continue;
            }
            if !def.spawn.on.is_empty() && !on_block(content, world, def, x, y - 1, z) {
                continue;
            }
            let count = def.spawn.group_min
                + (rng.next_f32() * (def.spawn.group_max - def.spawn.group_min + 1) as f32) as u32;
            for i in 0..count.min(def.spawn.group_max) {
                let offset = if swims {
                    [0.0, 0.0, 0.0]
                } else {
                    [(i % 2) as f32 * 1.2, 0.0, (i / 2) as f32 * 1.2]
                };
                let at = [
                    x as f32 + 0.5 + offset[0],
                    y as f32 + if swims { 0.3 } else { 0.0 },
                    z as f32 + 0.5 + offset[2],
                ];
                if let Some(id) = self.spawn(content, &def.key, at, false) {
                    spawned.push(id);
                }
            }
        }
        spawned
    }
}

fn distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    (0..3).map(|i| (a[i] - b[i]).powi(2)).sum::<f32>().sqrt()
}

fn cell_of(p: [f32; 3]) -> [i32; 3] {
    [
        p[0].floor() as i32,
        (p[1] + 0.01).floor() as i32,
        p[2].floor() as i32,
    ]
}

/// Whether nothing solid lies on the straight line between two points.
pub fn line_of_sight(world: &dyn MobWorld, from: [f32; 3], to: [f32; 3]) -> bool {
    let d = distance(from, to);
    let steps = (d / 0.25).ceil().max(1.0) as i32;
    (1..steps).all(|i| {
        let t = i as f32 / steps as f32;
        let p = [
            from[0] + (to[0] - from[0]) * t,
            from[1] + (to[1] - from[1]) * t,
            from[2] + (to[2] - from[2]) * t,
        ];
        !world.solid(
            p[0].floor() as i32,
            p[1].floor() as i32,
            p[2].floor() as i32,
        )
    })
}

/// Direction to loose an arrow at `speed` so it falls onto `to`.
pub fn aim_with_drop(from: [f32; 3], to: [f32; 3], speed: f32) -> [f32; 3] {
    let dx = to[0] - from[0];
    let dz = to[2] - from[2];
    let flat = (dx * dx + dz * dz).sqrt();
    let t = flat / speed.max(1.0);
    let drop = 0.5 * super::combat::GRAVITY * t * t;
    [dx, to[1] - from[1] + drop, dz]
}

/// A* over cells a body `height` cells tall can stand in: it walks to
/// neighbours, climbs single steps (with headroom for the jump), drops up
/// to three cells and swims through water. Returns the cells to visit after
/// `start`, ending at `goal` — or, when the goal is out of reach within
/// `max_nodes` expansions, at the cell that got closest to it. `None` when
/// no step brings it closer.
pub fn find_path(
    world: &dyn MobWorld,
    start: [i32; 3],
    goal: [i32; 3],
    height: i32,
    max_nodes: usize,
) -> Option<Vec<[i32; 3]>> {
    let free = |x: i32, y: i32, z: i32| (0..height).all(|h| !world.solid(x, y + h, z));
    let stand = |x: i32, y: i32, z: i32| {
        free(x, y, z)
            && (world.solid(x, y - 1, z) || world.water(x, y, z) || world.water(x, y - 1, z))
    };
    let h = |c: [i32; 3]| {
        ((c[0] - goal[0]).abs() + (c[2] - goal[2]).abs()) * 2 + (c[1] - goal[1]).abs() * 2
    };
    let reached = |c: [i32; 3]| {
        (c[0] - goal[0]).abs() + (c[2] - goal[2]).abs() <= 1 && (c[1] - goal[1]).abs() <= 1
    };
    let mut open = BinaryHeap::new();
    let mut cost: HashMap<[i32; 3], i32> = HashMap::new();
    let mut came: HashMap<[i32; 3], [i32; 3]> = HashMap::new();
    cost.insert(start, 0);
    open.push(Reverse((h(start), 0, start)));
    let mut best = (h(start), start);
    let mut expanded = 0;
    let mut end = None;
    while let Some(Reverse((_, g, c))) = open.pop() {
        if cost.get(&c).is_some_and(|&known| known < g) {
            continue;
        }
        if reached(c) {
            end = Some(c);
            break;
        }
        expanded += 1;
        if expanded > max_nodes {
            break;
        }
        if h(c) < best.0 {
            best = (h(c), c);
        }
        for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, nz) = (c[0] + dx, c[2] + dz);
            let mut next = None;
            if stand(nx, c[1], nz) {
                next = Some(([nx, c[1], nz], 2));
            } else if stand(nx, c[1] + 1, nz) && !world.solid(c[0], c[1] + height, c[2]) {
                next = Some(([nx, c[1] + 1, nz], 3));
            } else if free(nx, c[1], nz) {
                for drop in 1..=3 {
                    if stand(nx, c[1] - drop, nz) {
                        next = Some(([nx, c[1] - drop, nz], 2 + drop));
                        break;
                    }
                    if world.solid(nx, c[1] - drop, nz) {
                        break;
                    }
                }
            }
            let Some((n, step)) = next else { continue };
            let ng = g + step;
            if cost.get(&n).is_none_or(|&known| ng < known) {
                cost.insert(n, ng);
                came.insert(n, c);
                open.push(Reverse((ng + h(n), ng, n)));
            }
        }
    }
    let end = end.unwrap_or(best.1);
    if end == start {
        return None;
    }
    let mut path = vec![end];
    let mut at = end;
    while let Some(&prev) = came.get(&at) {
        if prev == start {
            break;
        }
        path.push(prev);
        at = prev;
    }
    path.reverse();
    // Arrived next to the goal: finish on it when it can be stood in.
    if reached(end) && end != goal && stand(goal[0], goal[1], goal[2]) {
        path.push(goal);
    }
    Some(path)
}

fn aggressive_to_none(def: &MobDef, target: &Option<String>, players: &[PlayerInfo]) -> bool {
    def.kind == MobKind::Passive
        || target
            .as_ref()
            .is_none_or(|t| !players.iter().any(|p| &p.id == t))
}

/// Whether the block under a spawn spot is one the creature spawns on.
fn on_block(content: &Content, world: &dyn MobWorld, def: &MobDef, x: i32, y: i32, z: i32) -> bool {
    content
        .block_by_id(world.block(x, y, z))
        .is_some_and(|b| def.spawn.on.contains(&b.key))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Flat {
        ground: i32,
        day: bool,
        walls: Vec<[i32; 3]>,
        turf: u32,
    }

    impl MobWorld for Flat {
        fn block(&self, x: i32, y: i32, z: i32) -> u32 {
            if self.solid(x, y, z) {
                self.turf
            } else {
                0
            }
        }
        fn solid(&self, x: i32, y: i32, z: i32) -> bool {
            y < self.ground || self.walls.contains(&[x, y, z])
        }
        fn water(&self, _: i32, _: i32, _: i32) -> bool {
            false
        }
        fn sky_light(&self, _: i32, _: i32, _: i32) -> u32 {
            15
        }
        fn block_light(&self, _: i32, _: i32, _: i32) -> u32 {
            0
        }
        fn is_day(&self) -> bool {
            self.day
        }
        fn biome(&self, _: i32, _: i32) -> Option<String> {
            Some("plains".into())
        }
        fn loaded(&self, _: i32, _: i32) -> bool {
            true
        }
    }

    fn content() -> Content {
        Content::load(platform_content::default_pack_dir()).unwrap()
    }

    fn player(at: [f32; 3]) -> PlayerInfo {
        PlayerInfo {
            id: "p1".into(),
            feet: at,
            holding: None,
            targetable: true,
        }
    }

    fn run(
        mobs: &mut Mobs,
        c: &Content,
        w: &Flat,
        players: &[PlayerInfo],
        seconds: f32,
    ) -> Vec<MobEvent> {
        let mut rng = Rng(7);
        let mut events = Vec::new();
        for _ in 0..(seconds * 20.0) as u32 {
            events.extend(mobs.step(c, w, players, 0.05, &mut rng));
        }
        events
    }

    #[test]
    fn mobs_fall_to_the_ground_and_stand_on_it() {
        let c = content();
        let w = Flat {
            ground: 64,
            day: true,
            walls: vec![],
            turf: 5,
        };
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "grazer", [0.5, 70.0, 0.5], false);
        run(&mut mobs, &c, &w, &[], 3.0);
        assert!(
            (mobs.list[0].position[1] - 64.0).abs() < 0.01,
            "{:?}",
            mobs.list[0].position
        );
        assert!(mobs.list[0].on_ground);
    }

    #[test]
    fn monsters_chase_and_hit_survival_players_and_ignore_creative_ones() {
        let c = content();
        let w = Flat {
            ground: 64,
            day: false,
            walls: vec![],
            turf: 5,
        };
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "shambler", [8.5, 64.0, 0.5], false);
        let events = run(&mut mobs, &c, &w, &[player([0.5, 64.0, 0.5])], 8.0);
        assert!(events
            .iter()
            .any(|e| matches!(e, MobEvent::Attack { damage, .. } if *damage == 3.0)));

        let mut calm = Mobs::default();
        calm.spawn(&c, "shambler", [8.5, 64.0, 0.5], false);
        let mut creative = player([0.5, 64.0, 0.5]);
        creative.targetable = false;
        assert!(run(&mut calm, &c, &w, &[creative], 8.0).is_empty());
    }

    #[test]
    fn monsters_climb_single_steps() {
        let c = content();
        let walls: Vec<[i32; 3]> = (-3..3).map(|z| [4, 64, z]).collect();
        let w = Flat {
            ground: 64,
            day: false,
            walls,
            turf: 5,
        };
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "shambler", [8.5, 64.0, 0.5], false);
        run(&mut mobs, &c, &w, &[player([0.5, 64.0, 0.5])], 8.0);
        assert!(
            mobs.list[0].position[0] < 3.0,
            "crossed the step: {:?}",
            mobs.list[0].position
        );
    }

    #[test]
    fn shamblers_burn_in_daylight() {
        let c = content();
        let w = Flat {
            ground: 64,
            day: true,
            walls: vec![],
            turf: 5,
        };
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "shambler", [0.5, 64.0, 0.5], false);
        // A creative observer: keeps it from despawning, is not chased.
        let mut observer = player([20.5, 64.0, 0.5]);
        observer.targetable = false;
        let events = run(&mut mobs, &c, &w, &[observer], 25.0);
        assert!(events
            .iter()
            .any(|e| matches!(e, MobEvent::Died { key, .. } if key == "shambler")));
    }

    #[test]
    fn hurt_animals_flee_and_die() {
        let c = content();
        let w = Flat {
            ground: 64,
            day: true,
            walls: vec![],
            turf: 5,
        };
        let mut mobs = Mobs::default();
        let id = mobs.spawn(&c, "grazer", [0.5, 64.0, 0.5], false).unwrap();
        assert!(!mobs.hurt(&c, id, 4.0, Some("p1"), Some([0.5, 64.0, -1.0])));
        run(&mut mobs, &c, &w, &[player([0.5, 64.0, -1.0])], 3.0);
        assert!(
            mobs.list[0].position[2] > 4.0,
            "ran away: {:?}",
            mobs.list[0].position
        );
        assert!(mobs.hurt(&c, id, 10.0, Some("p1"), None));
        let events = run(&mut mobs, &c, &w, &[], 0.1);
        assert!(events.iter().any(|e| matches!(e, MobEvent::Died { .. })));
        assert!(mobs.list.is_empty());
    }

    #[test]
    fn fed_animals_breed_and_babies_grow_up() {
        let c = content();
        let w = Flat {
            ground: 64,
            day: true,
            walls: vec![],
            turf: 5,
        };
        let mut mobs = Mobs::default();
        let a = mobs.spawn(&c, "grazer", [0.5, 64.0, 0.5], false).unwrap();
        let b = mobs.spawn(&c, "grazer", [4.5, 64.0, 0.5], false).unwrap();
        assert!(!mobs.feed(&c, a, "apple"), "wrong food");
        assert!(mobs.feed(&c, a, "wheat"));
        assert!(mobs.feed(&c, b, "wheat"));
        let events = run(&mut mobs, &c, &w, &[], 10.0);
        assert!(events.iter().any(|e| matches!(e, MobEvent::Born { .. })));
        assert_eq!(mobs.list.len(), 3);
        let baby = mobs.list.iter().find(|m| m.is_baby()).unwrap().id;
        assert!(!mobs.feed(&c, a, "wheat"), "parents rest after breeding");
        run(&mut mobs, &c, &w, &[], 310.0);
        assert!(!mobs.list.iter().find(|m| m.id == baby).unwrap().is_baby());
    }

    #[test]
    fn animals_follow_a_player_holding_their_food() {
        let c = content();
        let w = Flat {
            ground: 64,
            day: true,
            walls: vec![],
            turf: 5,
        };
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "grazer", [6.5, 64.0, 0.5], false);
        let mut p = player([0.5, 64.0, 0.5]);
        p.holding = Some("wheat".into());
        run(&mut mobs, &c, &w, &[p], 4.0);
        assert!(
            mobs.list[0].position[0] < 3.5,
            "followed: {:?}",
            mobs.list[0].position
        );
    }

    #[test]
    fn spawning_respects_light_and_caps() {
        let c = content();
        let mut rng = Rng(3);
        let day = Flat {
            ground: 64,
            day: true,
            walls: vec![],
            turf: 5,
        };
        let night = Flat {
            ground: 64,
            day: false,
            walls: vec![],
            turf: 5,
        };
        let players = [player([0.5, 64.0, 0.5])];
        let mut mobs = Mobs::default();
        for _ in 0..200 {
            mobs.spawn_around(&c, &day, &players, &mut rng);
        }
        assert!(!mobs.list.is_empty());
        assert!(mobs
            .list
            .iter()
            .all(|m| c.mob(&m.key).unwrap().kind == MobKind::Passive));
        assert!(mobs.list.len() <= 10 + 4, "capped: {}", mobs.list.len());
        let mut monsters = Mobs::default();
        for _ in 0..200 {
            monsters.spawn_around(&c, &night, &players, &mut rng);
        }
        assert!(monsters
            .list
            .iter()
            .all(|m| c.mob(&m.key).unwrap().kind == MobKind::Hostile));
        assert!(!monsters.list.is_empty());
        // Nothing spawns on ground no creature is allowed on.
        let glass = Flat {
            ground: 64,
            day: true,
            walls: vec![],
            turf: c.block("glass").unwrap().id,
        };
        let mut none = Mobs::default();
        for _ in 0..200 {
            none.spawn_around(&c, &glass, &players, &mut rng);
        }
        assert!(none.list.is_empty());
    }

    /// Ground at 64 with a pond (y 60..64) in |x|, |z| <= 4.
    struct Pond;

    impl MobWorld for Pond {
        fn block(&self, x: i32, y: i32, z: i32) -> u32 {
            u32::from(self.solid(x, y, z))
        }
        fn solid(&self, x: i32, y: i32, z: i32) -> bool {
            if self.water(x, y, z) {
                return false;
            }
            y < 64 && !(x.abs() <= 4 && z.abs() <= 4 && y >= 60)
        }
        fn water(&self, x: i32, y: i32, z: i32) -> bool {
            x.abs() <= 4 && z.abs() <= 4 && (60..64).contains(&y)
        }
        fn sky_light(&self, _: i32, _: i32, _: i32) -> u32 {
            15
        }
        fn block_light(&self, _: i32, _: i32, _: i32) -> u32 {
            0
        }
        fn is_day(&self) -> bool {
            true
        }
        fn biome(&self, _: i32, _: i32) -> Option<String> {
            Some("plains".into())
        }
        fn loaded(&self, _: i32, _: i32) -> bool {
            true
        }
    }

    fn night() -> Flat {
        Flat {
            ground: 64,
            day: false,
            walls: vec![],
            turf: 5,
        }
    }

    #[test]
    fn villagers_spawn_on_village_paths_only() {
        let c = content();
        let mut rng = Rng(21);
        let players = [player([0.5, 64.0, 0.5])];
        let path = Flat {
            ground: 64,
            day: true,
            walls: vec![],
            turf: c.block("gravel").unwrap().id,
        };
        let mut mobs = Mobs::default();
        for _ in 0..200 {
            mobs.spawn_around(&c, &path, &players, &mut rng);
        }
        assert!(!mobs.list.is_empty());
        assert!(
            mobs.list.iter().all(|m| m.key.starts_with("village_")),
            "{:?}",
            mobs.list.iter().map(|m| &m.key).collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_star_walks_around_walls_and_climbs_steps() {
        // A wall from z = -6 to 6 at x = 3, two high: the way is round its end.
        let mut walls = Vec::new();
        for z in -6..=6 {
            walls.push([3, 64, z]);
            walls.push([3, 65, z]);
        }
        let w = Flat { walls, ..night() };
        let path = find_path(&w, [0, 64, 0], [6, 64, 0], 2, 600).expect("a way round");
        assert_eq!(*path.last().unwrap(), [6, 64, 0]);
        assert!(path.iter().any(|c| c[2].abs() >= 7), "goes round: {path:?}");
        assert!(path.iter().all(|c| !w.solid(c[0], c[1], c[2])));
        // A single step is climbed.
        let step = Flat {
            walls: vec![[1, 64, 0], [2, 64, 0], [3, 64, 0]],
            ..night()
        };
        let path = find_path(&step, [0, 64, 0], [2, 65, 0], 2, 600).unwrap();
        assert_eq!(*path.last().unwrap(), [2, 65, 0]);
        // Walled in: the closest reachable cell, or nothing.
        let mut cage = Vec::new();
        for (x, z) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            cage.push([x, 64, z]);
            cage.push([x, 65, z]);
        }
        let caged = Flat {
            walls: cage,
            ..night()
        };
        assert!(find_path(&caged, [0, 64, 0], [9, 64, 0], 2, 600).is_none());
    }

    #[test]
    fn walkers_path_round_a_wall_to_reach_a_player() {
        let c = content();
        let mut walls = Vec::new();
        for z in -6..=6 {
            walls.push([3, 64, z]);
            walls.push([3, 65, z]);
        }
        let w = Flat { walls, ..night() };
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "shambler", [0.5, 64.0, 0.5], false);
        let events = run(&mut mobs, &c, &w, &[player([7.5, 64.0, 0.5])], 15.0);
        assert!(
            events.iter().any(|e| matches!(e, MobEvent::Attack { .. })),
            "reached the player: {:?}",
            mobs.list[0].position
        );
    }

    #[test]
    fn archers_keep_their_distance_and_shoot() {
        let c = content();
        let w = night();
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "bone_archer", [12.5, 64.0, 0.5], false);
        let events = run(&mut mobs, &c, &w, &[player([0.5, 64.0, 0.5])], 6.0);
        let shots: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                MobEvent::Shoot { direction, .. } => Some(*direction),
                _ => None,
            })
            .collect();
        assert!(shots.len() >= 2, "{events:?}");
        assert!(shots[0][0] < 0.0, "aims at the player: {:?}", shots[0]);
        assert!(!events.iter().any(|e| matches!(e, MobEvent::Attack { .. })));
        let x = mobs.list[0].position[0];
        assert!(x > 5.0, "keeps away: {x}");
        // Behind a wall it holds fire.
        let wall: Vec<[i32; 3]> = (-3..=3)
            .flat_map(|z| (64..68).map(move |y| [6, y, z]))
            .collect();
        let hidden = Flat {
            walls: wall,
            ..night()
        };
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "bone_archer", [12.5, 64.0, 0.5], false);
        let mut rng = Rng(7);
        let first = mobs.step(&c, &hidden, &[player([0.5, 64.0, 0.5])], 0.05, &mut rng);
        assert!(!first.iter().any(|e| matches!(e, MobEvent::Shoot { .. })));
    }

    #[test]
    fn arrows_are_aimed_above_far_targets() {
        let near = aim_with_drop([0.0, 65.0, 0.0], [2.0, 65.0, 0.0], 24.0);
        let far = aim_with_drop([0.0, 65.0, 0.0], [20.0, 65.0, 0.0], 24.0);
        assert!(near[1] < 0.2 && far[1] > 5.0, "{near:?} {far:?}");
    }

    #[test]
    fn flyers_hover_and_dive_at_players() {
        let c = content();
        let w = night();
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "sky_wisp", [0.5, 72.0, 0.5], false);
        let mut observer = player([40.5, 64.0, 0.5]);
        observer.targetable = false;
        run(&mut mobs, &c, &w, &[observer], 3.0);
        assert!(
            mobs.list[0].position[1] > 70.0,
            "did not fall: {:?}",
            mobs.list[0].position
        );
        let events = run(&mut mobs, &c, &w, &[player([6.5, 64.0, 0.5])], 8.0);
        assert!(events.iter().any(|e| matches!(e, MobEvent::Attack { .. })));
    }

    #[test]
    fn fish_swim_in_water_and_die_on_land() {
        let c = content();
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "river_fish", [0.5, 61.3, 0.5], false);
        let mut observer = player([10.5, 64.0, 0.5]);
        observer.targetable = false;
        let mut rng = Rng(11);
        for _ in 0..400 {
            mobs.step(&c, &Pond, &[observer.clone()], 0.05, &mut rng);
            let p = mobs.list[0].position;
            assert!(
                Pond.water(
                    p[0].floor() as i32,
                    p[1].floor() as i32,
                    p[2].floor() as i32
                ),
                "left the water: {p:?}"
            );
        }
        assert_eq!(mobs.list[0].health, 3.0);
        let mut stranded = Mobs::default();
        stranded.spawn(&c, "river_fish", [8.5, 64.0, 0.5], false);
        let events = run(&mut stranded, &c, &night(), &[observer], 10.0);
        assert!(events.iter().any(|e| matches!(e, MobEvent::Died { .. })));
        // They spawn in water only.
        let mut rng = Rng(5);
        let players = [player([0.5, 64.0, 30.5])];
        let mut spawned = Mobs::default();
        for _ in 0..2000 {
            spawned.spawn_around(&c, &Pond, &players, &mut rng);
        }
        let fish: Vec<_> = spawned
            .list
            .iter()
            .filter(|m| m.key == "river_fish")
            .collect();
        assert!(!fish.is_empty());
        assert!(fish
            .iter()
            .all(|m| m.position[0].abs() < 5.0 && m.position[1] < 64.0));
    }

    #[test]
    fn crawler_bites_poison_and_bosses_resist_knockback_and_stay() {
        let c = content();
        let w = night();
        let mut mobs = Mobs::default();
        mobs.spawn(&c, "crawler", [3.5, 64.0, 0.5], false);
        let events = run(&mut mobs, &c, &w, &[player([0.5, 64.0, 0.5])], 5.0);
        assert!(events.iter().any(|e| matches!(
            e,
            MobEvent::Attack { effect: Some(h), .. } if h.effect == platform_content::EffectKind::Poison
        )));

        let mut bosses = Mobs::default();
        let id = bosses
            .spawn(&c, "ember_warden", [0.5, 64.0, 0.5], false)
            .unwrap();
        assert_eq!(bosses.list[0].health, 200.0);
        bosses.hurt(&c, id, 5.0, Some("p1"), Some([-1.0, 64.0, 0.5]));
        assert!(
            bosses.list[0].velocity[0] < 1.5,
            "{:?}",
            bosses.list[0].velocity
        );
        // Monsters vanish far from players; bosses wait.
        bosses.spawn(&c, "shambler", [0.5, 64.0, 3.5], false);
        run(&mut bosses, &c, &w, &[player([300.5, 64.0, 0.5])], 1.0);
        assert_eq!(bosses.list.len(), 1);
        assert_eq!(bosses.list[0].key, "ember_warden");
        // Never by itself.
        let mut rng = Rng(9);
        let mut natural = Mobs::default();
        for _ in 0..300 {
            natural.spawn_around(&c, &w, &[player([0.5, 64.0, 0.5])], &mut rng);
        }
        assert!(natural.list.iter().all(|m| m.key != "ember_warden"));
    }
}
