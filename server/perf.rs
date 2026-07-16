use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

use serde_json::{json, Map, Value};

use crate::{Message, MessageType};

const CHAT_PREVIEW_LENGTH: usize = 40;
const PERF_PREFIX: &str = "[PERF] ";
const TICK_SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

static IS_ENABLED: OnceLock<bool> = OnceLock::new();
static STARTED_AT: OnceLock<Instant> = OnceLock::new();
static WRITER: OnceLock<Mutex<File>> = OnceLock::new();
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static TRACE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static INBOUND_DEPTHS: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();

#[derive(Clone)]
pub enum OutboundPerfKind {
    Chat {
        body_preview: String,
        t_send_ms: f64,
    },
    Entity {
        item_count: usize,
    },
}

#[derive(Clone)]
pub struct OutboundPerf {
    pub trace_id: String,
    pub kind: OutboundPerfKind,
}

pub struct WorldPerfMetrics {
    last_sample_at: Instant,
    messages_since_tick: usize,
    messages_since_sample: usize,
}

impl WorldPerfMetrics {
    pub fn new() -> Self {
        Self {
            last_sample_at: Instant::now(),
            messages_since_tick: 0,
            messages_since_sample: 0,
        }
    }

    pub fn record_message(&mut self) {
        self.messages_since_tick += 1;
        self.messages_since_sample += 1;
    }

    pub fn finish_tick(&mut self) -> (usize, Option<usize>) {
        let messages_this_tick = std::mem::take(&mut self.messages_since_tick);
        if self.last_sample_at.elapsed() < TICK_SAMPLE_INTERVAL {
            return (messages_this_tick, None);
        }
        self.last_sample_at = Instant::now();
        let messages_since_sample = std::mem::take(&mut self.messages_since_sample);
        (messages_this_tick, Some(messages_since_sample))
    }
}

pub fn is_enabled() -> bool {
    *IS_ENABLED.get_or_init(|| {
        matches!(
            std::env::var("TOWN_PERF_LOG").as_deref(),
            Ok("1") | Ok("true") | Ok("TRUE")
        )
    })
}

pub fn monotonic_ms() -> f64 {
    STARTED_AT.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

pub fn next_trace_id(category: &str) -> String {
    let sequence = TRACE_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    format!("core-{category}-{}-{sequence}", std::process::id())
}

pub fn log(event: &str, world: &str, fields: Value) {
    log_at(event, world, monotonic_ms(), fields);
}

pub fn log_at(event: &str, world: &str, timestamp_ms: f64, fields: Value) {
    if !is_enabled() {
        return;
    }

    let mut payload = match fields {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    payload.insert("component".to_owned(), json!("core"));
    payload.insert("event".to_owned(), json!(event));
    payload.insert("monotonicMs".to_owned(), json!(timestamp_ms));
    // Wall-clock epoch ms, so events can be correlated across processes on
    // one machine (e.g. server dispatch -> browser client apply) when
    // measuring end-to-end lifecycle latency.
    payload.insert(
        "epochMs".to_owned(),
        json!(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)),
    );
    payload.insert("world".to_owned(), json!(world));
    payload.insert(
        "seq".to_owned(),
        json!(SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1),
    );

    let Ok(serialized) = serde_json::to_string(&payload) else {
        return;
    };
    let Ok(writer) = writer() else {
        return;
    };
    if let Ok(mut file) = writer.lock() {
        let _ = writeln!(file, "{PERF_PREFIX}{serialized}");
        let _ = file.flush();
    }
    println!("{PERF_PREFIX}{serialized}");
}

pub fn outbound(message: &Message) -> Option<OutboundPerf> {
    if !is_enabled() {
        return None;
    }

    match MessageType::try_from(message.r#type).ok()? {
        MessageType::Chat => {
            let chat = message.chat.as_ref()?;
            if chat.trace_id.is_empty() {
                return None;
            }
            Some(OutboundPerf {
                trace_id: chat.trace_id.clone(),
                kind: OutboundPerfKind::Chat {
                    body_preview: chat.body.chars().take(CHAT_PREVIEW_LENGTH).collect(),
                    t_send_ms: chat.t_send_ms,
                },
            })
        }
        MessageType::Entity => {
            let json: Value = serde_json::from_str(&message.json).ok()?;
            let trace_id = json.get("townPerfTraceId")?.as_str()?.to_owned();
            Some(OutboundPerf {
                trace_id,
                kind: OutboundPerfKind::Entity {
                    item_count: message.entities.len(),
                },
            })
        }
        _ => None,
    }
}

pub fn chat_fields(message: &Message) -> Option<Value> {
    if !is_enabled() {
        return None;
    }
    let chat = message.chat.as_ref()?;
    let trace_id = if chat.trace_id.is_empty() {
        next_trace_id("chat")
    } else {
        chat.trace_id.clone()
    };
    Some(json!({
        "traceId": trace_id,
        "tSendMs": chat.t_send_ms,
        "bodyPreview": chat.body.chars().take(CHAT_PREVIEW_LENGTH).collect::<String>(),
    }))
}

pub fn increment_inbound(world: &str) {
    if !is_enabled() {
        return;
    }
    let depths = INBOUND_DEPTHS.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut depths) = depths.lock() {
        *depths.entry(world.to_owned()).or_default() += 1;
    }
}

pub fn decrement_inbound(world: &str) {
    if !is_enabled() {
        return;
    }
    let Some(depths) = INBOUND_DEPTHS.get() else {
        return;
    };
    if let Ok(mut depths) = depths.lock() {
        let depth = depths.entry(world.to_owned()).or_default();
        *depth = depth.saturating_sub(1);
    }
}

pub fn inbound_depth(world: &str) -> usize {
    if !is_enabled() {
        return 0;
    }
    INBOUND_DEPTHS
        .get()
        .and_then(|depths| depths.lock().ok())
        .and_then(|depths| depths.get(world).copied())
        .unwrap_or_default()
}

fn writer() -> io::Result<&'static Mutex<File>> {
    if let Some(writer) = WRITER.get() {
        return Ok(writer);
    }

    let directory = std::env::var("TOWN_PERF_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(".staging/perf"));
    fs::create_dir_all(&directory)?;
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("core.jsonl"))?;
    let _ = WRITER.set(Mutex::new(file));
    WRITER
        .get()
        .ok_or_else(|| io::Error::other("perf writer initialization failed"))
}
