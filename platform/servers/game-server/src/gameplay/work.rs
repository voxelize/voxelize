//! Jobs and daily quests: Crowns for everyday work.
//!
//! A player takes up one job (`platform.job.set`); every action its pay
//! table lists earns hundredths of a Crown. Each day (UTC) the server offers
//! the same few quests from the pool to everyone; finishing one pays its
//! Crowns and experience. Crowns are minted by the backend
//! (`POST /api/internal/v1/rewards`, capped per player per day): payouts
//! wait in the player's record until the backend confirms them, and every
//! payout has a stable key, so a resend is paid once.

use std::collections::{BTreeMap, BTreeSet};

use platform_content::{Content, QuestDef};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specs::WorldExt;
use voxelize::{ClientFilter, Event, World};

use super::bridge::Request;
use super::progress::{matches, Note};
use super::rules::{IntentError, PlayerState};
use super::{now_ms, parse, persist, reply, Gameplay};

/// `{ "day", "quests": [Quest], "job": key | null, "pending": crowns }` to a
/// player when their quests or job change (and in answer to `quests.get`).
pub const WORK_EVENT: &str = "platform.work";
/// Quests offered each day.
pub const DAILY_QUESTS: usize = 3;
/// Seconds between payout attempts.
const PAYOUT_SECONDS: f32 = 20.0;

/// A payout waiting for the backend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payout {
    pub key: String,
    /// `job` or `quest`.
    pub source: String,
    pub reason: String,
    pub amount: u32,
}

/// A player's job, today's quests and unpaid Crowns (saved with the record).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Work {
    #[serde(default)]
    pub job: Option<String>,
    /// Hundredths of a Crown earned in the job and not yet paid out.
    #[serde(default)]
    pub cents: u32,
    /// The day (UTC days since 1970) `progress` and `done` belong to.
    #[serde(default)]
    pub day: u64,
    #[serde(default)]
    pub progress: BTreeMap<String, u32>,
    #[serde(default)]
    pub done: BTreeSet<String>,
    #[serde(default)]
    pub payouts: Vec<Payout>,
    /// Payouts made so far, for unique keys.
    #[serde(default)]
    pub paid_count: u64,
}

pub fn today() -> u64 {
    now_ms() / 86_400_000
}

/// The quests offered on `day`: the same for everyone, varying by day.
pub fn offered(content: &Content, day: u64) -> Vec<&QuestDef> {
    let mut pool: Vec<&QuestDef> = content.quests().iter().collect();
    // A deterministic shuffle seeded by the day.
    let mut seed = day.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xDA11;
    for i in (1..pool.len()).rev() {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        pool.swap(i, (seed % (i as u64 + 1)) as usize);
    }
    pool.truncate(DAILY_QUESTS);
    pool
}

impl Work {
    fn next_key(&mut self, player: &str, source: &str) -> String {
        self.paid_count += 1;
        let tail: String = player
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .rev()
            .take(12)
            .collect();
        format!("{source}{tail}{:x}{:x}", now_ms(), self.paid_count)
    }

    /// Start a new day's quests when the day turned.
    pub fn roll_day(&mut self, day: u64) {
        if self.day != day {
            self.day = day;
            self.progress.clear();
            self.done.clear();
        }
    }

    /// Count a note towards the job and today's quests. Returns the quests
    /// it completed (their experience is the caller's to award).
    pub fn count<'a>(
        &mut self,
        content: &'a Content,
        player: &str,
        day: u64,
        note: &Note,
    ) -> Vec<&'a QuestDef> {
        if let Some(job) = self.job.as_deref().and_then(|k| content.job(k)) {
            for pay in &job.pays {
                if matches(&pay.trigger, note) {
                    self.cents = self
                        .cents
                        .saturating_add(pay.cents.saturating_mul(note.count));
                }
            }
        }
        self.roll_day(day);
        let mut finished = Vec::new();
        for quest in offered(content, day) {
            if self.done.contains(&quest.key) || !matches(&quest.objective, note) {
                continue;
            }
            let n = self.progress.entry(quest.key.clone()).or_default();
            *n = n.saturating_add(note.count).min(quest.objective.count);
            if *n >= quest.objective.count {
                self.done.insert(quest.key.clone());
                if quest.crowns > 0 {
                    let key = self.next_key(player, "q");
                    self.payouts.push(Payout {
                        key,
                        source: "quest".into(),
                        reason: quest.name.clone(),
                        amount: quest.crowns,
                    });
                }
                finished.push(quest);
            }
        }
        finished
    }

    /// Move whole Crowns earned in the job into a payout.
    pub fn bank_job(&mut self, player: &str) {
        let whole = self.cents / 100;
        if whole == 0 {
            return;
        }
        self.cents %= 100;
        let reason = self.job.clone().unwrap_or_else(|| "job".into());
        let key = self.next_key(player, "j");
        self.payouts.push(Payout {
            key,
            source: "job".into(),
            reason,
            amount: whole,
        });
    }

    /// Crowns waiting to be paid (whole Crowns in payouts and the job).
    pub fn pending(&self) -> u32 {
        self.payouts.iter().map(|p| p.amount).sum::<u32>() + self.cents / 100
    }
}

/// What the client shows.
pub fn payload(content: &Content, work: &Work, day: u64) -> Value {
    let fresh = work.day == day;
    let quests: Vec<Value> = offered(content, day)
        .into_iter()
        .map(|q| {
            json!({
                "key": q.key,
                "name": q.name,
                "description": q.description,
                "icon": q.icon,
                "crowns": q.crowns,
                "xp": q.xp,
                "count": q.objective.count,
                "progress": if fresh { work.progress.get(&q.key).copied().unwrap_or(0) } else { 0 },
                "done": fresh && work.done.contains(&q.key),
            })
        })
        .collect();
    json!({ "day": day, "quests": quests, "job": work.job, "pending": work.pending() })
}

/// Counts notes towards jobs and quests (called by the progress system).
pub fn on_notes(
    content: &Content,
    id: &str,
    player: &mut PlayerState,
    notes: &[Note],
    events: &mut voxelize::Events,
) {
    let day = today();
    let mut changed = false;
    let mut finished = Vec::new();
    for note in notes {
        let before = player.work.cents;
        for quest in player.work.count(content, id, day, note) {
            player.xp = player.xp.saturating_add(quest.xp);
            finished.push(json!({ "key": quest.key, "name": quest.name, "crowns": quest.crowns, "xp": quest.xp }));
        }
        changed |= player.work.cents != before
            || offered(content, day)
                .iter()
                .any(|q| matches(&q.objective, note));
    }
    if changed || !finished.is_empty() {
        let mut body = payload(content, &player.work, day);
        body["finished"] = json!(finished);
        events.dispatch(
            Event::new(WORK_EVENT)
                .payload(body)
                .filter(ClientFilter::Direct(id.to_owned()))
                .build(),
        );
    }
}

/// Banks job earnings and sends waiting payouts to the backend.
#[derive(Default)]
pub struct PayoutSystem {
    last: Option<std::time::Instant>,
    since: f32,
}

impl<'a> specs::System<'a> for PayoutSystem {
    type SystemData = specs::WriteExpect<'a, Gameplay>;

    fn run(&mut self, mut g: Self::SystemData) {
        let now = std::time::Instant::now();
        self.since += self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0);
        self.last = Some(now);
        if self.since < PAYOUT_SECONDS {
            return;
        }
        self.since = 0.0;
        let (Some(bridge), Some(world)) = (
            g.dimensions.bridge.clone(),
            g.dimensions
                .world_of(g.dimensions.current)
                .map(str::to_owned),
        ) else {
            return;
        };
        for (id, player) in g.players.iter_mut() {
            player.work.bank_job(id);
            for payout in &player.work.payouts {
                bridge.request(Request::Reward {
                    world: world.clone(),
                    player: id.clone(),
                    payout: payout.clone(),
                });
            }
        }
    }
}

/// The backend confirmed a payout: drop it and tell the player.
pub(super) fn on_rewarded(
    g: &mut Gameplay,
    events: &mut voxelize::Events,
    player: &str,
    key: &str,
    paid: u32,
) {
    let content = g.rules.content_arc();
    let Some(state) = g.players.get_mut(player) else {
        return;
    };
    let Some(index) = state.work.payouts.iter().position(|p| p.key == key) else {
        return;
    };
    let payout = state.work.payouts.remove(index);
    events.dispatch(
        Event::new(super::market::MARKET_EVENT)
            .payload(json!({ "reward": { "source": payout.source, "reason": payout.reason, "requested": payout.amount, "paid": paid } }))
            .filter(ClientFilter::Direct(player.to_owned()))
            .build(),
    );
    let body = payload(&content, &state.work, today());
    events.dispatch(
        Event::new(WORK_EVENT)
            .payload(body)
            .filter(ClientFilter::Direct(player.to_owned()))
            .build(),
    );
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct JobPayload {
    job: Option<String>,
}

pub(super) fn install(world: &mut World) {
    world.set_method_handle("platform.job.set", |world, id, body| {
        const INTENT: &str = "job.set";
        let Some(p) = parse::<JobPayload>(world, id, INTENT, body) else {
            return;
        };
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let content = g.rules.content_arc();
            match g.players.get_mut(id) {
                None => Err(IntentError::NothingThere),
                Some(_) if p.job.as_deref().is_some_and(|k| content.job(k).is_none()) => {
                    Err(IntentError::UnknownItem)
                }
                Some(player) => {
                    // Earnings so far are kept; the new job counts from now.
                    player.work.bank_job(id);
                    player.work.job = p.job.clone();
                    Ok(payload(&content, &player.work, today()))
                }
            }
        };
        reply(world, id, INTENT, result);
        persist(world, id);
    });

    world.set_method_handle("platform.quests.get", |world, id, _| {
        const INTENT: &str = "quests.get";
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let content = g.rules.content_arc();
            match g.players.get_mut(id) {
                None => Err(IntentError::NothingThere),
                Some(player) => {
                    player.work.roll_day(today());
                    Ok(payload(&content, &player.work, today()))
                }
            }
        };
        reply(world, id, INTENT, result);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use platform_content::TriggerKind;

    fn content() -> Content {
        Content::load(platform_content::default_pack_dir()).unwrap()
    }

    fn note(kind: TriggerKind, target: &str, count: u32) -> Note {
        Note {
            kind,
            target: target.into(),
            count,
        }
    }

    #[test]
    fn the_same_quests_for_everyone_each_day_and_different_days_vary() {
        let c = content();
        let a: Vec<&str> = offered(&c, 20_000).iter().map(|q| q.key.as_str()).collect();
        let b: Vec<&str> = offered(&c, 20_000).iter().map(|q| q.key.as_str()).collect();
        assert_eq!(a, b);
        assert_eq!(a.len(), DAILY_QUESTS);
        let other: std::collections::HashSet<Vec<String>> = (0..10)
            .map(|d| {
                offered(&c, 20_000 + d)
                    .iter()
                    .map(|q| q.key.clone())
                    .collect()
            })
            .collect();
        assert!(other.len() > 3, "the offer changes from day to day");
    }

    #[test]
    fn jobs_pay_cents_into_whole_crown_payouts() {
        let c = content();
        let mut w = Work {
            job: Some("miner".into()),
            ..Default::default()
        };
        w.count(&c, "p1", 1, &note(TriggerKind::Mine, "stone", 30));
        w.count(&c, "p1", 1, &note(TriggerKind::Mine, "iron_ore", 1));
        w.count(&c, "p1", 1, &note(TriggerKind::Mine, "oak_log", 5));
        assert_eq!(w.cents, 30 * 4 + 100, "logs do not pay a miner");
        w.bank_job("p1");
        assert_eq!(w.cents, 20);
        assert_eq!(w.payouts.len(), 1);
        assert_eq!(
            (w.payouts[0].source.as_str(), w.payouts[0].amount),
            ("job", 2)
        );
        w.bank_job("p1");
        assert_eq!(w.payouts.len(), 1, "nothing whole to bank");
    }

    #[test]
    fn quests_complete_once_a_day_and_reset_the_next() {
        let c = content();
        // Find a day offering a quest we can drive.
        let day = (0..400)
            .find(|d| offered(&c, *d).iter().any(|q| q.key == "table_maker"))
            .expect("offered some day");
        let mut w = Work::default();
        let craft = note(TriggerKind::Craft, "crafting_table", 1);
        let done = w.count(&c, "p1", day, &craft);
        assert_eq!(
            done.iter().map(|q| q.key.as_str()).collect::<Vec<_>>(),
            ["table_maker"]
        );
        assert_eq!(w.payouts.last().map(|p| p.amount), Some(5));
        assert!(w.count(&c, "p1", day, &craft).is_empty(), "once a day");
        let keys: BTreeSet<_> = w.payouts.iter().map(|p| p.key.clone()).collect();
        assert_eq!(keys.len(), w.payouts.len(), "unique payout keys");
        w.roll_day(day + 1);
        assert!(w.done.is_empty() && w.progress.is_empty());
    }
}
