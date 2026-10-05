//! Player records in MySQL (`player_states`, created by the backend's
//! migrations), shared by every dimension of the world.
//!
//! Reads go straight to the database. Writes never block the game tick:
//! `save` hands the record to a writer thread, which writes the newest
//! record of each player (a burst of saves becomes one write) within a few
//! milliseconds and retries until the database takes it. A record still
//! waiting to be written is what `load` returns, so a player who changes
//! dimension, or leaves and comes straight back, always gets their latest
//! state. `flush` waits until everything is written (on stop).

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use mysql::prelude::Queryable;

use super::store::{PlayerRecord, StoreError, RECORD_VERSION};

#[derive(Default)]
struct Queue {
    /// Waiting to be written: the newest record of each player.
    pending: HashMap<String, PlayerRecord>,
    /// Being written now.
    writing: HashMap<String, PlayerRecord>,
}

pub struct MysqlStore {
    pool: mysql::Pool,
    world: String,
    queue: Mutex<Queue>,
    wake: Condvar,
}

fn db(e: impl std::fmt::Display) -> StoreError {
    StoreError::Db(e.to_string())
}

impl MysqlStore {
    /// Connect, check the table exists and start the writer.
    pub fn connect(url: &str, world: &str) -> Result<Arc<Self>, String> {
        let opts = mysql::Opts::from_url(url).map_err(|e| format!("GAME_DATABASE_URL: {e}"))?;
        let pool =
            mysql::Pool::new(opts).map_err(|e| format!("cannot reach the player database: {e}"))?;
        let mut conn = pool
            .get_conn()
            .map_err(|e| format!("cannot reach the player database: {e}"))?;
        conn.query_drop("SELECT 1 FROM player_states LIMIT 1")
            .map_err(|e| format!("player_states is missing (run the backend's migrations): {e}"))?;
        let store = Arc::new(Self {
            pool,
            world: world.to_owned(),
            queue: Mutex::default(),
            wake: Condvar::new(),
        });
        let writer = store.clone();
        std::thread::Builder::new()
            .name("player-store".into())
            .spawn(move || writer.run())
            .map_err(|e| e.to_string())?;
        Ok(store)
    }

    pub fn load(&self, id: &str) -> Result<Option<PlayerRecord>, StoreError> {
        {
            let q = self.queue.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(r) = q.pending.get(id).or_else(|| q.writing.get(id)) {
                return Ok(Some(r.clone()));
            }
        }
        let mut conn = self.pool.get_conn().map_err(db)?;
        let row: Option<String> = conn
            .exec_first(
                "SELECT CAST(record AS CHAR) FROM player_states WHERE world = ? AND player = ?",
                (&self.world, id),
            )
            .map_err(db)?;
        let Some(text) = row else { return Ok(None) };
        let record: PlayerRecord = serde_json::from_str(&text).map_err(StoreError::Corrupt)?;
        if record.version != RECORD_VERSION {
            return Err(StoreError::UnsupportedVersion(record.version));
        }
        Ok(Some(record))
    }

    /// Queue a record (the newest one of a player wins).
    pub fn save(&self, record: &PlayerRecord) {
        let mut q = self.queue.lock().unwrap_or_else(|p| p.into_inner());
        q.pending.insert(record.id.clone(), record.clone());
        self.wake.notify_all();
    }

    /// Wait until every queued record is written, at most `timeout`.
    pub fn flush(&self, timeout: Duration) -> bool {
        let end = Instant::now() + timeout;
        let mut q = self.queue.lock().unwrap_or_else(|p| p.into_inner());
        while !(q.pending.is_empty() && q.writing.is_empty()) {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            q = self
                .wake
                .wait_timeout(q, left.min(Duration::from_millis(50)))
                .unwrap_or_else(|p| p.into_inner())
                .0;
        }
        true
    }

    /// Records still waiting (for metrics and tests).
    pub fn backlog(&self) -> usize {
        let q = self.queue.lock().unwrap_or_else(|p| p.into_inner());
        q.pending.len() + q.writing.len()
    }

    fn write(&self, batch: &HashMap<String, PlayerRecord>) -> Result<(), StoreError> {
        let mut conn = self.pool.get_conn().map_err(db)?;
        let mut tx = conn
            .start_transaction(mysql::TxOpts::default())
            .map_err(db)?;
        for r in batch.values() {
            let json = serde_json::to_string(r).map_err(StoreError::Corrupt)?;
            let pos = r.position.unwrap_or([f32::NAN; 3]);
            let opt = |v: f32| if v.is_finite() { Some(v) } else { None };
            tx.exec_drop(
                "INSERT INTO player_states (world, player, dimension, record_version, record, health, xp, x, y, z, revision, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE dimension = VALUES(dimension), record_version = VALUES(record_version),
                   record = VALUES(record), health = VALUES(health), xp = VALUES(xp), x = VALUES(x), y = VALUES(y),
                   z = VALUES(z), revision = revision + 1, updated_at = UTC_TIMESTAMP()",
                (
                    &self.world,
                    &r.id,
                    r.dimension.key(),
                    r.version,
                    json,
                    r.vitals.health,
                    r.xp,
                    opt(pos[0]),
                    opt(pos[1]),
                    opt(pos[2]),
                ),
            )
            .map_err(db)?;
        }
        tx.commit().map_err(db)
    }

    fn run(&self) {
        let mut backoff = Duration::from_millis(100);
        loop {
            let batch = {
                let mut q = self.queue.lock().unwrap_or_else(|p| p.into_inner());
                while q.pending.is_empty() {
                    q = self.wake.wait(q).unwrap_or_else(|p| p.into_inner());
                }
                let batch = std::mem::take(&mut q.pending);
                q.writing = batch.clone();
                batch
            };
            let result = self.write(&batch);
            let mut q = self.queue.lock().unwrap_or_else(|p| p.into_inner());
            q.writing.clear();
            match result {
                Ok(()) => backoff = Duration::from_millis(100),
                Err(e) => {
                    // Put them back unless a newer record arrived meanwhile.
                    for (id, r) in batch {
                        q.pending.entry(id).or_insert(r);
                    }
                    log::error!("player records not written ({e}); retrying in {backoff:?}");
                    drop(q);
                    std::thread::sleep(backoff);
                    backoff = (backoff * 2).min(Duration::from_secs(5));
                    continue;
                }
            }
            self.wake.notify_all();
        }
    }
}

#[cfg(test)]
mod tests {
    //! Against a real database when PLATFORM_TEST_DATABASE_URL is set
    //! (a database with the backend's migrations run); skipped otherwise.
    use super::*;
    use crate::gameplay::inventory::{Inventory, Stack};
    use crate::gameplay::survival::Vitals;

    fn record(id: &str, coal: u32) -> PlayerRecord {
        let mut inventory = Inventory::default();
        inventory.slots[0] = Some(Stack {
            item: 7,
            count: coal,
            durability: None,
        });
        PlayerRecord {
            version: RECORD_VERSION,
            id: id.into(),
            inventory,
            position: Some([1.5, 70.0, -3.0]),
            vitals: Vitals::default(),
            armor: vec![None; 4],
            offhand: None,
            dimension: platform_content::Dimension::Overworld,
            arrival: None,
            outbox: vec![],
            delivered: vec![],
            trade_hold: None,
            home: None,
            xp: 12,
            mode: Default::default(),
            progress: Default::default(),
            work: Default::default(),
        }
    }

    #[test]
    fn records_are_written_in_order_and_read_back() {
        let Ok(url) = std::env::var("PLATFORM_TEST_DATABASE_URL") else {
            eprintln!("PLATFORM_TEST_DATABASE_URL not set: skipped");
            return;
        };
        let world = format!("test_{}", std::process::id());
        let store = MysqlStore::connect(&url, &world).unwrap();
        assert!(store.load("p1").unwrap().is_none());
        for coal in 1..=50 {
            store.save(&record("p1", coal));
        }
        assert_eq!(
            store.load("p1").unwrap().unwrap().inventory.slots[0]
                .as_ref()
                .unwrap()
                .count,
            50,
            "a queued write is read back"
        );
        assert!(store.flush(Duration::from_secs(10)));
        assert_eq!(store.backlog(), 0);
        // A second store (another process, a restart) sees the newest record.
        let again = MysqlStore::connect(&url, &world).unwrap();
        let back = again.load("p1").unwrap().unwrap();
        assert_eq!(back, record("p1", 50));
        // Another world keeps its own record.
        let other = MysqlStore::connect(&url, &format!("{world}_b")).unwrap();
        assert!(other.load("p1").unwrap().is_none());
        let mut conn = again.pool.get_conn().unwrap();
        let row: Option<(String, u32, f64)> = conn
            .exec_first(
                "SELECT dimension, xp, x FROM player_states WHERE world = ? AND player = 'p1'",
                (&world,),
            )
            .unwrap();
        assert_eq!(row, Some(("overworld".into(), 12, 1.5)));
        conn.exec_drop(
            "DELETE FROM player_states WHERE world LIKE ?",
            (format!("{world}%"),),
        )
        .unwrap();
    }
}
