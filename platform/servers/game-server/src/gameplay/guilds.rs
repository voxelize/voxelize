//! Guilds as the game server sees them: who belongs to which guild, its
//! allies and the guilds it is fighting, from the backend's guild feed
//! (polled like the land feed, cached in `guilds.json`); and the guild
//! vaults, one shared inventory per guild that every vault block of the
//! guild opens, in every dimension (`guild_vaults.json`).
//!
//! Players of two guilds at war may attack each other (`platform.attack.player`);
//! every other player is safe from players.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::inventory::Stack;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GuildInfo {
    pub id: String,
    pub tag: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub members: Vec<String>,
    #[serde(default)]
    pub allies: Vec<String>,
    /// Guilds this one is fighting right now.
    #[serde(default)]
    pub wars: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GuildFeed {
    pub guilds: Vec<GuildInfo>,
}

#[derive(Debug, Default)]
pub struct GuildIndex {
    guilds: Vec<GuildInfo>,
    by_player: HashMap<String, usize>,
    etag: Option<String>,
}

impl GuildIndex {
    pub fn from_feed(feed: GuildFeed) -> Self {
        let mut by_player = HashMap::new();
        for (i, g) in feed.guilds.iter().enumerate() {
            for m in &g.members {
                by_player.entry(m.clone()).or_insert(i);
            }
        }
        Self {
            guilds: feed.guilds,
            by_player,
            etag: None,
        }
    }

    pub fn guild_of(&self, player: &str) -> Option<&GuildInfo> {
        self.by_player.get(player).map(|&i| &self.guilds[i])
    }

    pub fn is_member(&self, player: &str, guild: &str) -> bool {
        self.guild_of(player).is_some_and(|g| g.id == guild)
    }

    /// Whether the two players' guilds are fighting each other.
    pub fn at_war(&self, a: &str, b: &str) -> bool {
        match (self.guild_of(a), self.guild_of(b)) {
            (Some(ga), Some(gb)) => ga.id != gb.id && ga.wars.contains(&gb.id),
            _ => false,
        }
    }
}

pub type SharedGuilds = Arc<RwLock<GuildIndex>>;

fn cache_path(dir: &Path) -> PathBuf {
    dir.join("guilds.json")
}

pub fn load_cached(dir: &Path) -> Result<GuildIndex, String> {
    let path = cache_path(dir);
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<GuildFeed>(&bytes)
            .map(GuildIndex::from_feed)
            .map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(GuildIndex::default()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn save_cached(dir: &Path, feed: &GuildFeed) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = cache_path(dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(feed).expect("feed serializes"))?;
    std::fs::rename(tmp, path)
}

/// Poll the guild feed forever; failures keep the last known guilds.
pub async fn poll(config: super::land::FeedConfig, guilds: SharedGuilds) {
    let client = awc::Client::builder()
        .timeout(Duration::from_secs(10))
        .finish();
    let mut last_error_log: Option<std::time::Instant> = None;
    loop {
        let etag = guilds.read().ok().and_then(|g| g.etag.clone());
        let mut request = client
            .get(&config.url)
            .insert_header(("Authorization", format!("Bearer {}", config.token)))
            .insert_header(("Accept", "application/json"));
        if let Some(etag) = &etag {
            request = request.insert_header(("If-None-Match", etag.clone()));
        }
        let outcome: Result<Option<(GuildFeed, Option<String>)>, String> = async {
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
                    let feed: GuildFeed =
                        serde_json::from_slice(&body).map_err(|e| e.to_string())?;
                    Ok(Some((feed, tag)))
                }
                status => Err(format!("HTTP {status}")),
            }
        }
        .await;
        match outcome {
            Ok(Some((feed, tag))) => {
                if let Err(e) = save_cached(&config.cache_dir, &feed) {
                    log::warn!("could not cache the guild feed: {e}");
                }
                let mut index = GuildIndex::from_feed(feed);
                index.etag = tag;
                if let Ok(mut shared) = guilds.write() {
                    if shared.guilds != index.guilds {
                        log::info!("guild feed: {} guild(s)", index.guilds.len());
                    }
                    *shared = index;
                }
            }
            Ok(None) => {}
            Err(e) => {
                if last_error_log.is_none_or(|t| t.elapsed() > Duration::from_secs(60)) {
                    log::warn!("guild feed unavailable ({e}); keeping the last known guilds");
                    last_error_log = Some(std::time::Instant::now());
                }
            }
        }
        actix_web::rt::time::sleep(config.interval).await;
    }
}

/// Slots in a guild vault.
pub const VAULT_SIZE: usize = 27;

/// Every guild's vault inventory, shared by every vault block and every
/// dimension.
#[derive(Debug, Default)]
pub struct Vaults {
    path: Option<PathBuf>,
    map: HashMap<String, Vec<Option<Stack>>>,
}

pub type SharedVaults = Arc<Mutex<Vaults>>;

impl Vaults {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let path = dir.join("guild_vaults.json");
        let map = match std::fs::read(&path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display()))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        Ok(Self {
            path: Some(path),
            map,
        })
    }

    /// A guild's vault (empty until something is put in).
    pub fn slots(&self, guild: &str) -> Vec<Option<Stack>> {
        self.map
            .get(guild)
            .cloned()
            .unwrap_or_else(|| vec![None; VAULT_SIZE])
    }

    pub fn store(&mut self, guild: &str, mut slots: Vec<Option<Stack>>) -> std::io::Result<()> {
        slots.resize(VAULT_SIZE, None);
        self.map.insert(guild.to_owned(), slots);
        let Some(path) = &self.path else {
            return Ok(());
        };
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(
            &tmp,
            serde_json::to_vec(&self.map).expect("vaults serialize"),
        )?;
        std::fs::rename(tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index() -> GuildIndex {
        GuildIndex::from_feed(GuildFeed {
            guilds: vec![
                GuildInfo {
                    id: "A".into(),
                    tag: "AA".into(),
                    name: "Alpha".into(),
                    members: vec!["ann".into(), "amy".into()],
                    allies: vec![],
                    wars: vec!["B".into()],
                },
                GuildInfo {
                    id: "B".into(),
                    tag: "BB".into(),
                    name: "Bravo".into(),
                    members: vec!["bob".into()],
                    allies: vec!["C".into()],
                    wars: vec!["A".into()],
                },
                GuildInfo {
                    id: "C".into(),
                    tag: "CC".into(),
                    name: "Charlie".into(),
                    members: vec!["cat".into()],
                    allies: vec!["B".into()],
                    wars: vec![],
                },
            ],
        })
    }

    #[test]
    fn only_guilds_at_war_fight() {
        let g = index();
        assert!(g.at_war("ann", "bob") && g.at_war("bob", "amy"));
        assert!(!g.at_war("ann", "amy"), "guildmates");
        assert!(!g.at_war("bob", "cat"), "allies");
        assert!(!g.at_war("ann", "cat"), "no war");
        assert!(!g.at_war("ann", "stranger"));
        assert!(g.is_member("cat", "C") && !g.is_member("cat", "B"));
    }

    #[test]
    fn vaults_are_per_guild_and_persist() {
        let dir = std::env::temp_dir().join(format!("vaults-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut v = Vaults::load(&dir).unwrap();
        assert_eq!(v.slots("A"), vec![None; VAULT_SIZE]);
        let mut slots = v.slots("A");
        slots[3] = Some(Stack {
            item: 7,
            count: 5,
            durability: None,
        });
        v.store("A", slots).unwrap();
        let again = Vaults::load(&dir).unwrap();
        assert_eq!(again.slots("A")[3].as_ref().map(|s| s.count), Some(5));
        assert!(again.slots("B").iter().all(Option::is_none));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
