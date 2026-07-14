use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use hashbrown::HashMap;
use log::info;

/// How many samples of a label accumulate before a summary line is logged.
const LOG_EVERY: u64 = 64;

#[derive(Default, Clone, Copy)]
struct Entry {
    total_nanos: u64,
    count: u64,
    window_nanos: u64,
}

static ACCUM: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();

pub fn record(label: &str, duration: Duration) {
    // Per-stage wall-time accumulator for the generation pipeline. One lock
    // per stage per chunk, so the overhead is noise compared to the stages
    // themselves. `window_avg` covers the most recent LOG_EVERY samples so
    // region-dependent costs (calm spawn area vs. drama zone) show up as the
    // player moves; `avg`/`total` are cumulative since boot.
    let map = ACCUM.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = map.lock().unwrap();
    let entry = map.entry(label.to_owned()).or_default();
    let nanos = duration.as_nanos() as u64;
    entry.total_nanos += nanos;
    entry.window_nanos += nanos;
    entry.count += 1;

    if entry.count % LOG_EVERY == 0 {
        let avg_ms = entry.total_nanos as f64 / entry.count as f64 / 1e6;
        let window_avg_ms = entry.window_nanos as f64 / LOG_EVERY as f64 / 1e6;
        let total_ms = entry.total_nanos as f64 / 1e6;
        info!(
            "[genprof] {label}: n={} avg={avg_ms:.3}ms window_avg={window_avg_ms:.3}ms total={total_ms:.0}ms",
            entry.count
        );
        entry.window_nanos = 0;
    }
}
