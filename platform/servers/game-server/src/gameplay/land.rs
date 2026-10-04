//! Land ownership as the game server enforces it.
//!
//! The business backend owns claims (`LandService`, MySQL, paid through the
//! ledger). This server keeps a copy, refreshed from the backend's internal
//! feed (`GET /api/internal/v1/lands?world=…`, polled with an ETag) and saved
//! to `lands.json` so a restart while the backend is unreachable still knows
//! every claim it last saw. Every block intent asks [`LandIndex::allows`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use platform_content::Dimension;
use serde::{Deserialize, Serialize};
use serde_json::json;
use voxelize::{ClientFilter, Event, PositionComp};

use super::Gameplay;

/// Land is claimed in chunks of this many blocks, whatever the engine's
/// chunk size.
pub const LAND_CHUNK: i32 = 16;
/// Sent to a player who walks into different land: `{ "land": {...} | null }`.
pub const LAND_EVENT: &str = "platform.land";

/// What a block intent needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Break, place, till, light portals.
    Build,
    /// Open chests and furnaces.
    Containers,
    /// Levers, buttons, clocks, gates.
    Use,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Permissions {
    #[serde(default)]
    pub build: bool,
    #[serde(default)]
    pub containers: bool,
    #[serde(default, rename = "use")]
    pub use_: bool,
}

impl Permissions {
    fn allows(&self, action: Action) -> bool {
        match action {
            Action::Build => self.build,
            Action::Containers => self.containers,
            Action::Use => self.use_,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Person {
    pub id: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Member {
    pub id: String,
    pub role: String,
}

/// The guild holding a land, if any (its leader is the land's owner).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GuildTag {
    pub id: String,
    pub name: String,
    pub tag: String,
}

/// The settlement (village, town, city) a guild land is part of.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settlement {
    pub name: String,
    pub level: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Land {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub dimension: Dimension,
    pub min: [i32; 2],
    pub max: [i32; 2],
    pub owner: Person,
    #[serde(default)]
    pub guild: Option<GuildTag>,
    #[serde(default)]
    pub settlement: Option<Settlement>,
    #[serde(default)]
    pub members: Vec<Member>,
    #[serde(default)]
    pub public: Permissions,
}

impl Land {
    /// The role a player has here: `owner`, a member role, or `None`.
    pub fn role_of(&self, player: &str) -> Option<&str> {
        if self.owner.id == player {
            return Some("owner");
        }
        self.members
            .iter()
            .find(|m| m.id == player)
            .map(|m| m.role.as_str())
    }

    pub fn allows(&self, player: &str, action: Action) -> bool {
        match self.role_of(player) {
            Some("owner" | "manager" | "builder") => true,
            Some("visitor") => action == Action::Use || self.public.allows(action),
            _ => self.public.allows(action),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Feed {
    pub world: String,
    pub lands: Vec<Land>,
}

/// Every claim of this world, looked up by land chunk.
#[derive(Debug, Default)]
pub struct LandIndex {
    lands: Vec<Land>,
    by_chunk: HashMap<(Dimension, i32, i32), usize>,
    /// The feed's ETag, sent back so an unchanged feed costs nothing.
    etag: Option<String>,
}

impl LandIndex {
    pub fn from_feed(feed: Feed) -> Self {
        let mut by_chunk = HashMap::new();
        for (i, land) in feed.lands.iter().enumerate() {
            // The backend never stores overlaps; a bad feed keeps the first.
            for cx in land.min[0]..=land.max[0] {
                for cz in land.min[1]..=land.max[1] {
                    by_chunk.entry((land.dimension, cx, cz)).or_insert(i);
                }
            }
        }
        Self {
            lands: feed.lands,
            by_chunk,
            etag: None,
        }
    }

    pub fn len(&self) -> usize {
        self.lands.len()
    }

    /// The land covering a block, if any.
    pub fn at(&self, dimension: Dimension, x: i32, z: i32) -> Option<&Land> {
        let key = (
            dimension,
            x.div_euclid(LAND_CHUNK),
            z.div_euclid(LAND_CHUNK),
        );
        self.by_chunk.get(&key).map(|&i| &self.lands[i])
    }

    /// Whether `player` may do `action` at a block. Unclaimed land allows
    /// everything.
    pub fn allows(
        &self,
        dimension: Dimension,
        player: &str,
        voxel: [i32; 3],
        action: Action,
    ) -> bool {
        self.at(dimension, voxel[0], voxel[2])
            .is_none_or(|land| land.allows(player, action))
    }
}

/// The world's land, shared by every dimension's world and the feed task.
pub type SharedLand = Arc<RwLock<LandIndex>>;

/// `lands.json` in the world directory: the last feed seen.
fn cache_path(dir: &Path) -> PathBuf {
    dir.join("lands.json")
}

/// The last feed saved, or no land at all.
pub fn load_cached(dir: &Path) -> Result<LandIndex, String> {
    let path = cache_path(dir);
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<Feed>(&bytes)
            .map(LandIndex::from_feed)
            .map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LandIndex::default()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn save_cached(dir: &Path, feed: &Feed) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = cache_path(dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(feed).expect("feed serializes"))?;
    std::fs::rename(tmp, path)
}

/// Where and how to fetch the feed.
#[derive(Debug, Clone)]
pub struct FeedConfig {
    pub url: String,
    pub token: String,
    pub interval: Duration,
    pub cache_dir: PathBuf,
}

/// Poll the backend forever on the server's async runtime. Failures keep
/// the last known land and are logged at most once a minute.
pub async fn poll(config: FeedConfig, land: SharedLand) {
    let client = awc::Client::builder()
        .timeout(Duration::from_secs(10))
        .finish();
    let mut last_error_log: Option<std::time::Instant> = None;
    loop {
        let etag = land.read().ok().and_then(|l| l.etag.clone());
        let mut request = client
            .get(&config.url)
            .insert_header(("Authorization", format!("Bearer {}", config.token)))
            .insert_header(("Accept", "application/json"));
        if let Some(etag) = &etag {
            request = request.insert_header(("If-None-Match", etag.clone()));
        }
        let outcome: Result<Option<(Feed, Option<String>)>, String> = async {
            let mut response = request.send().await.map_err(|e| e.to_string())?;
            match response.status().as_u16() {
                304 => Ok(None),
                200 => {
                    let tag = response
                        .headers()
                        .get("ETag")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_owned);
                    let body = response
                        .body()
                        .limit(16 * 1024 * 1024)
                        .await
                        .map_err(|e| e.to_string())?;
                    let feed: Feed = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
                    Ok(Some((feed, tag)))
                }
                status => Err(format!("HTTP {status}")),
            }
        }
        .await;
        match outcome {
            Ok(Some((feed, tag))) => {
                if let Err(e) = save_cached(&config.cache_dir, &feed) {
                    log::warn!("could not cache the land feed: {e}");
                }
                let count = feed.lands.len();
                let mut index = LandIndex::from_feed(feed);
                index.etag = tag;
                if let Ok(mut shared) = land.write() {
                    if shared.lands != index.lands {
                        log::info!("land feed: {count} claim(s)");
                    }
                    *shared = index;
                }
            }
            Ok(None) => {}
            Err(e) => {
                if last_error_log.is_none_or(|t| t.elapsed() > Duration::from_secs(60)) {
                    log::warn!("land feed unavailable ({e}); enforcing the last known claims");
                    last_error_log = Some(std::time::Instant::now());
                }
            }
        }
        actix_web::rt::time::sleep(config.interval).await;
    }
}

/// Tells players when they walk into different land.
#[derive(Default)]
pub struct LandNoticeSystem {
    since: f32,
    last: Option<std::time::Instant>,
}

impl<'a> specs::System<'a> for LandNoticeSystem {
    type SystemData = (
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (clients, positions, mut g, mut events): Self::SystemData) {
        let now = std::time::Instant::now();
        self.since += self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0);
        self.last = Some(now);
        if self.since < 0.25 {
            return;
        }
        self.since = 0.0;
        let dimension = g.dimensions.current;
        let land = g.dimensions.land.clone();
        let Ok(index) = land.read() else {
            return;
        };
        for (id, client) in clients.iter() {
            let Some(p) = positions.get(client.entity) else {
                continue;
            };
            let Some(player) = g.players.get_mut(id) else {
                continue;
            };
            let here = index.at(dimension, p.0 .0.floor() as i32, p.0 .2.floor() as i32);
            let key = here.map(|l| l.id.clone());
            if key == player.land_seen {
                continue;
            }
            player.land_seen = key;
            let payload = match here {
                Some(l) => json!({ "land": {
                    "id": l.id,
                    "name": l.name,
                    "owner": l.owner,
                    "guild": l.guild,
                    "settlement": l.settlement,
                    "role": l.role_of(id),
                    "public": l.public,
                    "min": l.min,
                    "max": l.max,
                }}),
                None => json!({ "land": null }),
            };
            events.dispatch(
                Event::new(LAND_EVENT)
                    .payload(payload)
                    .filter(ClientFilter::Direct(id.clone()))
                    .build(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed() -> Feed {
        serde_json::from_value(json!({
            "world": "main",
            "lands": [{
                "id": "L1", "name": "Homestead", "dimension": "overworld",
                "min": [0, 0], "max": [1, 2],
                "owner": { "id": "alice", "name": "alice" },
                "members": [{ "id": "bob", "role": "builder" }, { "id": "vic", "role": "visitor" }],
                "public": { "build": false, "containers": false, "use": true },
                "version": 3
            }, {
                "id": "L2", "dimension": "underworld", "min": [-1, -1], "max": [-1, -1],
                "owner": { "id": "carol" }
            }, {
                "id": "L3", "dimension": "overworld", "min": [10, 10], "max": [10, 10],
                "owner": { "id": "lead", "name": "lead" },
                "guild": { "id": "G1", "name": "Stone Wardens", "tag": "SW" },
                "settlement": { "name": "Stone Wardens", "level": "village" },
                "members": [{ "id": "off", "role": "manager" }, { "id": "mem", "role": "builder" }]
            }]
        }))
        .unwrap()
    }

    #[test]
    fn guild_land_lets_every_member_build() {
        let index = LandIndex::from_feed(feed());
        let o = Dimension::Overworld;
        for who in ["lead", "off", "mem"] {
            assert!(index.allows(o, who, [165, 70, 165], Action::Build));
        }
        assert!(!index.allows(o, "stranger", [165, 70, 165], Action::Build));
        let land = index.at(o, 165, 165).unwrap();
        assert_eq!(land.guild.as_ref().unwrap().tag, "SW");
        assert_eq!(land.settlement.as_ref().unwrap().level, "village");
    }

    #[test]
    fn claims_protect_their_chunks_by_role() {
        let index = LandIndex::from_feed(feed());
        let o = Dimension::Overworld;
        // Inside L1 (blocks 0..32 x 0..48).
        assert!(index.allows(o, "alice", [5, 70, 40], Action::Build));
        assert!(index.allows(o, "bob", [31, 70, 47], Action::Containers));
        assert!(!index.allows(o, "eve", [5, 70, 40], Action::Build));
        assert!(!index.allows(o, "eve", [5, 70, 40], Action::Containers));
        assert!(
            index.allows(o, "eve", [5, 70, 40], Action::Use),
            "public use allowed"
        );
        assert!(index.allows(o, "vic", [5, 70, 40], Action::Use));
        assert!(!index.allows(o, "vic", [5, 70, 40], Action::Build));
        // Just outside, and the same blocks in the other dimension.
        assert!(index.allows(o, "eve", [32, 70, 0], Action::Build));
        assert!(index.allows(o, "eve", [5, 70, 48], Action::Build));
        assert!(index.allows(Dimension::Underworld, "eve", [5, 70, 40], Action::Build));
        // Negative coordinates map to chunk -1.
        let u = Dimension::Underworld;
        assert!(!index.allows(u, "eve", [-1, 40, -16], Action::Build));
        assert!(index.allows(u, "eve", [-1, 40, -17], Action::Build));
        assert!(index.allows(u, "carol", [-16, 40, -16], Action::Build));
        assert_eq!(
            index.at(o, 0, 0).map(|l| l.name.as_str()),
            Some("Homestead")
        );
    }

    #[test]
    fn the_last_feed_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("land-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load_cached(&dir).unwrap().len(), 0, "no cache: no land");
        save_cached(&dir, &feed()).unwrap();
        let index = load_cached(&dir).unwrap();
        assert_eq!(index.len(), 3);
        assert!(!index.allows(Dimension::Overworld, "eve", [1, 1, 1], Action::Build));
        std::fs::write(cache_path(&dir), b"{broken").unwrap();
        assert!(
            load_cached(&dir).is_err(),
            "a corrupt cache is an error, not empty land"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
