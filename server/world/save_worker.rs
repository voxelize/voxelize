//! The background writer every kind of saved world state goes through.
//!
//! A world hands state to disk from its tick thread and must never wait on
//! the disk, and it must never lose state because the disk (or the thread
//! writing to it) fell behind. Both follow from one rule: the worker keeps
//! only the latest value per key. A backlog is then at most one value per
//! live thing, however long the writer takes, so there is no queue to fill
//! and nothing to drop.
//!
//! The writer thread is not trusted to keep running. A thread can hang inside
//! a timed wait across a system sleep and never come back (one did, and nine
//! hours of a world's entities were lost behind it), so the side that submits
//! work watches the age of the oldest unwritten value and starts a fresh
//! thread when it stops being taken. [`SaveWorker::flush`] and `Drop` write
//! the backlog themselves when the thread does not finish in time.

use std::hash::Hash;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use hashbrown::HashMap;
use log::warn;

/// Work that has waited this long means the writer thread is not running. A
/// full save tick writes in a second or two, so nothing healthy gets here.
pub(crate) const SAVE_STALL_LIMIT: Duration = Duration::from_secs(15);

/// A disk that hangs every writer must not grow a new thread every
/// `SAVE_STALL_LIMIT` forever: each takeover doubles the wait, up to this.
const MAX_STALL_LIMIT: Duration = Duration::from_secs(600);

type WriteBatch<K, V> = Box<dyn Fn(HashMap<K, V>) + Send + Sync>;

struct Queue<K, V> {
    pending: HashMap<K, V>,
    /// When the oldest value still in `pending` was submitted. The writer
    /// clears it each time it takes a batch.
    waiting_since: Option<Instant>,
    /// The writer thread allowed to take batches. A thread started under an
    /// older number retires as soon as it runs again.
    writer: u64,
    /// The current writer holds a batch it has not finished writing.
    is_writing: bool,
    /// Someone is waiting in `flush`: skip the coalescing wait.
    is_hurried: bool,
    is_writer_done: bool,
    stall_limit: Duration,
    is_shutting_down: bool,
    handle: Option<JoinHandle<()>>,
}

struct Shared<K, V> {
    label: String,
    queue: Mutex<Queue<K, V>>,
    wake: Condvar,
    coalesce_window: Duration,
    stall_limit: Duration,
    write: WriteBatch<K, V>,
    /// Tests stand a writer thread still the way a hung timed wait does.
    #[cfg(test)]
    freeze_writers: std::sync::atomic::AtomicBool,
    #[cfg(test)]
    frozen_writers: std::sync::atomic::AtomicUsize,
}

impl<K, V> Shared<K, V> {
    fn lock(&self) -> MutexGuard<'_, Queue<K, V>> {
        self.queue.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(crate) struct SaveWorker<K, V>
where
    K: Eq + Hash + Send + 'static,
    V: Send + 'static,
{
    shared: Arc<Shared<K, V>>,
}

impl<K, V> SaveWorker<K, V>
where
    K: Eq + Hash + Send + 'static,
    V: Send + 'static,
{
    /// `label` names the state in logs ("entity saves for worlds/dev").
    /// Values submitted within `coalesce_window` of each other are written as
    /// one batch. `write` runs on the writer thread, and on the caller's
    /// thread when a flush or drop has to finish a stuck writer's work.
    pub(crate) fn new(
        label: impl Into<String>,
        coalesce_window: Duration,
        stall_limit: Duration,
        write: impl Fn(HashMap<K, V>) + Send + Sync + 'static,
    ) -> Self {
        let shared = Arc::new(Shared {
            label: label.into(),
            queue: Mutex::new(Queue {
                pending: HashMap::new(),
                waiting_since: None,
                writer: 0,
                is_writing: false,
                is_hurried: false,
                is_writer_done: false,
                stall_limit,
                is_shutting_down: false,
                handle: None,
            }),
            wake: Condvar::new(),
            coalesce_window,
            stall_limit,
            write: Box::new(write),
            #[cfg(test)]
            freeze_writers: std::sync::atomic::AtomicBool::new(false),
            #[cfg(test)]
            frozen_writers: std::sync::atomic::AtomicUsize::new(0),
        });

        let handle = Self::spawn_writer(&shared, 0);
        shared.lock().handle = Some(handle);

        Self { shared }
    }

    /// Queue the latest value for `key`. `value` sees what is still waiting
    /// for that key, if anything, and returns what replaces it.
    pub(crate) fn submit(&self, key: K, value: impl FnOnce(Option<&V>) -> V) {
        let mut queue = self.shared.lock();
        let was_empty = queue.pending.is_empty();

        let value = value(queue.pending.get(&key));
        queue.pending.insert(key, value);

        let now = Instant::now();
        let waiting_since = *queue.waiting_since.get_or_insert(now);
        let waited = now.duration_since(waiting_since);
        if waited >= queue.stall_limit {
            warn!(
                "{}: {} unwritten after {:.0?}, the save thread is stuck; starting a new one",
                self.shared.label,
                queue.pending.len(),
                waited
            );
            queue.waiting_since = Some(now);
            Self::replace_writer(&self.shared, &mut queue);
        }
        drop(queue);

        if was_empty {
            self.shared.wake.notify_all();
        }
    }

    /// Return once everything submitted so far has been written. A writer
    /// thread that does not get there in time is replaced, and what it had
    /// not yet taken is written on this thread.
    pub(crate) fn flush(&self) {
        let mut queue = self.shared.lock();
        queue.is_hurried = true;
        self.shared.wake.notify_all();

        let mut queue = self
            .shared
            .wake
            .wait_timeout_while(queue, self.shared.stall_limit, |queue| {
                !queue.pending.is_empty() || queue.is_writing
            })
            .unwrap_or_else(PoisonError::into_inner)
            .0;
        queue.is_hurried = false;

        if queue.pending.is_empty() && !queue.is_writing {
            return;
        }

        let left = std::mem::take(&mut queue.pending);
        warn!(
            "{}: the save thread did not finish a flush in {:.0?}; writing {} here and starting a new thread",
            self.shared.label,
            self.shared.stall_limit,
            left.len()
        );
        queue.waiting_since = None;
        Self::replace_writer(&self.shared, &mut queue);
        drop(queue);

        (self.shared.write)(left);
    }

    /// Retire the current writer thread and start another. The retired
    /// thread exits if it ever runs again; whatever is pending is the new
    /// thread's to write.
    fn replace_writer(shared: &Arc<Shared<K, V>>, queue: &mut Queue<K, V>) {
        queue.writer += 1;
        queue.is_writing = false;
        queue.stall_limit = (queue.stall_limit * 2).min(MAX_STALL_LIMIT.max(shared.stall_limit));
        queue.handle = Some(Self::spawn_writer(shared, queue.writer));
    }

    fn spawn_writer(shared: &Arc<Shared<K, V>>, generation: u64) -> JoinHandle<()> {
        let shared = shared.clone();
        thread::Builder::new()
            .name("save-worker".to_owned())
            .spawn(move || Self::writer_loop(&shared, generation))
            .expect("Unable to start a save thread")
    }

    fn writer_loop(shared: &Shared<K, V>, generation: u64) {
        let mut has_written = false;

        loop {
            #[cfg(test)]
            if shared
                .freeze_writers
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                shared
                    .frozen_writers
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                loop {
                    thread::park();
                }
            }

            let mut queue = shared.lock();
            if queue.writer != generation {
                return;
            }
            if has_written {
                queue.is_writing = false;
                queue.stall_limit = shared.stall_limit;
                shared.wake.notify_all();
            }

            while queue.pending.is_empty() {
                if queue.is_shutting_down {
                    queue.is_writer_done = true;
                    shared.wake.notify_all();
                    return;
                }
                queue = shared
                    .wake
                    .wait(queue)
                    .unwrap_or_else(PoisonError::into_inner);
                if queue.writer != generation {
                    return;
                }
            }

            // A save tick submits everything at once: give the rest of it a
            // moment to arrive so it is written as one batch.
            queue = shared
                .wake
                .wait_timeout_while(queue, shared.coalesce_window, |queue| {
                    !queue.is_shutting_down && !queue.is_hurried && queue.writer == generation
                })
                .unwrap_or_else(PoisonError::into_inner)
                .0;
            if queue.writer != generation {
                return;
            }

            queue.waiting_since = None;
            queue.is_writing = true;
            let batch = std::mem::take(&mut queue.pending);
            drop(queue);

            (shared.write)(batch);
            has_written = true;
        }
    }

    #[cfg(test)]
    pub(crate) fn writer_generation(&self) -> u64 {
        self.shared.lock().writer
    }

    /// Stand the writer thread still for good, the way a hung wait does, and
    /// return once it has stopped. Threads started afterwards run normally.
    #[cfg(test)]
    pub(crate) fn freeze_writer(&self, wake_with: (K, V)) {
        use std::sync::atomic::Ordering;

        self.shared.freeze_writers.store(true, Ordering::SeqCst);
        self.submit(wake_with.0, |_| wake_with.1);
        let deadline = Instant::now() + Duration::from_secs(20);
        while self.shared.frozen_writers.load(Ordering::SeqCst) == 0 {
            assert!(Instant::now() < deadline, "the writer never froze");
            thread::sleep(Duration::from_millis(2));
        }
        self.shared.freeze_writers.store(false, Ordering::SeqCst);
    }
}

impl<K, V> Drop for SaveWorker<K, V>
where
    K: Eq + Hash + Send + 'static,
    V: Send + 'static,
{
    fn drop(&mut self) {
        let mut queue = self.shared.lock();
        queue.is_shutting_down = true;
        self.shared.wake.notify_all();

        let mut queue = self
            .shared
            .wake
            .wait_timeout_while(queue, self.shared.stall_limit, |queue| {
                !queue.is_writer_done
            })
            .unwrap_or_else(PoisonError::into_inner)
            .0;

        if queue.is_writer_done {
            let handle = queue.handle.take();
            drop(queue);
            if let Some(handle) = handle {
                let _ = handle.join();
            }
            return;
        }

        // The writer never finished: retire it and write what is left here,
        // so a world that shuts down behind a stuck thread still saves.
        queue.writer += 1;
        let left = std::mem::take(&mut queue.pending);
        drop(queue);

        warn!(
            "{}: the save thread did not finish on shutdown; writing the last {} here",
            self.shared.label,
            left.len()
        );
        (self.shared.write)(left);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Written = Arc<Mutex<Vec<(u32, &'static str)>>>;

    fn recording_worker(stall_limit: Duration) -> (SaveWorker<u32, &'static str>, Written) {
        let written: Written = Arc::default();
        let sink = written.clone();
        let worker = SaveWorker::new(
            "test saves",
            Duration::from_millis(20),
            stall_limit,
            move |batch: HashMap<u32, &'static str>| sink.lock().unwrap().extend(batch),
        );
        (worker, written)
    }

    fn sorted(written: &Written) -> Vec<(u32, &'static str)> {
        let mut written = written.lock().unwrap().clone();
        written.sort();
        written
    }

    #[test]
    fn flush_returns_with_everything_written_and_only_the_latest_value_per_key() {
        let (worker, written) = recording_worker(SAVE_STALL_LIMIT);

        worker.submit(1, |_| "first");
        worker.submit(1, |previous| {
            assert_eq!(previous, Some(&"first"));
            "second"
        });
        worker.submit(2, |_| "other");
        worker.flush();

        assert_eq!(sorted(&written), vec![(1, "second"), (2, "other")]);
    }

    #[test]
    fn a_backlog_far_larger_than_any_fixed_queue_is_written_whole() {
        let written = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let sink = written.clone();
        let worker = SaveWorker::new(
            "test saves",
            Duration::from_millis(20),
            SAVE_STALL_LIMIT,
            move |batch: HashMap<u32, u32>| {
                sink.fetch_add(batch.len(), std::sync::atomic::Ordering::SeqCst);
            },
        );

        for key in 0..200_000 {
            worker.submit(key, |_| key);
        }
        drop(worker);

        assert_eq!(written.load(std::sync::atomic::Ordering::SeqCst), 200_000);
    }

    #[test]
    fn a_stuck_writer_is_replaced_by_the_next_submit_and_its_backlog_written() {
        let stall_limit = Duration::from_millis(150);
        let (worker, written) = recording_worker(stall_limit);
        worker.freeze_writer((0, "wakes the writer"));

        worker.submit(1, |_| "queued behind the stuck thread");
        thread::sleep(stall_limit + Duration::from_millis(50));
        worker.submit(2, |_| "next save tick");

        let deadline = Instant::now() + Duration::from_secs(20);
        while sorted(&written).len() < 3 {
            assert!(Instant::now() < deadline, "the backlog was never written");
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            sorted(&written),
            vec![
                (0, "wakes the writer"),
                (1, "queued behind the stuck thread"),
                (2, "next save tick")
            ]
        );
        assert_eq!(worker.writer_generation(), 1, "one takeover, not several");
    }

    #[test]
    fn flush_behind_a_stuck_writer_writes_the_backlog_itself() {
        let (worker, written) = recording_worker(Duration::from_millis(150));
        worker.freeze_writer((0, "wakes the writer"));

        worker.submit(1, |_| "must not be lost");
        worker.flush();
        assert!(sorted(&written).contains(&(1, "must not be lost")));

        // The replacement thread carries on from there.
        worker.submit(2, |_| "after the takeover");
        worker.flush();
        assert!(sorted(&written).contains(&(2, "after the takeover")));
    }

    #[test]
    fn dropping_behind_a_stuck_writer_writes_the_backlog_itself() {
        let (worker, written) = recording_worker(Duration::from_millis(150));
        worker.freeze_writer((0, "wakes the writer"));
        // Freeze the replacement too: nothing but the drop is left to write.
        worker
            .shared
            .freeze_writers
            .store(true, std::sync::atomic::Ordering::SeqCst);

        worker.submit(1, |_| "last words");
        drop(worker);

        assert!(sorted(&written).contains(&(1, "last words")));
    }
}
