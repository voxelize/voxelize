use actix::{
    fut::wrap_future, Actor, ActorFutureExt, Addr, Context, Handler, Message as ActixMessage,
    MessageResult, ResponseActFuture,
};
use serde_json::Value;

use crate::{perf, GetInfo, GetWorldStats, SyncWorld, WorldStatsResponse};

use super::health::{build_health_value, tick_stall_threshold_ms};
use super::{Server, WsSender};
use crate::Message;

/// New chat session is created. Returns (client_id, connection_token).
#[derive(ActixMessage)]
#[rtype(result = "(String, String)")]
pub struct Connect {
    pub id: Option<String>,
    pub is_transport: bool,
    pub sender: WsSender,
}

/// Session is disconnected
#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct Disconnect {
    pub id: String,
    /// The connection token assigned when this session was created.
    /// Used to distinguish stale disconnects from kicked sessions.
    pub token: String,
}

#[derive(ActixMessage)]
#[rtype(result = "Value")]
pub struct Info;

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct RunPreload;

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct SetStarted(pub bool);

#[derive(ActixMessage)]
#[rtype(result = "Vec<WorldStatsResponse>")]
pub struct GetAllWorldStats;

/// Send message to specific world
#[derive(ActixMessage)]
#[rtype(result = "Option<String>")]
pub struct ClientMessage {
    /// Id of the client session
    pub id: String,

    /// Protobuf message
    pub data: Message,

    /// Connection token of the socket that produced this message. `None` for
    /// secondary channels (WebRTC data channel) riding on a validated
    /// session. When set, messages from superseded sockets are rejected.
    pub session_token: Option<String>,

    pub received_monotonic_ms: Option<f64>,
    pub wire_bytes: usize,
}

impl ClientMessage {
    pub fn new(
        id: String,
        data: Message,
        wire_bytes: usize,
        session_token: Option<String>,
    ) -> Self {
        Self {
            id,
            data,
            session_token,
            received_monotonic_ms: perf::is_enabled().then(perf::monotonic_ms),
            wire_bytes,
        }
    }
}

/// Handler for Connect message.
///
/// Register new session and assign unique id to this session.
/// Returns (client_id, connection_token).
impl Handler<Connect> for Server {
    type Result = MessageResult<Connect>;

    fn handle(&mut self, msg: Connect, ctx: &mut Context<Self>) -> Self::Result {
        let result = self.register_session(msg.id, msg.is_transport, msg.sender);
        self.reconcile_gc(ctx);
        MessageResult(result)
    }
}

/// Handler for Disconnect message.
/// Only cleans up session state if the connection token matches the currently
/// registered token, preventing stale disconnects from kicked sessions from
/// removing the new session's state.
impl Handler<Disconnect> for Server {
    type Result = ();

    fn handle(&mut self, msg: Disconnect, ctx: &mut Context<Self>) {
        self.unregister_session(&msg.id, &msg.token);
        self.reconcile_gc(ctx);
    }
}

/// Handler for server info request.
impl Handler<Info> for Server {
    type Result = MessageResult<Info>;

    fn handle(&mut self, _: Info, _: &mut Context<Self>) -> Self::Result {
        MessageResult(self.get_info())
    }
}

/// Drive world preload after the HTTP server is already bound.
impl Handler<RunPreload> for Server {
    type Result = ResponseActFuture<Self, ()>;

    fn handle(&mut self, _: RunPreload, _: &mut Context<Self>) -> Self::Result {
        let worlds = self.worlds.clone();
        Box::pin(wrap_future(async move {
            Server::preload_worlds(&worlds).await;
        }))
    }
}

/// Mark the server as started (called after boot preload completes).
impl Handler<SetStarted> for Server {
    type Result = ();

    fn handle(&mut self, msg: SetStarted, _: &mut Context<Self>) -> Self::Result {
        self.started = msg.0;
    }
}

/// Deep health probe: tick liveness + preload state (wedged-but-bound detection).
#[derive(ActixMessage)]
#[rtype(result = "Value")]
pub struct Health;

impl Handler<Health> for Server {
    type Result = ResponseActFuture<Self, Value>;

    fn handle(&mut self, _: Health, _: &mut Context<Self>) -> Self::Result {
        let started = self.started;
        let last_tick_age_ms = self.last_tick_at.map(|at| at.elapsed().as_millis() as u64);
        let stall_threshold_ms = tick_stall_threshold_ms();
        let world_addrs: Vec<(String, Addr<SyncWorld>)> = self
            .worlds
            .iter()
            .map(|(name, addr)| (name.clone(), addr.clone()))
            .collect();

        Box::pin(wrap_future(async move {
            let mut worlds = Vec::with_capacity(world_addrs.len());
            for (name, addr) in world_addrs {
                match addr.send(GetInfo).await {
                    Ok(info) => worlds.push((name, info.preloading, info.preload_progress)),
                    Err(_) => worlds.push((name, false, 0.0)),
                }
            }
            build_health_value(started, last_tick_age_ms, &worlds, stall_threshold_ms)
        }))
    }
}

/// Handler for getting all world stats.
impl Handler<GetAllWorldStats> for Server {
    type Result = actix::ResponseActFuture<Self, Vec<WorldStatsResponse>>;

    fn handle(&mut self, _: GetAllWorldStats, _: &mut Context<Self>) -> Self::Result {
        let world_addrs: Vec<_> = self.worlds.iter().map(|(_, addr)| addr.clone()).collect();

        Box::pin(wrap_future(async move {
            let mut stats = Vec::new();
            for addr in world_addrs {
                if let Ok(world_stats) = addr.send(GetWorldStats).await {
                    stats.push(world_stats);
                }
            }
            stats
        }))
    }
}

/// Handler for Message message.
impl Handler<ClientMessage> for Server {
    type Result = Option<String>;

    fn handle(&mut self, msg: ClientMessage, ctx: &mut Context<Self>) -> Self::Result {
        let result = self.on_request(
            &msg.id,
            msg.data,
            msg.received_monotonic_ms,
            msg.wire_bytes,
            msg.session_token.as_deref(),
        );
        self.reconcile_gc(ctx);
        result
    }
}
