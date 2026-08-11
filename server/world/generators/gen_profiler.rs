use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use hashbrown::HashMap;
use log::info;

/// How often the accumulated profile is summarized. Wall-clock rather than
/// per-sample: a cadence of "every N samples per label" scales the log rate
/// with generation throughput, so the profiler shouted loudest exactly when
/// the server was busiest and its output least readable.
const REPORT_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Default, Clone, Copy)]
struct Entry {
    total_nanos: u64,
    count: u64,
    window_nanos: u64,
    window_count: u64,
}

struct Accumulator {
    entries: HashMap<String, Entry>,
    reported_at: Instant,
}

static ACCUM: OnceLock<Mutex<Accumulator>> = OnceLock::new();

pub fn record(label: &str, duration: Duration) {
    // Per-stage wall-time accumulator for the generation pipeline. One lock
    // per stage per chunk, so the overhead is noise compared to the stages
    // themselves. `recent` covers the samples since the previous report so
    // region-dependent costs (calm spawn area vs. drama zone) show up as the
    // player moves; `avg`/`total` are cumulative since boot. Nothing is
    // reported while generation is idle, because nothing calls in.
    let accum = ACCUM.get_or_init(|| {
        Mutex::new(Accumulator {
            entries: HashMap::new(),
            reported_at: Instant::now(),
        })
    });
    let mut accum = accum.lock().unwrap();

    let nanos = duration.as_nanos() as u64;
    let entry = accum.entries.entry(label.to_owned()).or_default();
    entry.total_nanos += nanos;
    entry.count += 1;
    entry.window_nanos += nanos;
    entry.window_count += 1;

    if accum.reported_at.elapsed() < REPORT_INTERVAL {
        return;
    }
    accum.reported_at = Instant::now();

    let mut rows: Vec<(u64, String)> = Vec::with_capacity(accum.entries.len());
    for (label, entry) in accum.entries.iter_mut() {
        let avg_ms = entry.total_nanos as f64 / entry.count as f64 / 1e6;
        let total_ms = entry.total_nanos as f64 / 1e6;
        let recent_ms = if entry.window_count == 0 {
            0.0
        } else {
            entry.window_nanos as f64 / entry.window_count as f64 / 1e6
        };
        rows.push((
            entry.total_nanos,
            format!(
                "  {label}: n={} avg={avg_ms:.3}ms recent={recent_ms:.3}ms over {} total={total_ms:.0}ms",
                entry.count, entry.window_count
            ),
        ));
        entry.window_nanos = 0;
        entry.window_count = 0;
    }
    rows.sort_unstable_by(|a, b| b.0.cmp(&a.0));

    let body: Vec<String> = rows.into_iter().map(|(_, line)| line).collect();
    info!(
        "[genprof] {}s summary, costliest first:\n{}",
        REPORT_INTERVAL.as_secs(),
        body.join("\n")
    );
}
