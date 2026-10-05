//! Movement checks. The client moves its own body (the engine clamps
//! impossible jumps); here each player in survival or adventure is watched
//! for running faster than any sprint and effect allow, hanging in the air,
//! and standing inside solid blocks. A violation sends them back to the last
//! place they stood fairly; repeated violations are reported to the backend
//! (the audit log, for moderators) at most once per five minutes per kind.
//! Creative players, spectators, players just moved by the server and
//! players just hurt (knockback) are left alone.

use std::collections::{HashMap, VecDeque};

use serde_json::json;
use voxelize::{ClientFilter, Event, PositionComp};

use platform_content::EffectKind;

use super::survival::EYE_HEIGHT;
use super::Gameplay;

/// Fastest legitimate run, blocks per second: walk 6, sprint ×1.4.
pub const SPRINT_SPEED: f32 = 6.0 * 1.4;
/// Slack over the fastest run (lag, bumps, slopes).
pub const SPEED_TOLERANCE: f32 = 1.5;
/// Seconds over which speed is measured.
pub const SPEED_WINDOW: f32 = 1.0;
/// Seconds without ground, water or ladder below before hanging counts.
pub const HOVER_SECONDS: f32 = 2.5;
/// Seconds inside solid blocks before it counts.
pub const INSIDE_SECONDS: f32 = 0.75;
/// Violations within [`REPORT_WINDOW`] seconds that make a report.
pub const REPORT_AFTER: usize = 10;
pub const REPORT_WINDOW: f32 = 300.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Verdict {
    Fine,
    TooFast,
    Hovering,
    InsideBlock,
}

impl Verdict {
    pub fn key(self) -> &'static str {
        match self {
            Verdict::Fine => "fine",
            Verdict::TooFast => "speed",
            Verdict::Hovering => "hover",
            Verdict::InsideBlock => "noclip",
        }
    }
}

/// What is around the player's feet this moment.
#[derive(Debug, Clone, Copy)]
pub struct Footing {
    /// Ground, water or a loaded-chunk edge below or around the feet.
    pub supported: bool,
    /// Both the feet and the head are in solid blocks.
    pub inside: bool,
}

/// One player's movement record.
#[derive(Debug, Default)]
pub struct Watch {
    clock: f32,
    /// The last place they stood fairly (feet).
    pub anchor: Option<[f32; 3]>,
    window_start: Option<[f32; 3]>,
    window_t: f32,
    air_t: f32,
    air_start_y: f32,
    inside_t: f32,
    violations: VecDeque<(f32, Verdict)>,
    reported: HashMap<Verdict, f32>,
}

fn horizontal(a: [f32; 3], b: [f32; 3]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

impl Watch {
    /// Forget the motion so far (the server moved them, they were hurt, …).
    pub fn reset(&mut self, feet: [f32; 3]) {
        self.anchor = Some(feet);
        self.window_start = Some(feet);
        self.window_t = 0.0;
        self.air_t = 0.0;
        self.inside_t = 0.0;
    }

    /// Advance by `dt` seconds with the player at `feet`.
    pub fn observe(
        &mut self,
        dt: f32,
        feet: [f32; 3],
        footing: Footing,
        max_speed: f32,
    ) -> Verdict {
        self.clock += dt;
        let Some(start) = self.window_start else {
            self.reset(feet);
            return Verdict::Fine;
        };
        if footing.inside {
            self.inside_t += dt;
            if self.inside_t >= INSIDE_SECONDS {
                return Verdict::InsideBlock;
            }
        } else {
            self.inside_t = 0.0;
        }
        if footing.supported {
            self.air_t = 0.0;
        } else {
            if self.air_t == 0.0 {
                self.air_start_y = feet[1];
            }
            self.air_t += dt;
            // Falling is fine; staying up (or rising) for long is not.
            if self.air_t >= HOVER_SECONDS && feet[1] >= self.air_start_y - 1.0 {
                return Verdict::Hovering;
            }
        }
        self.window_t += dt;
        if self.window_t >= SPEED_WINDOW {
            let speed = horizontal(feet, start) / self.window_t;
            if speed > max_speed {
                return Verdict::TooFast;
            }
            self.window_start = Some(feet);
            self.window_t = 0.0;
            if footing.supported && !footing.inside {
                self.anchor = Some(feet);
            }
        }
        Verdict::Fine
    }

    /// Count a violation; true when it is time to report this kind.
    pub fn violated(&mut self, verdict: Verdict) -> bool {
        let now = self.clock;
        self.violations.push_back((now, verdict));
        while self
            .violations
            .front()
            .is_some_and(|(t, _)| now - t > REPORT_WINDOW)
        {
            self.violations.pop_front();
        }
        let count = self
            .violations
            .iter()
            .filter(|(_, v)| *v == verdict)
            .count();
        let due = self
            .reported
            .get(&verdict)
            .is_none_or(|t| now - t > REPORT_WINDOW);
        if count >= REPORT_AFTER && due {
            self.reported.insert(verdict, now);
            return true;
        }
        false
    }

    pub fn recent(&self, verdict: Verdict) -> usize {
        self.violations
            .iter()
            .filter(|(_, v)| *v == verdict)
            .count()
    }
}

/// The fastest a player may run with their effects.
pub fn max_speed(effects: &[super::survival::Effect]) -> f32 {
    let speed_levels: f32 = effects
        .iter()
        .filter(|e| e.kind == EffectKind::Speed)
        .map(|e| e.level as f32 + 1.0)
        .fold(0.0, f32::max);
    SPRINT_SPEED * (1.0 + 0.2 * speed_levels) * SPEED_TOLERANCE + 1.0
}

#[derive(Default)]
pub struct AntiCheatSystem {
    since: f32,
    last: Option<std::time::Instant>,
    watches: HashMap<String, Watch>,
    health: HashMap<String, f32>,
}

impl<'a> specs::System<'a> for AntiCheatSystem {
    type SystemData = (
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadExpect<'a, voxelize::Chunks>,
        specs::ReadExpect<'a, voxelize::WorldConfig>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (clients, chunks, config, positions, mut g, mut events): Self::SystemData) {
        let now = std::time::Instant::now();
        self.since += self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0);
        self.last = Some(now);
        if self.since < 0.25 || !g.dimensions.anticheat {
            return;
        }
        let dt = std::mem::take(&mut self.since).min(1.0);
        let content = g.rules.content_arc();
        let max_height = config.max_height as i32;
        // None: the chunk is not loaded (say nothing about it).
        let block = |x: i32, y: i32, z: i32| -> Option<(bool, bool)> {
            if y < 0 || y >= max_height {
                return Some((false, false));
            }
            let coords = voxelize::ChunkUtils::map_voxel_to_chunk(x, y, z, config.chunk_size);
            if !chunks.is_chunk_ready(&coords) {
                return None;
            }
            let id = voxelize::VoxelAccess::get_voxel(&*chunks, x, y, z);
            let def = content.block_by_id(id);
            let fluid = def.is_some_and(|b| b.fluid.is_some());
            let solid = def.is_some_and(|b| b.collision && b.fluid.is_none());
            Some((solid, fluid))
        };
        self.watches.retain(|id, _| g.players.contains_key(id));
        self.health.retain(|id, _| g.players.contains_key(id));
        let world = g
            .dimensions
            .world_of(g.dimensions.current)
            .unwrap_or_default()
            .to_owned();
        let bridge = g.dimensions.bridge.clone();
        let ids: Vec<String> = g.players.keys().cloned().collect();
        for id in ids {
            let Some(p) = clients.get(&id).and_then(|c| positions.get(c.entity)) else {
                continue;
            };
            let feet = [p.0 .0, p.0 .1 - EYE_HEIGHT, p.0 .2];
            let Some(player) = g.players.get_mut(&id) else {
                continue;
            };
            player.moved = (player.moved - dt).max(0.0);
            let watch = self.watches.entry(id.clone()).or_default();
            let hurt = self
                .health
                .insert(id.clone(), player.vitals.health)
                .is_some_and(|before| player.vitals.health < before);
            let exempt = player.realm == platform_ticket::Realm::Creative
                || player.mode == super::rules::GameMode::Spectator
                || player.travel.settle > 0.0
                || player.moved > 0.0
                || player.travel.departed
                || player.vitals.health <= 0.0
                || hurt;
            if exempt {
                watch.reset(feet);
                continue;
            }
            let (fx, fy, fz) = (feet[0], feet[1], feet[2]);
            let mut supported = false;
            let mut unknown = false;
            // The feet's footprint, just below and at the feet (water counts).
            for (dx, dz) in [
                (-0.3, -0.3),
                (0.3, -0.3),
                (-0.3, 0.3),
                (0.3, 0.3),
                (0.0, 0.0),
            ] {
                for dy in [-0.3f32, 0.0, 0.9] {
                    match block(
                        (fx + dx).floor() as i32,
                        (fy + dy).floor() as i32,
                        (fz + dz).floor() as i32,
                    ) {
                        None => unknown = true,
                        Some((solid, fluid)) => {
                            supported |= fluid || (solid && dy < 0.0) || (fluid && dy >= 0.0)
                        }
                    }
                }
            }
            if unknown {
                watch.reset(feet);
                continue;
            }
            let inside = matches!(
                block(
                    fx.floor() as i32,
                    (fy + 0.2).floor() as i32,
                    fz.floor() as i32
                ),
                Some((true, _))
            ) && matches!(
                block(
                    fx.floor() as i32,
                    (fy + 1.5).floor() as i32,
                    fz.floor() as i32
                ),
                Some((true, _))
            );
            let verdict = watch.observe(
                dt,
                feet,
                super::anticheat::Footing { supported, inside },
                max_speed(&player.vitals.effects),
            );
            if verdict == Verdict::Fine {
                continue;
            }
            crate::metrics::inc(
                "platform_anticheat_violations_total",
                &[("kind", verdict.key())],
            );
            // Hanging in the air: straight down onto whatever is below
            // (never back to a remembered place, which may be in the air
            // itself); otherwise back to the last fair place.
            let ground_below = (1..=96).find_map(|d| {
                let y = fy.floor() as i32 - d;
                match block(fx.floor() as i32, y, fz.floor() as i32) {
                    Some((true, _)) | Some((_, true)) => Some(y as f32 + 1.0),
                    _ => None,
                }
            });
            let anchor = match (verdict, ground_below) {
                (Verdict::Hovering, Some(y)) => [fx, y, fz],
                _ => watch.anchor.unwrap_or(feet),
            };
            watch.reset(anchor);
            events.dispatch(
                Event::new(super::travel::TELEPORT_EVENT)
                    .payload(json!({ "feet": [anchor[0].floor() as i32, anchor[1].round() as i32, anchor[2].floor() as i32] }))
                    .filter(ClientFilter::Direct(id.clone()))
                    .build(),
            );
            if watch.violated(verdict) {
                log::warn!(
                    "anti-cheat: {id} flagged for {} ({} times in 5 min)",
                    verdict.key(),
                    watch.recent(verdict)
                );
                if let Some(bridge) = &bridge {
                    bridge.request(super::bridge::Request::Flag {
                        world: world.clone(),
                        player: id.clone(),
                        kind: verdict.key(),
                        count: watch.recent(verdict) as u32,
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GROUND: Footing = Footing {
        supported: true,
        inside: false,
    };
    const AIR: Footing = Footing {
        supported: false,
        inside: false,
    };

    fn run(watch: &mut Watch, steps: &[([f32; 3], Footing)], dt: f32) -> Vec<Verdict> {
        steps
            .iter()
            .map(|(at, f)| watch.observe(dt, *at, *f, max_speed(&[])))
            .collect()
    }

    #[test]
    fn sprinting_is_fine_and_teleport_speed_is_not() {
        let mut w = Watch::default();
        let sprint: Vec<_> = (0..12)
            .map(|i| ([i as f32 * 8.4 * 0.25, 64.0, 0.0], GROUND))
            .collect();
        assert!(run(&mut w, &sprint, 0.25)
            .iter()
            .all(|v| *v == Verdict::Fine));
        assert!(
            w.anchor.is_some_and(|a| a[0] > 10.0),
            "the anchor follows fair movement"
        );
        let mut w = Watch::default();
        let zoom: Vec<_> = (0..6)
            .map(|i| ([i as f32 * 10.0, 64.0, 0.0], GROUND))
            .collect();
        assert!(run(&mut w, &zoom, 0.25).contains(&Verdict::TooFast));
        assert!(
            max_speed(&[super::super::survival::Effect {
                kind: EffectKind::Speed,
                level: 1,
                seconds: 9.0
            }]) > max_speed(&[])
        );
    }

    #[test]
    fn jumping_and_falling_are_fine_but_hanging_in_the_air_is_not() {
        let mut w = Watch::default();
        let jump = [
            ([0.0, 64.0, 0.0], GROUND),
            ([0.0, 65.0, 0.0], AIR),
            ([0.0, 65.2, 0.0], AIR),
            ([0.0, 64.5, 0.0], AIR),
            ([0.0, 64.0, 0.0], GROUND),
        ];
        assert!(run(&mut w, &jump, 0.25).iter().all(|v| *v == Verdict::Fine));
        let mut w = Watch::default();
        let fall: Vec<_> = (0..16)
            .map(|i| ([0.0, 100.0 - i as f32 * 3.0, 0.0], AIR))
            .collect();
        assert!(
            run(&mut w, &fall, 0.25).iter().all(|v| *v == Verdict::Fine),
            "a long fall is fine"
        );
        let mut w = Watch::default();
        let hover: Vec<_> = (0..14).map(|_| ([0.0, 80.0, 0.0], AIR)).collect();
        assert!(run(&mut w, &hover, 0.25).contains(&Verdict::Hovering));
    }

    #[test]
    fn standing_inside_walls_is_caught_and_reports_are_rate_limited() {
        let mut w = Watch::default();
        let wall = [(
            [0.0, 64.0, 0.0],
            Footing {
                supported: true,
                inside: true,
            },
        ); 4];
        assert_eq!(run(&mut w, &wall, 0.25).last(), Some(&Verdict::InsideBlock));
        let mut w = Watch::default();
        let mut reports = 0;
        for _ in 0..30 {
            w.observe(1.0, [0.0, 64.0, 0.0], GROUND, max_speed(&[]));
            if w.violated(Verdict::TooFast) {
                reports += 1;
            }
        }
        assert_eq!(reports, 1, "one report per five minutes");
        for _ in 0..300 {
            w.observe(1.0, [0.0, 64.0, 0.0], GROUND, max_speed(&[]));
        }
        for _ in 0..REPORT_AFTER {
            w.violated(Verdict::TooFast);
        }
        assert!(
            w.reported
                .get(&Verdict::TooFast)
                .is_some_and(|t| *t > 300.0),
            "reported again later"
        );
    }
}
