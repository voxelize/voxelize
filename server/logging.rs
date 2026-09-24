//! Process logger and log rate limiting.
//!
//! Two properties matter for the tick:
//!
//! - **No blocking I/O on a world thread.** Every world thread logs, and the
//!   old logger wrote each line straight to `stdout`. `stdout` is one lock for
//!   the whole process, so a slow pipe (pm2, a paused terminal) stalled every
//!   world at once. Lines now go through a bounded channel to one writer
//!   thread. When that channel is full the line is dropped and counted, and
//!   the writer reports the count once it catches up: losing a debug line is
//!   better than losing a tick.
//! - **Info by default.** Debug stays one environment variable away:
//!   `VOXELIZE_LOG` (or `RUST_LOG` when that is unset) takes a comma-separated
//!   list of `level` and `target=level` directives, e.g. `debug` or
//!   `info,voxelize::world::systems::broadcast=debug`.

use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Instant;

use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use fern::colors::{Color, ColoredLevelConfig};
use log::{info, warn, LevelFilter};

/// Lines buffered between the world threads and the writer thread. At the
/// ~800 lines/s peak the old debug level produced this is several seconds of
/// headroom; beyond it lines are dropped and counted, never waited on.
const LOG_QUEUE_LINES: usize = 16 * 1024;

/// Environment variables read for the log spec, first match wins.
const LOG_ENV_VARS: [&str; 2] = ["VOXELIZE_LOG", "RUST_LOG"];

/// Noisy dependency targets that stay quiet whatever the default level is. An
/// explicit directive for the same target overrides these.
const QUIET_TARGETS: [(&str, LevelFilter); 9] = [
    ("tungstenite", LevelFilter::Info),
    ("webrtc", LevelFilter::Warn),
    ("webrtc_ice", LevelFilter::Warn),
    ("webrtc_sctp", LevelFilter::Warn),
    ("webrtc_dtls", LevelFilter::Warn),
    ("webrtc_srtp", LevelFilter::Warn),
    ("webrtc_data", LevelFilter::Warn),
    ("webrtc_mdns", LevelFilter::Warn),
    ("webrtc_util", LevelFilter::Warn),
];

/// A parsed log spec: the default level, per-target overrides and any
/// directives that could not be read.
#[derive(Debug, PartialEq)]
pub(crate) struct LogSpec {
    pub default: LevelFilter,
    pub targets: Vec<(String, LevelFilter)>,
    pub invalid: Vec<String>,
}

fn parse_level(value: &str) -> Option<LevelFilter> {
    match value.trim().to_ascii_lowercase().as_str() {
        "off" | "none" => Some(LevelFilter::Off),
        "error" => Some(LevelFilter::Error),
        "warn" | "warning" => Some(LevelFilter::Warn),
        "info" => Some(LevelFilter::Info),
        "debug" => Some(LevelFilter::Debug),
        "trace" => Some(LevelFilter::Trace),
        _ => None,
    }
}

/// Parse `level` / `target=level` directives separated by commas. Unknown
/// levels are collected in `invalid` so the caller can say so once the logger
/// is up, instead of silently ignoring them.
pub(crate) fn parse_log_spec(spec: Option<&str>) -> LogSpec {
    let mut parsed = LogSpec {
        default: LevelFilter::Info,
        targets: Vec::new(),
        invalid: Vec::new(),
    };
    let Some(spec) = spec else {
        return parsed;
    };
    for directive in spec.split(',').map(str::trim).filter(|d| !d.is_empty()) {
        match directive.split_once('=') {
            Some((target, level)) => match parse_level(level) {
                Some(level) if !target.trim().is_empty() => {
                    parsed.targets.push((target.trim().to_owned(), level));
                }
                _ => parsed.invalid.push(directive.to_owned()),
            },
            None => match parse_level(directive) {
                Some(level) => parsed.default = level,
                None => parsed.invalid.push(directive.to_owned()),
            },
        }
    }
    parsed
}

fn log_spec_from_env() -> (Option<&'static str>, LogSpec) {
    for name in LOG_ENV_VARS {
        if let Ok(value) = std::env::var(name) {
            if !value.trim().is_empty() {
                return (Some(name), parse_log_spec(Some(&value)));
            }
        }
    }
    (None, parse_log_spec(None))
}

/// The writer half: one thread that owns every `stdout` write.
struct AsyncStdout {
    sender: Sender<String>,
    dropped: Arc<AtomicU64>,
}

impl AsyncStdout {
    fn spawn() -> std::io::Result<Self> {
        let (sender, receiver) = bounded::<String>(LOG_QUEUE_LINES);
        let dropped = Arc::new(AtomicU64::new(0));
        let writer_dropped = Arc::clone(&dropped);
        std::thread::Builder::new()
            .name("log-writer".to_owned())
            .spawn(move || write_lines(receiver, writer_dropped))?;
        Ok(Self { sender, dropped })
    }

    fn send(&self, record: &log::Record) {
        let line = format!("{}\n", record.args());
        match self.sender.try_send(line) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                self.dropped.fetch_add(1, Ordering::Relaxed);
            }
            // The writer thread is gone (it only exits when every sender is
            // dropped, or on a panic): fall back to a direct write so the line
            // is not lost. This path blocks, but it is never the normal one.
            Err(TrySendError::Disconnected(line)) => {
                let _ = std::io::stdout().write_all(line.as_bytes());
            }
        }
    }
}

fn write_lines(receiver: Receiver<String>, dropped: Arc<AtomicU64>) {
    let stdout = std::io::stdout();
    let mut batch = Vec::with_capacity(64 * 1024);
    while let Ok(line) = receiver.recv() {
        batch.extend_from_slice(line.as_bytes());
        // Drain what is already queued so a burst costs one write and one
        // flush, and the stdout lock is only held for the copy.
        while batch.len() < 256 * 1024 {
            match receiver.try_recv() {
                Ok(line) => batch.extend_from_slice(line.as_bytes()),
                Err(_) => break,
            }
        }
        let lost = dropped.swap(0, Ordering::Relaxed);
        if lost > 0 {
            let _ = writeln!(
                batch,
                "{} [WARN] [voxelize::logging]: dropped {} log line(s): stdout could not keep up",
                chrono::Local::now().format("[%H:%M:%S.%3f]"),
                lost
            );
        }
        let mut out = stdout.lock();
        // A failed stdout write has nowhere to be reported (this is the
        // reporting channel); the line is lost either way.
        let _ = out.write_all(&batch);
        let _ = out.flush();
        drop(out);
        batch.clear();
    }
}

/// Install the process logger: Info by default, overridable through
/// `VOXELIZE_LOG` / `RUST_LOG`, written by a dedicated thread.
pub(crate) fn setup_logger() {
    let (source, spec) = log_spec_from_env();

    let mut dispatch = fern::Dispatch::new()
        .format(|out, message, record| {
            let colors = ColoredLevelConfig::new().info(Color::Green);

            // Milliseconds so a client's join timeline (ms since join)
            // can be lined up against the server's chunk and socket logs.
            out.finish(format_args!(
                "{} [{}] [{}]: {}",
                chrono::Local::now().format("[%H:%M:%S.%3f]"),
                colors.color(record.level()),
                record.target(),
                message
            ))
        })
        .level(spec.default);
    for (target, level) in QUIET_TARGETS {
        if !spec.targets.iter().any(|(t, _)| t == target) {
            dispatch = dispatch.level_for(target, level);
        }
    }
    for (target, level) in &spec.targets {
        dispatch = dispatch.level_for(target.clone(), *level);
    }

    let dispatch = match AsyncStdout::spawn() {
        Ok(sink) => dispatch.chain(fern::Output::call(move |record| sink.send(record))),
        Err(err) => {
            eprintln!("[log] could not start the log writer thread ({err}); logging to stdout directly");
            dispatch.chain(std::io::stdout())
        }
    };
    dispatch.apply().expect("Fern did not run successfully");

    info!(
        "[log] default level {} ({}); set VOXELIZE_LOG or RUST_LOG, e.g. `debug` or `info,voxelize=debug`",
        spec.default,
        source.map_or("default".to_owned(), |name| format!("from {name}")),
    );
    if !spec.invalid.is_empty() {
        warn!(
            "[log] ignored unreadable log directive(s): {} (expected `level` or `target=level`)",
            spec.invalid.join(", ")
        );
    }
}

fn process_clock() -> &'static Instant {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now)
}

/// Per-call-site log rate limiter for lines that can fire every tick or for
/// every client. Declare it `static` next to the log line:
///
/// ```ignore
/// static LIMIT: LogRateLimiter = LogRateLimiter::new();
/// if let Some(suppressed) = LIMIT.allow(250) {
///     debug!("[chunk-send] ... (+{suppressed} suppressed)");
/// }
/// ```
///
/// `allow` returns how many lines were suppressed since the last one that was
/// let through, so the rate-limited line still says how busy it was.
pub struct LogRateLimiter {
    /// Milliseconds since process start of the last allowed line, plus one
    /// (zero means "never").
    last_ms: AtomicU64,
    suppressed: AtomicU64,
}

impl LogRateLimiter {
    pub const fn new() -> Self {
        Self {
            last_ms: AtomicU64::new(0),
            suppressed: AtomicU64::new(0),
        }
    }

    /// `Some(suppressed_count)` when at least `interval_ms` passed since the
    /// last allowed line; `None` (and the line is counted) otherwise.
    pub fn allow(&self, interval_ms: u64) -> Option<u64> {
        let now = process_clock().elapsed().as_millis() as u64 + 1;
        let last = self.last_ms.load(Ordering::Relaxed);
        if last != 0 && now.saturating_sub(last) < interval_ms {
            self.suppressed.fetch_add(1, Ordering::Relaxed);
            return None;
        }
        if self
            .last_ms
            .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
        {
            // Another thread let a line through at the same moment.
            self.suppressed.fetch_add(1, Ordering::Relaxed);
            return None;
        }
        Some(self.suppressed.swap(0, Ordering::Relaxed))
    }
}

impl Default for LogRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_spec_is_info() {
        let spec = parse_log_spec(None);
        assert_eq!(spec.default, LevelFilter::Info);
        assert!(spec.targets.is_empty());
        assert!(spec.invalid.is_empty());
    }

    #[test]
    fn spec_reads_levels_and_targets_and_keeps_the_unreadable() {
        let spec = parse_log_spec(Some(" debug, voxelize::world=trace ,webrtc=off, loud, x=bogus "));
        assert_eq!(spec.default, LevelFilter::Debug);
        assert_eq!(
            spec.targets,
            vec![
                ("voxelize::world".to_owned(), LevelFilter::Trace),
                ("webrtc".to_owned(), LevelFilter::Off),
            ]
        );
        assert_eq!(spec.invalid, vec!["loud".to_owned(), "x=bogus".to_owned()]);
    }

    #[test]
    fn rate_limiter_lets_one_through_per_interval_and_counts_the_rest() {
        let limiter = LogRateLimiter::new();
        assert_eq!(limiter.allow(60_000), Some(0));
        assert_eq!(limiter.allow(60_000), None);
        assert_eq!(limiter.allow(60_000), None);
        // A zero interval always allows and reports what was held back.
        assert_eq!(limiter.allow(0), Some(2));
        assert_eq!(limiter.allow(0), Some(0));
    }
}
