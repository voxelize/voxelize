//! Saving everything: every minute (players' places and vitals, which
//! change without an intent) and once more when the server is asked to stop
//! (SIGTERM or Ctrl-C), so a restart loses nothing a player did. Players
//! are also written after every intent that changes them; chunks are the
//! engine's to save.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use voxelize::PositionComp;

use super::Gameplay;

/// Set when the process should stop: every world saves once, at once.
pub static STOPPING: AtomicBool = AtomicBool::new(false);
/// Worlds that finished their last save.
pub static FLUSHED: AtomicUsize = AtomicUsize::new(0);
/// Seconds between saves of every player.
pub const AUTOSAVE_SECONDS: f32 = 60.0;

/// Ask every world to save now (the signal handler calls this).
pub fn request_stop() {
    STOPPING.store(true, Ordering::SeqCst);
}

#[derive(Default)]
pub struct SaveSystem {
    since: f32,
    last: Option<std::time::Instant>,
    flushed: bool,
}

/// Write every player here, plus the world's containers, lying items and
/// animals. Returns how many players were written.
pub fn save_all(g: &mut Gameplay, position: impl Fn(&str) -> Option<[f32; 3]>) -> usize {
    let mut n = 0;
    for (id, player) in g.players.iter() {
        super::market::save(&g.store, id, player, position(id));
        n += 1;
    }
    let dir = g.world_dir.clone();
    if let Err(e) = g.containers.save(&dir) {
        log::error!("could not save containers: {e}");
    }
    if let Err(e) = g.drops.save(&dir) {
        log::error!("could not save dropped items: {e}");
    }
    if let Err(e) = super::mobs_api::save(g) {
        log::error!("could not save animals: {e}");
    }
    n
}

impl<'a> specs::System<'a> for SaveSystem {
    type SystemData = (
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
    );

    fn run(&mut self, (clients, positions, mut g): Self::SystemData) {
        let now = std::time::Instant::now();
        self.since += self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0);
        self.last = Some(now);
        let stopping = STOPPING.load(Ordering::SeqCst);
        if stopping && self.flushed {
            return;
        }
        if !stopping && self.since < AUTOSAVE_SECONDS {
            return;
        }
        self.since = 0.0;
        let position = |id: &str| {
            clients
                .get(id)
                .and_then(|c| positions.get(c.entity))
                .map(|p| [p.0 .0, p.0 .1, p.0 .2])
        };
        let n = save_all(&mut g, position);
        if stopping {
            if let Ok(mut p) = g.dimensions.plugins.lock() {
                p.save();
            }
            self.flushed = true;
            FLUSHED.fetch_add(1, Ordering::SeqCst);
            log::info!(
                "{}: saved {n} player(s) before stopping",
                g.dimensions.current.key()
            );
        }
    }
}

/// Once a second: this world's gauges for `/platform/metrics`.
#[derive(Default)]
pub struct MetricsSystem {
    last: Option<std::time::Instant>,
    window_start: Option<std::time::Instant>,
    ticks: u32,
    longest: f32,
}

impl<'a> specs::System<'a> for MetricsSystem {
    type SystemData = specs::ReadExpect<'a, Gameplay>;

    fn run(&mut self, g: Self::SystemData) {
        let now = std::time::Instant::now();
        if let Some(last) = self.last {
            self.longest = self.longest.max(now.duration_since(last).as_secs_f32());
        }
        self.last = Some(now);
        self.ticks += 1;
        let start = *self.window_start.get_or_insert(now);
        if now.duration_since(start).as_secs_f32() < 1.0 {
            return;
        }
        let world = g
            .dimensions
            .world_of(g.dimensions.current)
            .unwrap_or("unknown")
            .to_owned();
        let w = [("world", world.as_str())];
        use crate::metrics::set;
        set("platform_players", &w, g.players.len() as f64);
        set("platform_mobs", &w, g.mobs.list.len() as f64);
        set("platform_dropped_items", &w, g.drops.items.len() as f64);
        set("platform_voice_members", &w, g.voice.members() as f64);
        set("platform_tick_seconds", &w, self.longest as f64);
        set(
            "platform_tick_rate",
            &w,
            self.ticks as f64 / now.duration_since(start).as_secs_f64(),
        );
        if let Ok(p) = g.dimensions.plugins.try_lock() {
            set(
                "platform_plugins_disabled",
                &[],
                p.list.iter().filter(|p| p.disabled).count() as f64,
            );
        }
        self.window_start = Some(now);
        self.ticks = 0;
        self.longest = 0.0;
    }
}
