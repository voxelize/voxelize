use hashbrown::{HashMap, HashSet};

use crate::world::Registry;

use super::lifecycle::{PoolConfig, WorldLifecycleMetrics};
use super::{
    default_info_handle, executable_modified_unix_seconds, unix_seconds_now, BuildIdentity, Server,
    SessionAuthenticator,
};

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
    transport_secret: Option<String>,
    session_authenticator: Option<SessionAuthenticator>,
    registry: Option<Registry>,
    build_identity: BuildIdentity,
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
            transport_secret: None,
            session_authenticator: None,
            registry: None,
            build_identity: BuildIdentity::default(),
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

    /// Require a separate secret from transport servers (`?is_transport`).
    /// The join secret ships in every client bundle, so on its own it cannot
    /// tell a game server apart from a browser; a transport connection can
    /// drive methods in every world and must prove it is the real one.
    /// Without this, transports are checked against the join secret only.
    pub fn transport_secret(mut self, secret: &str) -> Self {
        self.transport_secret = Some(secret.to_owned());
        self
    }

    /// Install the hook that decides who each connecting socket is. Without
    /// one, the server honours the `client_id` a client asks for (see
    /// [`super::permissive_session_auth`]), which lets any client claim any
    /// identity — acceptable for local development only.
    pub fn session_authenticator(mut self, authenticator: SessionAuthenticator) -> Self {
        self.session_authenticator = Some(authenticator);
        self
    }

    /// Configure the block registry of the server. Once a registry is configured, mutating it wouldn't
    /// change the server's block list.
    pub fn registry(mut self, registry: &Registry) -> Self {
        self.registry = Some(registry.to_owned());
        self
    }

    /// Stamp the compile-time identity this server reports on `/info`.
    /// Without it every identity field reads "unknown".
    pub fn build_identity(mut self, build_identity: BuildIdentity) -> Self {
        self.build_identity = build_identity;
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
            transport_secret: self.transport_secret,
            session_authenticator: self.session_authenticator,
            identities: HashMap::default(),

            registry,

            started: false,

            connections: HashMap::default(),
            lost_sessions: HashMap::default(),
            transport_sessions: HashMap::default(),
            method_guard: None,
            pending_world_ticks: HashSet::default(),
            last_tick_at: None,
            actor_started_at: None,
            debug_pause_ticks: false,
            debug_pause_ticks_after: None,
            worlds: HashMap::default(),
            world_inbound_state: HashMap::default(),
            info_handle: default_info_handle,
            build_identity: self.build_identity,
            process_started_at_secs: unix_seconds_now(),
            executable_built_at_secs: executable_modified_unix_seconds(),
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
