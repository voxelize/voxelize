//! Moderation from the backend: suspended and banned players are kept out
//! of play (their gameplay state is saved and dropped, so every intent is
//! refused, and the client is told to leave), and muted players cannot
//! chat or use voice. The list comes from the backend's sanctions feed;
//! new game tickets are refused by the backend itself.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::json;
use voxelize::{ClientFilter, Event, PositionComp};

use super::Gameplay;

/// `{ "status": "suspended" | "banned", "reason" }`: this session is over.
pub const KICKED_EVENT: &str = "platform.kicked";

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Sanction {
    pub id: String,
    pub status: String,
    #[serde(default)]
    pub reason: Option<String>,
    /// Unix seconds.
    #[serde(default)]
    pub muted_until: Option<i64>,
    #[serde(default)]
    pub mute_reason: Option<String>,
}

#[derive(Debug, Default)]
pub struct Sanctions {
    by_id: HashMap<String, Sanction>,
}

pub type SharedSanctions = Arc<RwLock<Sanctions>>;

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Sanctions {
    pub fn from_list(list: Vec<Sanction>) -> Self {
        Self {
            by_id: list.into_iter().map(|s| (s.id.clone(), s)).collect(),
        }
    }

    /// Kept out of play: the status and reason.
    pub fn locked(&self, id: &str) -> Option<&Sanction> {
        self.by_id.get(id).filter(|s| s.status != "active")
    }

    /// Muted at `now`: until when and why.
    pub fn muted(&self, id: &str, now: i64) -> Option<(i64, Option<&str>)> {
        let s = self.by_id.get(id)?;
        s.muted_until
            .filter(|u| *u > now)
            .map(|u| (u, s.mute_reason.as_deref()))
    }
}

/// The line a muted player sees.
pub fn muted_line(until: i64, reason: Option<&str>, now: i64) -> String {
    let minutes = ((until - now) as f64 / 60.0).ceil().max(1.0) as i64;
    match reason {
        Some(r) => format!("You are muted for {minutes} more minute(s): {r}"),
        None => format!("You are muted for {minutes} more minute(s)."),
    }
}

#[derive(Deserialize)]
struct Feed {
    players: Vec<Sanction>,
}

/// Fetch the sanctions feed forever (the backend's list is small).
pub async fn poll(url: String, token: String, interval: Duration, shared: SharedSanctions) {
    let client = awc::Client::builder()
        .timeout(Duration::from_secs(10))
        .finish();
    let mut last_error_log: Option<std::time::Instant> = None;
    loop {
        let outcome: Result<Feed, String> = async {
            let mut response = client
                .get(&url)
                .insert_header(("Authorization", format!("Bearer {token}")))
                .insert_header(("Accept", "application/json"))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if response.status().as_u16() != 200 {
                return Err(format!("HTTP {}", response.status().as_u16()));
            }
            let body = response
                .body()
                .limit(8 * 1024 * 1024)
                .await
                .map_err(|e| e.to_string())?;
            serde_json::from_slice(&body).map_err(|e| e.to_string())
        }
        .await;
        match outcome {
            Ok(feed) => {
                if let Ok(mut s) = shared.write() {
                    *s = Sanctions::from_list(feed.players);
                }
            }
            Err(e) => {
                if last_error_log.is_none_or(|t| t.elapsed() > Duration::from_secs(60)) {
                    log::warn!("sanctions feed: {e} (keeping the last list)");
                    last_error_log = Some(std::time::Instant::now());
                }
            }
        }
        actix_web::rt::time::sleep(interval).await;
    }
}

/// Once a second: players who were suspended or banned leave play, and
/// muted players leave voice.
#[derive(Default)]
pub struct SanctionSystem {
    since: f32,
    last: Option<std::time::Instant>,
}

impl<'a> specs::System<'a> for SanctionSystem {
    type SystemData = (
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (clients, positions, mut g, mut events): Self::SystemData) {
        let t = std::time::Instant::now();
        self.since += self
            .last
            .map(|l| t.duration_since(l).as_secs_f32())
            .unwrap_or(0.0);
        self.last = Some(t);
        if self.since < 1.0 {
            return;
        }
        self.since = 0.0;
        let shared = g.dimensions.sanctions.clone();
        let Ok(sanctions) = shared.read() else { return };
        let now = now();
        let locked: Vec<(String, String, Option<String>)> = g
            .players
            .keys()
            .filter_map(|id| {
                sanctions
                    .locked(id)
                    .map(|s| (id.clone(), s.status.clone(), s.reason.clone()))
            })
            .collect();
        let muted: Vec<String> = g
            .players
            .keys()
            .filter(|id| g.voice.peers_of(id).is_some() && sanctions.muted(id, now).is_some())
            .cloned()
            .collect();
        drop(sanctions);
        for id in muted {
            g.voice.leave(&id);
        }
        for (id, status, reason) in locked {
            let position = clients
                .get(&id)
                .and_then(|c| positions.get(c.entity))
                .map(|p| [p.0 .0, p.0 .1, p.0 .2]);
            if let Some(player) = g.players.remove(&id) {
                super::market::save(&g.store, &id, &player, position);
            }
            g.voice.leave(&id);
            log::info!("player {id} is {status}: out of play");
            events.dispatch(
                Event::new(KICKED_EVENT)
                    .payload(json!({ "status": status, "reason": reason }))
                    .filter(ClientFilter::Direct(id))
                    .build(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locked_and_muted_players_are_told_apart() {
        let s = Sanctions::from_list(vec![
            Sanction {
                id: "a".into(),
                status: "banned".into(),
                reason: Some("cheating".into()),
                muted_until: None,
                mute_reason: None,
            },
            Sanction {
                id: "b".into(),
                status: "active".into(),
                reason: None,
                muted_until: Some(1_000),
                mute_reason: Some("spam".into()),
            },
        ]);
        assert_eq!(
            s.locked("a").map(|x| x.reason.as_deref()),
            Some(Some("cheating"))
        );
        assert!(s.locked("b").is_none() && s.locked("c").is_none());
        assert_eq!(s.muted("b", 900), Some((1_000, Some("spam"))));
        assert_eq!(s.muted("b", 1_000), None, "the mute ran out");
        assert_eq!(
            muted_line(1_000, Some("spam"), 900),
            "You are muted for 2 more minute(s): spam"
        );
        assert_eq!(
            muted_line(1_000, None, 999),
            "You are muted for 1 more minute(s)."
        );
    }
}
