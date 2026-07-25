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
use super::{default_info_handle, Server};

const DEFAULT_DEBUG: bool = true;
const DEFAULT_PORT: u16 = 4000;
const DEFAULT_ADDR: &str = "0.0.0.0";
const DEFAULT_SERVE: &str = "";
const DEFAULT_INTERVAL: u64 = 16;

/// Builder for a voxelize server.
pub struct ServerBuilder {
    port: u16,
    debug: bool,
    addr: String,
    serve: String,
    interval: u64,
    secret: Option<String>,
    registry: Option<Registry>,
    pub(super) max_worlds: Option<usize>,
    pub(super) world_pool: Option<PoolConfig>,
}

impl ServerBuilder {
    /// Create a new server builder instance.
    pub fn new() -> Self {
        Self {
            debug: DEFAULT_DEBUG,
            port: DEFAULT_PORT,
            addr: DEFAULT_ADDR.to_owned(),
            serve: DEFAULT_SERVE.to_owned(),
            interval: DEFAULT_INTERVAL,
            secret: None,
            registry: None,
            max_worlds: None,
            world_pool: None,
        }
    }

    /// Configure the port to the voxelize server.
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    /// Configure the address of the voxelize server.
    pub fn addr(mut self, addr: &str) -> Self {
        self.addr = addr.to_owned();
        self
    }

    /// Configure whether or not the voxelize server should be in debug mode.
    pub fn debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Configure the static folder to serve.
    pub fn serve(mut self, serve: &str) -> Self {
        self.serve = serve.to_owned();
        self
    }

    /// Configure the interval for the server to tick at.
    pub fn interval(mut self, interval: u64) -> Self {
        self.interval = interval;
        self
    }

    /// Configure the secret for the server to be able to join.
    pub fn secret(mut self, secret: &str) -> Self {
        self.secret = Some(secret.to_owned());
        self
    }

    /// Configure the block registry of the server. Once a registry is configured, mutating it wouldn't
    /// change the server's block list.
    pub fn registry(mut self, registry: &Registry) -> Self {
        self.registry = Some(registry.to_owned());
        self
    }

    /// Instantiate a voxelize server instance.
    pub fn build(self) -> Server {
        let mut registry = self.registry.unwrap_or(Registry::new());
        registry.generate();

        if self.debug {
            Server::setup_logger();
        }

        Server {
            port: self.port,
            addr: self.addr,
            serve: self.serve,
            debug: self.debug,
            interval: self.interval,
            secret: self.secret,

            registry,

            started: false,

            connections: HashMap::default(),
            lost_sessions: HashMap::default(),
            transport_sessions: HashMap::default(),
            pending_world_ticks: HashSet::default(),
            last_tick_at: None,
            actor_started_at: None,
            debug_pause_ticks: false,
            debug_pause_ticks_after: None,
            worlds: HashMap::default(),
            world_inbound_state: HashMap::default(),
            info_handle: default_info_handle,
            action_handles: HashMap::default(),
            rtc_senders: None,
            max_worlds: self.max_worlds,
            world_pool: self.world_pool,
            world_pool_slots: Vec::new(),
            world_entries: HashMap::default(),
            lifecycle_metrics: WorldLifecycleMetrics::default(),
        }
    }
}
