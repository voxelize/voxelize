//! Prometheus metrics (`GET /platform/metrics`, text format 0.0.4): counters
//! the gameplay code bumps as things happen, and gauges each world sets
//! once a second. A process-wide registry: every world shares it, so each
//! sample carries the world (dimension) it came from.

use std::collections::BTreeMap;
use std::fmt::Write;
use std::sync::{Mutex, OnceLock};

type Labels = Vec<(String, String)>;

#[derive(Default)]
struct Registry {
    counters: BTreeMap<String, BTreeMap<Labels, u64>>,
    gauges: BTreeMap<String, BTreeMap<Labels, f64>>,
}

fn registry() -> &'static Mutex<Registry> {
    static R: OnceLock<Mutex<Registry>> = OnceLock::new();
    R.get_or_init(Default::default)
}

fn labels(pairs: &[(&str, &str)]) -> Labels {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

/// What each metric means (`# HELP`); names not listed get none.
const HELP: &[(&str, &str, &str)] = &[
    (
        "platform_intents_total",
        "counter",
        "Intents answered, by intent and result (ok or the refusal code).",
    ),
    (
        "platform_chat_lines_total",
        "counter",
        "Chat lines by channel.",
    ),
    (
        "platform_bridge_requests_total",
        "counter",
        "Requests queued for the backend, by kind.",
    ),
    ("platform_players", "gauge", "Players in play, by world."),
    ("platform_mobs", "gauge", "Creatures, by world."),
    (
        "platform_dropped_items",
        "gauge",
        "Items lying on the ground, by world.",
    ),
    (
        "platform_voice_members",
        "gauge",
        "Players with voice on, by world.",
    ),
    (
        "platform_tick_seconds",
        "gauge",
        "Longest gap between two game ticks in the last second, by world.",
    ),
    (
        "platform_tick_rate",
        "gauge",
        "Game ticks in the last second, by world.",
    ),
    (
        "platform_plugins_disabled",
        "gauge",
        "Server plugins switched off after failing.",
    ),
];

pub fn inc(name: &str, pairs: &[(&str, &str)]) {
    if let Ok(mut r) = registry().lock() {
        *r.counters
            .entry(name.to_owned())
            .or_default()
            .entry(labels(pairs))
            .or_insert(0) += 1;
    }
}

pub fn set(name: &str, pairs: &[(&str, &str)], value: f64) {
    if let Ok(mut r) = registry().lock() {
        r.gauges
            .entry(name.to_owned())
            .or_default()
            .insert(labels(pairs), value);
    }
}

fn escape(v: &str) -> String {
    v.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn series(out: &mut String, name: &str, l: &Labels, value: String) {
    if l.is_empty() {
        let _ = writeln!(out, "{name} {value}");
    } else {
        let inner: Vec<String> = l
            .iter()
            .map(|(k, v)| format!("{k}=\"{}\"", escape(v)))
            .collect();
        let _ = writeln!(out, "{name}{{{}}} {value}", inner.join(","));
    }
}

/// Every metric in the Prometheus text format.
pub fn render() -> String {
    let mut out = String::new();
    let Ok(r) = registry().lock() else { return out };
    let header = |out: &mut String, name: &str, kind: &str| {
        if let Some((_, _, help)) = HELP.iter().find(|(n, _, _)| *n == name) {
            let _ = writeln!(out, "# HELP {name} {help}");
        }
        let _ = writeln!(out, "# TYPE {name} {kind}");
    };
    for (name, values) in &r.counters {
        header(&mut out, name, "counter");
        for (l, v) in values {
            series(&mut out, name, l, v.to_string());
        }
    }
    for (name, values) in &r.gauges {
        header(&mut out, name, "gauge");
        for (l, v) in values {
            series(&mut out, name, l, format!("{v}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_and_gauges_render_as_prometheus_text() {
        inc("test_things_total", &[("kind", "a")]);
        inc("test_things_total", &[("kind", "a")]);
        inc("test_things_total", &[("kind", "b\"q")]);
        set("test_level", &[], 2.5);
        let text = render();
        assert!(text.contains("# TYPE test_things_total counter\n"));
        assert!(text.contains("test_things_total{kind=\"a\"} 2\n"));
        assert!(
            text.contains("test_things_total{kind=\"b\\\"q\"} 1\n"),
            "label values are escaped"
        );
        assert!(text.contains("# TYPE test_level gauge\ntest_level 2.5\n"));
    }
}
