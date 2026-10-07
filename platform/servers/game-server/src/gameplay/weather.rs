//! Weather in the overworld: clear spells and rain, some of it thunder.
//! Rain puts out fires and burning bodies under open sky, keeps farmland
//! wet and keeps the undead from burning; thunderstorms throw lightning near
//! players (fire where it strikes in unclaimed land, a hard hit to bodies
//! close by). Other dimensions have no weather. The state is saved with the
//! world (`weather.json`), and creative players may set it.

use std::path::{Path, PathBuf};

use platform_content::Dimension;
use platform_ticket::Realm;
use serde::{Deserialize, Serialize};
use serde_json::json;
use specs::WorldExt;
use voxelize::{Chunks, ClientFilter, Event, PositionComp, Vec3, VoxelAccess, World};

use super::rules::IntentError;
use super::survival::DamageKind;
use super::{parse, reply, Gameplay};

/// `{ "kind": "clear" | "rain" | "thunder", "precipitation": "rain" | "snow" | "none" }`
/// (what falls where the player stands: snow in cold biomes, nothing in deserts).
pub const WEATHER_EVENT: &str = "platform.weather";
/// `{ "at": [x, y, z] }`: a lightning strike.
pub const LIGHTNING_EVENT: &str = "platform.lightning";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WeatherKind {
    Clear,
    Rain,
    Thunder,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Weather {
    pub kind: WeatherKind,
    /// Seconds until it changes.
    pub remaining: f32,
    #[serde(skip)]
    path: Option<PathBuf>,
}

impl Default for Weather {
    fn default() -> Self {
        Self {
            kind: WeatherKind::Clear,
            remaining: 1200.0,
            path: None,
        }
    }
}

impl Weather {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let path = dir.join("weather.json");
        let mut w = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Weather>(&bytes)
                .map_err(|e| format!("{}: {e}", path.display()))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Weather::default(),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        w.path = Some(path);
        Ok(w)
    }

    pub fn raining(&self) -> bool {
        self.kind != WeatherKind::Clear
    }

    pub fn set(&mut self, kind: WeatherKind, seconds: f32) {
        self.kind = kind;
        self.remaining = seconds;
        if let Some(path) = &self.path {
            let tmp = path.with_extension("json.tmp");
            let ok = std::fs::write(&tmp, serde_json::to_vec(&self).expect("weather serializes"))
                .and_then(|_| std::fs::rename(&tmp, path));
            if let Err(e) = ok {
                log::error!("could not save the weather: {e}");
            }
        }
    }

    /// The next spell after this one: rain after clear (a quarter of it
    /// thunder), clear after rain; `roll` and `length` in 0..1.
    pub fn next(&self, roll: f64, length: f64) -> (WeatherKind, f32) {
        match self.kind {
            WeatherKind::Clear => (
                if roll < 0.25 {
                    WeatherKind::Thunder
                } else {
                    WeatherKind::Rain
                },
                (600.0 + 600.0 * length) as f32,
            ),
            _ => (WeatherKind::Clear, (600.0 + 8400.0 * length) as f32),
        }
    }
}

/// What falls from the sky in a biome of this temperature when it rains.
pub fn precipitation(temperature: f32) -> &'static str {
    if temperature < -0.3 {
        "snow"
    } else if temperature > 0.84 {
        "none"
    } else {
        "rain"
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetPayload {
    kind: WeatherKind,
}

pub(super) fn install(world: &mut World) {
    // Creative players set the weather (an operator's tool).
    world.set_method_handle("platform.weather.set", |world, id, payload| {
        const INTENT: &str = "weather.set";
        let Some(p) = parse::<SetPayload>(world, id, INTENT, payload) else {
            return;
        };
        let result = set(world, id, p.kind);
        reply(world, id, INTENT, result);
    });
}

/// A creative player sets the weather (the intent and `/weather`).
pub(super) fn set(
    world: &mut World,
    id: &str,
    kind: WeatherKind,
) -> Result<serde_json::Value, IntentError> {
    let mut g = world.ecs().write_resource::<Gameplay>();
    match g.players.get(id).map(|pl| pl.realm) {
        None => Err(IntentError::NothingThere),
        Some(Realm::Creative) if g.dimensions.current == Dimension::Overworld => {
            let seconds = if kind == WeatherKind::Clear {
                3600.0
            } else {
                600.0
            };
            g.weather.set(kind, seconds);
            g.weather_changed = true;
            Ok(json!({ "kind": kind }))
        }
        Some(Realm::Creative) => Err(IntentError::CannotUse),
        Some(_) => Err(IntentError::CreativeOnly),
    }
}

/// Turns the weather, tells players, rains out fires and throws lightning.
#[derive(Default)]
pub struct WeatherSystem {
    last: Option<std::time::Instant>,
    since_sync: f32,
    since_bolt: f32,
    /// What each player was last told.
    told: std::collections::HashMap<String, (WeatherKind, &'static str)>,
}

impl<'a> specs::System<'a> for WeatherSystem {
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
            .min(0.5);
        self.last = Some(now);
        if g.dimensions.current != Dimension::Overworld {
            return;
        }
        g.weather.remaining -= dt;
        if g.weather.remaining <= 0.0 {
            let (roll, length) = (g.random(), g.random());
            let (kind, seconds) = g.weather.next(roll, length);
            g.weather.set(kind, seconds);
            g.weather_changed = true;
        }
        g.broken.set_raining(g.weather.raining());

        // Tell each player (on change, on joining, and on walking into snow).
        self.since_sync += dt;
        if self.since_sync >= 2.0 || g.weather_changed {
            self.since_sync = 0.0;
            g.weather_changed = false;
            let kind = g.weather.kind;
            let biome = g.biome.clone();
            let content = g.rules.content_arc();
            for (id, c) in clients.iter() {
                let Some(p) = positions.get(c.entity) else {
                    continue;
                };
                let here = biome(p.0 .0.floor() as i32, p.0 .2.floor() as i32);
                let falls = precipitation(
                    content
                        .biomes()
                        .iter()
                        .find(|b| b.key == here)
                        .map_or(0.5, |b| b.temperature as f32),
                );
                if self.told.get(id) != Some(&(kind, falls)) {
                    self.told.insert(id.clone(), (kind, falls));
                    events.dispatch(
                        Event::new(WEATHER_EVENT)
                            .payload(json!({ "kind": kind, "precipitation": falls }))
                            .filter(ClientFilter::Direct(id.clone()))
                            .build(),
                    );
                }
            }
            self.told.retain(|id, _| clients.contains_key(id));
        }

        // Lightning near a random player now and then during thunder.
        if g.weather.kind != WeatherKind::Thunder {
            return;
        }
        self.since_bolt += dt;
        let next_in = 8.0;
        if self.since_bolt < next_in {
            return;
        }
        self.since_bolt = 0.0;
        let bodies: Vec<(String, [f32; 3])> = clients
            .iter()
            .filter_map(|(id, c)| {
                positions
                    .get(c.entity)
                    .map(|p| (id.clone(), [p.0 .0, p.0 .1, p.0 .2]))
            })
            .collect();
        if bodies.is_empty() {
            return;
        }
        let pick = (g.random() * bodies.len() as f64) as usize % bodies.len();
        let (dx, dz) = (
            (g.random() * 64.0 - 32.0) as i32,
            (g.random() * 64.0 - 32.0) as i32,
        );
        let base = bodies[pick].1;
        let (x, z) = (base[0].floor() as i32 + dx, base[2].floor() as i32 + dz);
        if !chunks.is_chunk_ready(&voxelize::ChunkUtils::map_voxel_to_chunk(
            x,
            0,
            z,
            config.chunk_size,
        )) {
            return;
        }
        strike(&mut g, &mut chunks, &mut events, &bodies, x, z);
    }
}

/// Lightning at a column: fire on top (in unclaimed land), damage close by.
pub(super) fn strike(
    g: &mut Gameplay,
    chunks: &mut Chunks,
    events: &mut voxelize::Events,
    bodies: &[(String, [f32; 3])],
    x: i32,
    z: i32,
) {
    let content = g.rules.content_arc();
    let top = (1..255).rev().find(|&y| {
        content
            .block_by_id(chunks.get_voxel(x, y, z))
            .is_some_and(|b| b.collision || b.fluid.is_some())
    });
    let Some(top) = top else { return };
    let at = [x as f32 + 0.5, top as f32 + 1.0, z as f32 + 0.5];
    let claimed = g
        .dimensions
        .land
        .read()
        .map(|l| l.at(g.dimensions.current, x, z).is_some())
        .unwrap_or(true);
    let ground = content.block_by_id(chunks.get_voxel(x, top, z));
    if !claimed && ground.is_some_and(|b| b.fluid.is_none()) && chunks.get_voxel(x, top + 1, z) == 0
    {
        if let Some(fire) = content.block("fire") {
            chunks.update_voxel(&Vec3(x, top + 1, z), fire.id);
        }
    }
    for (id, eye) in bodies {
        let d = ((eye[0] - at[0]).powi(2) + (eye[2] - at[2]).powi(2)).sqrt();
        if d <= 3.0 && (eye[1] - at[1]).abs() < 4.0 {
            super::combat::hurt_player(g, events, id, *eye, 5.0, DamageKind::Lightning);
            if let Some(p) = g.players.get_mut(id) {
                p.vitals.burning = p.vitals.burning.max(super::survival::BURN_AFTER_FIRE);
            }
        }
    }
    events.dispatch_near(
        Event::new(LIGHTNING_EVENT)
            .payload(json!({ "at": at }))
            .build(),
        at,
        160.0,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rain_follows_clear_and_clear_follows_rain() {
        let mut w = Weather::default();
        assert!(!w.raining());
        let (kind, secs) = w.next(0.9, 0.5);
        assert_eq!(kind, WeatherKind::Rain);
        assert_eq!(secs, 900.0);
        assert_eq!(w.next(0.1, 0.0).0, WeatherKind::Thunder);
        w.set(WeatherKind::Thunder, 10.0);
        assert!(w.raining());
        let (kind, secs) = w.next(0.5, 1.0);
        assert_eq!((kind, secs), (WeatherKind::Clear, 9000.0));
        assert_eq!(precipitation(-0.85), "snow");
        assert_eq!(precipitation(0.1), "rain");
        assert_eq!(precipitation(0.9), "none");
    }
}
