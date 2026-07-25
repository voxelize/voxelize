use std::time::{Duration, Instant};

use actix::{
    fut::wrap_future, Actor, ActorFutureExt, Addr, AsyncContext, Context, Handler,
    Message as ActixMessage, MessageResult, ResponseActFuture,
};
use fern::colors::{Color, ColoredLevelConfig};
use futures_util::future::join_all;
use hashbrown::{HashMap, HashSet};
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use log::{info, warn};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU16, AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::mpsc;

use crate::{
    errors::AddWorldError,
    perf,
    world::{
        check_protocol, ClientPreferencesPatch, InboundStateBuffer, MotionProtocol, Registry,
        World, WorldConfig, PROTOCOL_MISMATCH_CLOSE_CODE, PROTOCOL_MISMATCH_REASON,
        PROTOCOL_VERSION,
    },
    ChunkStatus, ClientJoinRequest, ClientLeaveRequest, ClientRequest, GetConfig, GetInfo,
    GetWorldStats, Mesher, MessageQueues, Preload, Prepare, RtcSenders, Stats, SyncWorld, Tick,
    TransportJoinRequest, TransportLeaveRequest, WorldStatsResponse,
};

use super::lifecycle::{PoolConfig, PooledSlot, WorldEntry, WorldLifecycleMetrics};

/// Default max age of the last completed world tick before `/health` is unhealthy.
pub const DEFAULT_TICK_STALL_THRESHOLD_MS: u64 = 5_000;

pub(super) fn tick_stall_threshold_ms() -> u64 {
    std::env::var("VOXELIZE_TICK_STALL_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_TICK_STALL_THRESHOLD_MS)
}

pub(super) fn debug_pause_ticks_from_env() -> bool {
    matches!(
        std::env::var("VOXELIZE_DEBUG_PAUSE_TICKS").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    )
}

pub(super) fn debug_pause_ticks_after_from_env() -> Option<Duration> {
    std::env::var("VOXELIZE_DEBUG_PAUSE_TICKS_AFTER_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_millis)
}

/// Build a `/health` JSON payload from live server + world preload state.
pub fn build_health_value(
    started: bool,
    last_tick_age_ms: Option<u64>,
    worlds: &[(String, bool, f32)],
    stall_threshold_ms: u64,
) -> Value {
    let preloading = worlds.iter().any(|(_, preloading, _)| *preloading);
    let preload_progress = if worlds.is_empty() {
        0.0
    } else {
        worlds
            .iter()
            .map(|(_, _, progress)| *progress)
            .sum::<f32>()
            / worlds.len() as f32
    };
    let tick_ok = match last_tick_age_ms {
        Some(age) => age <= stall_threshold_ms,
        None => false,
    };
    let ready = started && !preloading && tick_ok;
    let ok = ready;
    json!({
        "ok": ok,
        "ready": ready,
        "started": started,
        "preloading": preloading,
        "preloadProgress": preload_progress,
        "lastTickAgeMs": last_tick_age_ms,
        "tickStallThresholdMs": stall_threshold_ms,
        "worlds": worlds.iter().map(|(name, preloading, progress)| json!({
            "name": name,
            "preloading": preloading,
            "preloadProgress": progress,
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod health_tests {
    use super::*;

    #[test]
    fn health_reports_stall_when_tick_age_exceeds_threshold() {
        let value = build_health_value(
            true,
            Some(12_000),
            &[("spireash".into(), false, 1.0)],
            5_000,
        );
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["ready"], json!(false));
        assert_eq!(value["preloading"], json!(false));
        assert_eq!(value["lastTickAgeMs"], json!(12_000));
    }

    #[test]
    fn health_ok_when_recent_tick_and_not_preloading() {
        let value = build_health_value(
            true,
            Some(40),
            &[("spireash".into(), false, 1.0)],
            5_000,
        );
        assert_eq!(value["ok"], json!(true));
        assert_eq!(value["ready"], json!(true));
    }

    #[test]
    fn health_not_ready_while_preloading() {
        let value = build_health_value(
            true,
            Some(10),
            &[("spireash".into(), true, 0.4)],
            5_000,
        );
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["ready"], json!(false));
        assert_eq!(value["preloading"], json!(true));
    }

    #[test]
    fn health_not_ready_before_started_even_with_ticks() {
        // Bind-before-preload leaves started=false until RunPreload finishes.
        let value = build_health_value(
            false,
            Some(5),
            &[("spireash".into(), true, 0.1)],
            5_000,
        );
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["started"], json!(false));
        assert_eq!(value["preloading"], json!(true));
        assert!((value["preloadProgress"].as_f64().unwrap() - 0.1).abs() < 1e-6);
    }
}
