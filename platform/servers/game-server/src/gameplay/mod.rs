//! Server-authoritative gameplay: mining, building, inventory, crafting.
//!
//! Clients send intents as engine methods (`platform.<area>.<verb>`, see
//! docs/NETWORK_PROTOCOL.md §3). Each handler validates with [`rules`],
//! applies the authoritative change, persists the player, and answers the
//! sender with a `platform.result` event plus a fresh `platform.inventory`
//! snapshot when the inventory changed.

pub mod anticheat;
pub mod automation;
pub mod chat;
pub mod combat;
pub mod containers;
pub mod cosmetics;
pub mod drops;
pub mod mobs;
mod mobs_api;
pub mod modes;
pub mod plugins;
pub mod progress;
pub mod sanctions;
pub mod shutdown;
pub mod voice;
pub mod work;
pub use mobs_api::MobSystem;
mod guild_api;
pub mod inventory;
mod items_api;
mod plates;
pub use plates::PlateSystem;
pub mod blueprint;
pub mod bridge;
pub mod guilds;
pub mod land;
pub mod market;
pub mod stall;
pub use anticheat::AntiCheatSystem;
pub use market::MarketSystem;
pub use plugins::PluginSystem;
pub use sanctions::SanctionSystem;
pub use shutdown::MetricsSystem;
pub use shutdown::SaveSystem;
pub use voice::VoiceSystem;
pub mod trade;
pub mod travel;
pub use automation::GaugeSystem;
pub use combat::CombatSystem;
pub use guild_api::SiegeSystem;
pub use land::LandNoticeSystem;
pub use progress::ProgressSystem;
pub use trade::TradeSystem;
pub use travel::{Dimensions, PortalSystem};
pub use weather::WeatherSystem;
pub use work::PayoutSystem;
pub mod rules;
pub mod store;
pub mod survival;
pub mod weather;
pub mod window;
pub mod xp;
pub use items_api::WorldItemsSystem;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use log::{error, warn};
use platform_content::{Content, CraftingGrid, Dimension};
use platform_ticket::Realm;
use serde::Deserialize;
use serde_json::{json, Value};
use specs::{Entity, WorldExt};
use voxelize::{
    ChunkUtils, Chunks, ClientFilter, Event, IDComp, PositionComp, SessionIdentities, Vec3,
    VoxelAccess, World,
};

use self::inventory::Inventory;
use self::rules::{IntentError, PlayerState, Rules, WorldView};
use self::store::PlayerStore;
use self::survival::{Surroundings, Vitals, EYE_HEIGHT};

pub const RESULT_EVENT: &str = "platform.result";
pub const INVENTORY_EVENT: &str = "platform.inventory";
pub const VITALS_EVENT: &str = "platform.vitals";
pub const RESPAWN_EVENT: &str = "platform.respawn";

/// World resource holding the rules and every online player's state.
pub struct Gameplay {
    rules: Rules,
    store: PlayerStore,
    players: HashMap<String, PlayerState>,
    rng: u64,
    containers: containers::Containers,
    drops: drops::Drops,
    world_dir: std::path::PathBuf,
    /// Blocks broken by block behaviours, whose drops are still to spawn.
    broken: Arc<crate::behaviors::BrokenBlocks>,
    mobs: mobs::Mobs,
    mob_rng: mobs::Rng,
    /// Biome key at a column, from the world generator (spawn rules).
    biome: Arc<dyn Fn(i32, i32) -> String + Send + Sync>,
    /// This world's dimension and the worlds of the others.
    dimensions: Dimensions,
    /// Open trade windows and their outcomes (`trades.json`).
    trades: trade::Trades,
    /// Siege banners standing on enemy guild land (`sieges.json`).
    sieges: guild_api::Sieges,
    chat: chat::ChatState,
    /// What each player here wears.
    looks: HashMap<String, cosmetics::Look>,
    /// Who has voice on and whom they are paired with.
    voice: voice::Voice,
    /// Lit blast charges and arrows in flight.
    combat: combat::Combat,
    /// The overworld's weather (`weather.json`).
    weather: weather::Weather,
    /// Set when the weather was changed by hand, to tell players at once.
    weather_changed: bool,
}

impl Gameplay {
    pub fn new(
        content: Arc<Content>,
        world_dir: &Path,
        players_dir: &Path,
        seed: u32,
        broken: Arc<crate::behaviors::BrokenBlocks>,
        biome: Arc<dyn Fn(i32, i32) -> String + Send + Sync>,
        dimensions: Dimensions,
    ) -> Result<Self, String> {
        let mobs = mobs_api::load(world_dir)?;
        Ok(Self {
            rules: Rules::new(content),
            store: PlayerStore::for_dimension(players_dir, dimensions.current),
            dimensions,
            trades: trade::Trades::load(world_dir)?,
            sieges: guild_api::Sieges::load(world_dir)?,
            chat: Default::default(),
            looks: HashMap::new(),
            voice: Default::default(),
            combat: combat::Combat::default(),
            weather: weather::Weather::load(world_dir)?,
            weather_changed: true,
            players: HashMap::new(),
            rng: seed as u64 ^ 0x5EED_CAFE_F00D,
            containers: containers::Containers::load(world_dir)?,
            drops: drops::Drops::load(world_dir)?,
            world_dir: world_dir.to_owned(),
            broken,
            mobs,
            mob_rng: mobs::Rng(seed as u64 ^ 0x0B5E_55ED),
            biome,
        })
    }

    fn random(&mut self) -> f64 {
        self.rng = self.rng.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.rng;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The engine's chunks seen through [`WorldView`].
struct EngineView<'a> {
    chunks: &'a Chunks,
    chunk_size: usize,
    max_height: i32,
    /// Reported positions of every player in the world.
    players: Vec<[f32; 3]>,
}

impl WorldView for EngineView<'_> {
    fn block_at(&self, [x, y, z]: [i32; 3]) -> Option<u32> {
        if y < 0 || y >= self.max_height {
            return None;
        }
        let coords = ChunkUtils::map_voxel_to_chunk(x, y, z, self.chunk_size);
        if !self.chunks.is_chunk_ready(&coords) {
            return None;
        }
        Some(self.chunks.get_voxel(x, y, z))
    }

    fn raw_at(&self, [x, y, z]: [i32; 3]) -> Option<u32> {
        self.block_at([x, y, z])?;
        Some(self.chunks.get_raw_voxel(x, y, z))
    }

    fn players_overlap(&self, [x, y, z]: [i32; 3]) -> bool {
        // Reported positions may be eye or feet height; take a body that
        // covers both (0.8 wide, from 1.8 below to 0.2 above the position).
        self.players.iter().any(|p| {
            let (min, max) = (
                [p[0] - 0.4, p[1] - 1.8, p[2] - 0.4],
                [p[0] + 0.4, p[1] + 0.2, p[2] + 0.4],
            );
            let cell = [x as f32, y as f32, z as f32];
            (0..3).all(|i| min[i] < cell[i] + 1.0 && max[i] > cell[i])
        })
    }

    fn block_nearby(&self, [x, y, z]: [i32; 3], block: u32, radius: i32) -> bool {
        for dx in -radius..=radius {
            for dy in -radius..=radius {
                for dz in -radius..=radius {
                    if self.block_at([x + dx, y + dy, z + dz]) == Some(block) {
                        return true;
                    }
                }
            }
        }
        false
    }
}

fn send(world: &mut World, client_id: &str, name: &str, payload: Value) {
    world.events_mut().dispatch(
        Event::new(name)
            .payload(payload)
            .filter(ClientFilter::Direct(client_id.to_owned()))
            .build(),
    );
}

fn reply(world: &mut World, client_id: &str, intent: &str, result: Result<Value, IntentError>) {
    let payload = match result {
        Ok(mut detail) => {
            detail["intent"] = json!(intent);
            detail["ok"] = json!(true);
            detail
        }
        Err(error) => json!({ "intent": intent, "ok": false, "code": error.code() }),
    };
    let result = payload["code"].as_str().unwrap_or("ok");
    crate::metrics::inc(
        "platform_intents_total",
        &[("intent", intent), ("result", result)],
    );
    send(world, client_id, RESULT_EVENT, payload);
}

fn send_inventory(world: &mut World, client_id: &str) {
    let snapshot = {
        let gameplay = world.ecs().read_resource::<Gameplay>();
        gameplay
            .players
            .get(client_id)
            .map(|p| json!({ "slots": p.inventory.slots, "selected": p.inventory.selected, "realm": p.realm, "armor": rules::armor_points(gameplay.rules.content(), p) }))
    };
    if let Some(snapshot) = snapshot {
        send(world, client_id, INVENTORY_EVENT, snapshot);
    }
}

fn vitals_payload(player: &PlayerState, cause: Option<survival::DamageKind>) -> Value {
    let v = &player.vitals;
    json!({
        "health": v.health,
        "food": v.food,
        "air": v.air,
        "maxAir": survival::MAX_AIR,
        "dead": v.is_dead(),
        "cause": cause,
        "realm": player.realm,
        "mode": player.mode,
        "burning": v.burning > 0.0,
        "effects": v.effects,
        "xp": player.xp,
        "level": xp::level_of(player.xp).0,
        "progress": xp::level_of(player.xp).1,
    })
}

fn send_vitals(world: &mut World, client_id: &str, cause: Option<survival::DamageKind>) {
    let payload = {
        let gameplay = world.ecs().read_resource::<Gameplay>();
        gameplay
            .players
            .get(client_id)
            .map(|p| vitals_payload(p, cause))
    };
    if let Some(payload) = payload {
        send(world, client_id, VITALS_EVENT, payload);
    }
}

fn client_position(world: &World, client_id: &str) -> Option<[f32; 3]> {
    let entity = world.clients().get(client_id).map(|c| c.entity)?;
    let positions = world.read_component::<PositionComp>();
    positions.get(entity).map(|p| [p.0 .0, p.0 .1, p.0 .2])
}

fn realm_of(world: &World, client_id: &str) -> Realm {
    let identities = world.read_resource::<SessionIdentities>();
    identities
        .get(client_id)
        .and_then(|identity| identity.claims.get("realm").cloned())
        .and_then(|realm| serde_json::from_value(realm).ok())
        .unwrap_or(Realm::Survival)
}

/// Whether the land at `voxel` lets this player do `action`.
fn land_allows(world: &World, client_id: &str, voxel: [i32; 3], action: land::Action) -> bool {
    let g = world.ecs().read_resource::<Gameplay>();
    let dimension = g.dimensions.current;
    let allowed = g
        .dimensions
        .land
        .read()
        .map(|index| index.allows(dimension, client_id, voxel, action))
        // A poisoned lock means a writer panicked mid-update: refuse.
        .unwrap_or(false);
    allowed
}

/// Run `f` with the player's state, the rules and a view of the world.
/// Returns `None` when the client has no gameplay state (not joined).
fn with_player<R>(
    world: &mut World,
    client_id: &str,
    f: impl FnOnce(&mut Gameplay, &EngineView, [f32; 3]) -> R,
) -> Option<R> {
    let position = client_position(world, client_id)?;
    let players: Vec<[f32; 3]> = {
        let positions = world.read_component::<PositionComp>();
        world
            .clients()
            .values()
            .filter_map(|c| positions.get(c.entity).map(|p| [p.0 .0, p.0 .1, p.0 .2]))
            .collect()
    };
    let chunk_size = world.config().chunk_size;
    let max_height = world.config().max_height as i32;
    let ecs = world.ecs();
    let chunks = ecs.read_resource::<Chunks>();
    let view = EngineView {
        chunks: &chunks,
        chunk_size,
        max_height,
        players,
    };
    let mut gameplay = ecs.write_resource::<Gameplay>();
    if gameplay
        .players
        .get(client_id)
        .is_none_or(|p| p.travel.departed)
    {
        return None;
    }
    Some(f(&mut gameplay, &view, position))
}

fn persist(world: &mut World, client_id: &str) {
    let position = client_position(world, client_id);
    persist_at(world, client_id, position);
}

fn persist_at(world: &mut World, client_id: &str, position: Option<[f32; 3]>) {
    let gameplay = world.ecs().read_resource::<Gameplay>();
    let Some(player) = gameplay.players.get(client_id) else {
        return;
    };
    if player.travel.departed {
        return; // saved for the destination when it left; never overwrite
    }
    let record = gameplay.store.record(client_id, player, position);
    if let Err(e) = gameplay.store.save(&record) {
        error!("could not save player {client_id}: {e}");
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VoxelPayload {
    voxel: [i32; 3],
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlacePayload {
    voxel: [i32; 3],
    #[serde(default)]
    slot: Option<usize>,
    /// Creative only: any block by key.
    #[serde(default)]
    block: Option<String>,
    /// Facing for oriented blocks: axis (0..=5) and rotation about y (0..16).
    #[serde(default)]
    rotation: u32,
    #[serde(default, rename = "yRotation")]
    y_rotation: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreativePayload {
    slot: usize,
    item: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SelectPayload {
    slot: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SlotPayload {
    #[serde(default)]
    slot: Option<usize>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MovePayload {
    from: usize,
    to: usize,
    #[serde(default)]
    count: Option<u32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CraftPayload {
    /// Square grid (2x2 or 3x3) of item keys, `null` for empty slots.
    grid: Vec<Vec<Option<String>>>,
}

fn parse<T: for<'de> Deserialize<'de>>(
    world: &mut World,
    client_id: &str,
    intent: &str,
    payload: &str,
) -> Option<T> {
    match serde_json::from_str(payload) {
        Ok(value) => Some(value),
        Err(_) => {
            send(
                world,
                client_id,
                RESULT_EVENT,
                json!({ "intent": intent, "ok": false, "code": "bad_payload" }),
            );
            None
        }
    }
}

fn not_joined(world: &mut World, client_id: &str, intent: &str) {
    send(
        world,
        client_id,
        RESULT_EVENT,
        json!({ "intent": intent, "ok": false, "code": "not_joined" }),
    );
}

fn on_join(world: &mut World, entity: Entity) {
    let Some(id) = world
        .read_component::<IDComp>()
        .get(entity)
        .map(|c| c.0.clone())
    else {
        return;
    };
    // Suspended or banned since the ticket was issued: no play.
    let locked = {
        let g = world.ecs().read_resource::<Gameplay>();
        let s = g.dimensions.sanctions.clone();
        drop(g);
        let s = s.read().ok().and_then(|s| s.locked(&id).cloned());
        s
    };
    if let Some(s) = locked {
        send(
            world,
            &id,
            sanctions::KICKED_EVENT,
            json!({ "status": s.status, "reason": s.reason }),
        );
        return;
    }
    let realm = realm_of(world, &id);
    let loaded = {
        let gameplay = world.ecs().read_resource::<Gameplay>();
        gameplay.store.load(&id)
    };
    let record = match loaded {
        Ok(record) => record,
        Err(e) => {
            // Never hand out an empty inventory over a record we failed to
            // read: that would silently wipe the player on the next save.
            error!("refusing gameplay for {id}: cannot load player record: {e}");
            return;
        }
    };
    // The record decides the dimension: a player who joins another one is
    // sent where they are.
    let dimensions = world.ecs().read_resource::<Gameplay>().dimensions.clone();
    let dimension = record.as_ref().map(|r| r.dimension).unwrap_or_default();
    if dimension != dimensions.current {
        if let Some(target) = dimensions.world_of(dimension) {
            send(world, &id, travel::TRAVEL_EVENT, json!({ "world": target }));
            return;
        }
        warn!("player {id} is in {dimension:?}, which this server does not host");
    }
    let (
        mut inventory,
        mut vitals,
        armor,
        offhand,
        position,
        arrival,
        outbox,
        delivered,
        trade_hold,
        home,
        xp,
        mode,
        progress,
        work,
    ) = match record {
        Some(r) => (
            r.inventory,
            r.vitals,
            r.armor,
            r.offhand,
            r.position,
            r.arrival,
            r.outbox,
            r.delivered,
            r.trade_hold,
            r.home,
            r.xp,
            r.mode,
            r.progress,
            r.work,
        ),
        None => (
            Inventory::default(),
            Vitals::default(),
            Vec::new(),
            None,
            None,
            None,
            Vec::new(),
            Vec::new(),
            None,
            None,
            0,
            rules::GameMode::Normal,
            Default::default(),
            Default::default(),
        ),
    };
    {
        let mut gameplay = world.ecs().write_resource::<Gameplay>();
        let dropped = inventory.normalize(gameplay.rules.content());
        if dropped > 0 {
            warn!("player {id}: dropped {dropped} stack(s) of items that no longer exist");
        }
        vitals.normalize();
        // The client teleports to the surface right after joining.
        vitals.start_grace(5.0);
        let mut state = PlayerState::new(inventory, realm, vitals);
        if armor.len() == 4 {
            state.armor = armor;
        }
        state.offhand = offhand;
        state.travel.arrival = arrival.clone();
        state.market = market::MarketState::restore(outbox, delivered);
        state.trade_hold = trade_hold;
        state.home = home;
        state.xp = xp;
        state.mode = mode;
        state.progress = progress;
        state.work = work;
        // Arriving in a dimension counts (achievements for each one).
        let here = gameplay.dimensions.current;
        state.note(platform_content::TriggerKind::Enter, here.key(), 1);
        // Joining inside a portal never sends the player straight on.
        state.travel.blocked = true;
        state.travel.settle = travel::SETTLE_SECONDS;
        gameplay.players.insert(id.clone(), state);
    }
    send_inventory(world, &id);
    send_vitals(world, &id, None);
    modes::on_join(world, &id);
    cosmetics::on_join(world, &id);
    plugin_presence(world, &id, true);
    {
        let done = world
            .ecs()
            .read_resource::<Gameplay>()
            .players
            .get(&id)
            .map(|p| p.progress.done.clone())
            .unwrap_or_default();
        send(
            world,
            &id,
            progress::PROGRESS_EVENT,
            json!({ "unlocked": [], "done": done }),
        );
        let work = {
            let g = world.ecs().read_resource::<Gameplay>();
            g.players
                .get(&id)
                .map(|p| work::payload(g.rules.content(), &p.work, work::today()))
        };
        if let Some(work) = work {
            send(world, &id, work::WORK_EVENT, work);
        }
    }
    // Back where they left (arrivals are placed once their area is ready).
    if let (None, Some(eye)) = (&arrival, position) {
        let feet = [
            eye[0].floor() as i32,
            (eye[1] - EYE_HEIGHT + 0.1).floor() as i32,
            eye[2].floor() as i32,
        ];
        send(world, &id, travel::TELEPORT_EVENT, json!({ "feet": feet }));
    }
}

/// Tell plugins a player came into (or left) this dimension.
fn plugin_presence(world: &mut World, id: &str, joined: bool) {
    // The ticket's name (the client list may not hold the player yet).
    let name = world
        .read_resource::<SessionIdentities>()
        .get(id)
        .and_then(|identity| identity.username.clone())
        .or_else(|| world.clients().get(id).map(|c| c.username.clone()))
        .unwrap_or_else(|| id.to_owned());
    let g = world.ecs().read_resource::<Gameplay>();
    if !joined && !g.players.contains_key(id) {
        return;
    }
    let player = plugins::player(id, &name, g.dimensions.current.key());
    if let Ok(mut p) = g.dimensions.plugins.lock() {
        if joined {
            p.joined(player);
        } else {
            p.left(player);
        }
    };
}

fn on_leave(world: &mut World, entity: Entity) {
    let Some(id) = world
        .read_component::<IDComp>()
        .get(entity)
        .map(|c| c.0.clone())
    else {
        return;
    };
    items_api::close_window(world, &id);
    plugin_presence(world, &id, false);
    // The client may already be gone from the client list; its body is not.
    let position = world
        .read_component::<PositionComp>()
        .get(entity)
        .map(|p| [p.0 .0, p.0 .1, p.0 .2]);
    persist_at(world, &id, position);
    let mut g = world.ecs().write_resource::<Gameplay>();
    g.players.remove(&id);
    g.looks.remove(&id);
    g.voice.leave(&id);
}

#[allow(clippy::too_many_arguments)]
pub fn install(
    world: &mut World,
    content: Arc<Content>,
    world_dir: &Path,
    players_dir: &Path,
    seed: u32,
    broken: Arc<crate::behaviors::BrokenBlocks>,
    biome: Arc<dyn Fn(i32, i32) -> String + Send + Sync>,
    dimensions: Dimensions,
) -> Result<(), String> {
    world.ecs_mut().insert(Gameplay::new(
        content,
        world_dir,
        players_dir,
        seed,
        broken,
        biome,
        dimensions,
    )?);
    items_api::install(world);
    mobs_api::install(world);
    market::install(world);
    stall::install(world);
    guild_api::install(world);
    combat::install(world);
    modes::install(world);
    work::install(world);
    chat::install(world);
    cosmetics::install(world);
    voice::install(world);
    weather::install(world);
    blueprint::install(world);
    trade::install(world);
    world.set_client_modifier(on_join);
    world.set_client_leave_modifier(on_leave);

    world.set_method_handle("platform.inventory.get", |world, client_id, _| {
        send_inventory(world, client_id);
    });

    world.set_method_handle("platform.mine.start", |world, client_id, payload| {
        const INTENT: &str = "mine.start";
        let Some(p) = parse::<VoxelPayload>(world, client_id, INTENT, payload) else {
            return;
        };
        if !land_allows(world, client_id, p.voxel, land::Action::Build) {
            reply(world, client_id, INTENT, Err(IntentError::LandProtected));
            return;
        }
        let stall = {
            let g = world.ecs().read_resource::<Gameplay>();
            stall::guard_break(&g, client_id, p.voxel)
        };
        if let Err(e) = stall {
            reply(world, client_id, INTENT, Err(e));
            return;
        }
        let now = now_ms();
        let result = with_player(world, client_id, |g, view, position| {
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            rules.start_mining(player, view, position, p.voxel, now)
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(r) => reply(
                world,
                client_id,
                INTENT,
                r.map(|_| json!({ "voxel": p.voxel })),
            ),
        }
    });

    world.set_method_handle("platform.mine.finish", |world, client_id, payload| {
        const INTENT: &str = "mine.finish";
        let Some(p) = parse::<VoxelPayload>(world, client_id, INTENT, payload) else { return };
        if !land_allows(world, client_id, p.voxel, land::Action::Build) {
            reply(world, client_id, INTENT, Err(IntentError::LandProtected));
            return;
        }
        let stall = {
            let g = world.ecs().read_resource::<Gameplay>();
            stall::guard_break(&g, client_id, p.voxel)
        };
        if let Err(e) = stall {
            reply(world, client_id, INTENT, Err(e));
            return;
        }
        let now = now_ms();
        let result = with_player(world, client_id, |g, view, position| {
            let mut rolls: Vec<f64> = (0..16).map(|_| g.random()).collect();
            let mut next = move || rolls.pop().unwrap_or(0.5);
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            rules.finish_mining(player, view, position, p.voxel, now, &mut next)
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(Ok(outcome)) => {
                let [x, y, z] = p.voxel;
                world.chunks_mut().update_voxel(&Vec3(x, y, z), rules::AIR);
                items_api::block_removed(world, p.voxel, &outcome.drops);
                persist(world, client_id);
                reply(
                    world,
                    client_id,
                    INTENT,
                    Ok(json!({ "voxel": p.voxel, "drops": outcome.drops, "toolBroke": outcome.tool_broke, "xp": outcome.xp })),
                );
                send_inventory(world, client_id);
                if outcome.xp > 0 {
                    send_vitals(world, client_id, None);
                }
            }
            Some(Err(e)) => reply(world, client_id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.build.place", |world, client_id, payload| {
        const INTENT: &str = "build.place";
        let Some(p) = parse::<PlacePayload>(world, client_id, INTENT, payload) else {
            return;
        };
        let key = {
            let g = world.ecs().read_resource::<Gameplay>();
            match &p.block {
                Some(key) => Some(key.clone()),
                None => g.players.get(client_id).and_then(|player| {
                    let slot = p.slot.unwrap_or(player.inventory.selected);
                    let stack = player.inventory.get(slot)?;
                    g.rules
                        .content()
                        .item_by_id(stack.item)?
                        .places_block
                        .clone()
                }),
            }
        };
        // A siege banner goes onto enemy land, where nothing else may be built.
        let siege = if key.as_deref() == Some("siege_banner") {
            let checked = {
                let g = world.ecs().read_resource::<Gameplay>();
                let survival = g
                    .players
                    .get(client_id)
                    .is_some_and(|pl| pl.realm == Realm::Survival);
                let result = match (g.dimensions.land.read(), g.dimensions.guilds.read()) {
                    _ if !survival => Err(IntentError::SurvivalOnly),
                    (Ok(land), Ok(guilds)) => guild_api::may_siege(
                        &land,
                        &guilds,
                        &g.sieges.list,
                        g.dimensions.current,
                        client_id,
                        p.voxel,
                    ),
                    _ => Err(IntentError::NotAtWar),
                };
                result
            };
            match checked {
                Ok(siege) => Some(siege),
                Err(e) => return reply(world, client_id, INTENT, Err(e)),
            }
        } else {
            None
        };
        if siege.is_none() && !land_allows(world, client_id, p.voxel, land::Action::Build) {
            reply(world, client_id, INTENT, Err(IntentError::LandProtected));
            return;
        }
        // Town halls and vaults only go into settlements.
        let guild_block = {
            let g = world.ecs().read_resource::<Gameplay>();
            key.map_or(Ok(()), |key| {
                guild_api::may_place(&g, client_id, p.voxel, &key)
            })
        };
        if let Err(e) = guild_block {
            reply(world, client_id, INTENT, Err(e));
            return;
        }
        let result = with_player(world, client_id, |g, view, position| {
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            rules.place(player, view, position, p.voxel, p.slot, p.block.as_deref())
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(Ok(block)) => {
                let [x, y, z] = p.voxel;
                let (decays, orientation) = {
                    let g = world.ecs().read_resource::<Gameplay>();
                    let def = g.rules.content().block_by_id(block);
                    (
                        def.is_some_and(|b| {
                            b.behaviors
                                .contains(&platform_content::BlockBehavior::Decays)
                        }),
                        def.map(|b| b.orientation).unwrap_or_default(),
                    )
                };
                let raw = crate::behaviors::oriented(block, orientation, p.rotation, p.y_rotation);
                // Leaves a player places never decay.
                let raw = if decays {
                    voxelize::BlockUtils::insert_stage(raw, crate::behaviors::PERSISTENT_STAGE)
                } else {
                    raw
                };
                world.chunks_mut().update_voxel(&Vec3(x, y, z), raw);
                items_api::block_placed(world, p.voxel, block, client_id);
                if let Some(siege) = siege {
                    let mut g = world.ecs().write_resource::<Gameplay>();
                    log::info!("{client_id} besieges land {} at {:?}", siege.land, siege.at);
                    g.sieges.list.push(siege);
                    g.sieges.save();
                }
                persist(world, client_id);
                reply(
                    world,
                    client_id,
                    INTENT,
                    Ok(json!({ "voxel": p.voxel, "block": block })),
                );
                send_inventory(world, client_id);
            }
            Some(Err(e)) => reply(world, client_id, INTENT, Err(e)),
        }
    });

    world.set_method_handle(
        "platform.inventory.creative",
        |world, client_id, payload| {
            const INTENT: &str = "inventory.creative";
            let Some(p) = parse::<CreativePayload>(world, client_id, INTENT, payload) else {
                return;
            };
            let result = with_player(world, client_id, |g, _, _| {
                let Gameplay { rules, players, .. } = g;
                let player = players.get_mut(client_id).expect("checked by with_player");
                rules.creative_take(player, p.slot, &p.item)
            });
            match result {
                None => not_joined(world, client_id, INTENT),
                Some(r) => {
                    let ok = r.is_ok();
                    reply(
                        world,
                        client_id,
                        INTENT,
                        r.map(|item| json!({ "slot": p.slot, "item": item })),
                    );
                    if ok {
                        persist(world, client_id);
                        send_inventory(world, client_id);
                        // The inventory screen shows the new stack too.
                        items_api::send_window(world, client_id);
                    }
                }
            }
        },
    );

    world.set_method_handle("platform.inventory.select", |world, client_id, payload| {
        const INTENT: &str = "inventory.select";
        let Some(p) = parse::<SelectPayload>(world, client_id, INTENT, payload) else {
            return;
        };
        let result = with_player(world, client_id, |g, _, _| {
            let player = g
                .players
                .get_mut(client_id)
                .expect("checked by with_player");
            player.inventory.select(p.slot).map_err(IntentError::from)
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(r) => {
                let ok = r.is_ok();
                reply(
                    world,
                    client_id,
                    INTENT,
                    r.map(|_| json!({ "slot": p.slot })),
                );
                if ok {
                    persist(world, client_id);
                    send_inventory(world, client_id);
                }
            }
        }
    });

    world.set_method_handle("platform.inventory.move", |world, client_id, payload| {
        const INTENT: &str = "inventory.move";
        let Some(p) = parse::<MovePayload>(world, client_id, INTENT, payload) else {
            return;
        };
        let result = with_player(world, client_id, |g, _, _| {
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            player
                .inventory
                .move_items(rules.content(), p.from, p.to, p.count)
                .map_err(IntentError::from)
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(r) => {
                let ok = r.is_ok();
                reply(world, client_id, INTENT, r.map(|_| json!({})));
                if ok {
                    persist(world, client_id);
                    send_inventory(world, client_id);
                }
            }
        }
    });

    world.set_method_handle("platform.craft", |world, client_id, payload| {
        const INTENT: &str = "craft";
        let Some(p) = parse::<CraftPayload>(world, client_id, INTENT, payload) else {
            return;
        };
        let size = p.grid.len();
        if !(1..=3).contains(&size) || p.grid.iter().any(|row| row.len() != size) {
            reply(world, client_id, INTENT, Err(IntentError::NoRecipe));
            return;
        }
        let mut grid = CraftingGrid::new(size);
        for (y, row) in p.grid.iter().enumerate() {
            for (x, slot) in row.iter().enumerate() {
                grid.set(x, y, slot.clone());
            }
        }
        let result = with_player(world, client_id, |g, view, position| {
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            rules.craft(player, view, position, &grid)
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(Ok((item, count))) => {
                persist(world, client_id);
                reply(
                    world,
                    client_id,
                    INTENT,
                    Ok(json!({ "item": item, "count": count })),
                );
                send_inventory(world, client_id);
            }
            Some(Err(e)) => reply(world, client_id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.eat", |world, client_id, payload| {
        const INTENT: &str = "eat";
        let Some(p) = parse::<SlotPayload>(world, client_id, INTENT, payload) else {
            return;
        };
        let result = with_player(world, client_id, |g, _, _| {
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            rules.eat(player, p.slot)
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(Ok(food)) => {
                persist(world, client_id);
                reply(world, client_id, INTENT, Ok(json!({ "food": food })));
                send_inventory(world, client_id);
                send_vitals(world, client_id, None);
            }
            Some(Err(e)) => reply(world, client_id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.bottle.fill", |world, client_id, _| {
        const INTENT: &str = "bottle.fill";
        let result = with_player(world, client_id, |g, view, position| {
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            rules.fill_bottle(player, view, position)
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(Ok(())) => {
                persist(world, client_id);
                reply(world, client_id, INTENT, Ok(json!({})));
                send_inventory(world, client_id);
            }
            Some(Err(e)) => reply(world, client_id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.respawn", |world, client_id, _| {
        const INTENT: &str = "respawn";
        let respawned = with_player(world, client_id, |g, _, _| {
            let player = g
                .players
                .get_mut(client_id)
                .expect("checked by with_player");
            if !player.vitals.is_dead() {
                return false;
            }
            player.vitals.respawn();
            player.mining = None;
            true
        });
        match respawned {
            None => not_joined(world, client_id, INTENT),
            Some(false) => reply(world, client_id, INTENT, Err(IntentError::NothingThere)),
            Some(true) => {
                // Respawning always happens in the overworld.
                let home = {
                    let g = world.ecs().read_resource::<Gameplay>();
                    (g.dimensions.current != Dimension::Overworld)
                        .then(|| {
                            g.dimensions
                                .world_of(Dimension::Overworld)
                                .map(str::to_owned)
                        })
                        .flatten()
                };
                if let Some(home) = home {
                    let saved = {
                        let mut g = world.ecs().write_resource::<Gameplay>();
                        let Gameplay { players, store, .. } = &mut *g;
                        players.get_mut(client_id).is_some_and(|player| {
                            let mut record = store.record(client_id, player, None);
                            record.dimension = Dimension::Overworld;
                            record.arrival = None;
                            let ok = store.save(&record).is_ok();
                            player.travel.departed = ok;
                            ok
                        })
                    };
                    if saved {
                        reply(world, client_id, INTENT, Ok(json!({})));
                        send(
                            world,
                            client_id,
                            travel::TRAVEL_EVENT,
                            json!({ "world": home }),
                        );
                        return;
                    }
                }
                // At their town hall, or the client moves itself to the
                // surface of the spawn column.
                let spawn = match guild_api::respawn_home(world, client_id) {
                    Some(home) => json!({ "x": home[0], "z": home[2], "feet": home }),
                    None => json!({ "x": 0, "z": 0 }),
                };
                if let Some(p) = world
                    .ecs()
                    .write_resource::<Gameplay>()
                    .players
                    .get_mut(client_id)
                {
                    p.moved = rules::MOVED_GRACE;
                }
                persist(world, client_id);
                send(world, client_id, RESPAWN_EVENT, spawn);
                send_vitals(world, client_id, None);
                reply(world, client_id, INTENT, Ok(json!({})));
            }
        }
    });

    world.set_method_handle("platform.use", |world, client_id, payload| {
        const INTENT: &str = "use";
        let Some(p) = parse::<VoxelPayload>(world, client_id, INTENT, payload) else {
            return;
        };
        if guild_api::use_hall(world, client_id, p.voxel)
            || items_api::use_anvil(world, client_id, p.voxel)
        {
            return;
        }
        // Switches need permission to use; everything else used on a block
        // (tilling, lighting portals) changes it.
        let action = {
            let g = world.ecs().read_resource::<Gameplay>();
            let igniter = g
                .players
                .get(client_id)
                .is_some_and(|player| g.rules.holds_igniter(player));
            let [x, y, z] = p.voxel;
            let raw = voxelize::VoxelAccess::get_raw_voxel(&*world.chunks(), x, y, z);
            if !igniter && crate::behaviors::use_circuit(g.rules.content(), raw).is_some() {
                land::Action::Use
            } else {
                land::Action::Build
            }
        };
        if !land_allows(world, client_id, p.voxel, action) {
            reply(world, client_id, INTENT, Err(IntentError::LandProtected));
            return;
        }
        if mobs_api::summon(world, client_id, p.voxel) {
            return;
        }
        let result = with_player(world, client_id, |g, view, position| {
            let here = g.dimensions.current;
            let roll = (g.random() * u64::MAX as f64) as u64;
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            let blast = rules.content().block("blast_charge").map(|b| b.id);
            if rules.holds_igniter(player) && blast.is_some() && view.block_at(p.voxel) == blast {
                // A lit blast charge leaves its block and burns a fuse.
                if player.realm == Realm::Survival {
                    player.inventory.wear_selected();
                }
                combat::prime(g, p.voxel, combat::FUSE_SECONDS, Some(client_id.to_owned()));
                Ok(vec![(p.voxel, 0)])
            } else if rules.holds_igniter(player) {
                rules.ignite(player, view, position, p.voxel, here)
            } else if rules.holds_fertiliser(player)
                && view
                    .raw_at(p.voxel)
                    .and_then(|raw| crate::behaviors::use_circuit(rules.content(), raw))
                    .is_none()
            {
                rules.fertilise(player, view, position, p.voxel, roll)
            } else {
                rules
                    .use_on(player, view, position, p.voxel)
                    .map(|raw| rules.with_other_half(p.voxel, raw))
            }
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(Ok(writes)) => {
                let block = writes.first().map(|(_, raw)| *raw).unwrap_or(0);
                let writes: Vec<(Vec3<i32>, u32)> = writes
                    .into_iter()
                    .map(|([x, y, z], raw)| (Vec3(x, y, z), raw))
                    .collect();
                world.chunks_mut().update_voxels(&writes);
                persist(world, client_id);
                reply(
                    world,
                    client_id,
                    INTENT,
                    Ok(json!({ "voxel": p.voxel, "block": block, "changed": writes.len() })),
                );
                send_inventory(world, client_id);
            }
            Some(Err(e)) => reply(world, client_id, INTENT, Err(e)),
        }
    });
    Ok(())
}

/// Applies survival every tick to every online survival player.
#[derive(Default)]
pub struct SurvivalSystem {
    last: Option<std::time::Instant>,
}

impl<'a> specs::System<'a> for SurvivalSystem {
    type SystemData = (
        specs::ReadExpect<'a, Chunks>,
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadExpect<'a, voxelize::WorldConfig>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(
        &mut self,
        (chunks, clients, config, positions, mut gameplay, mut events): Self::SystemData,
    ) {
        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|last| now.duration_since(last).as_secs_f32())
            .unwrap_or(0.0)
            .min(0.25);
        self.last = Some(now);
        if dt <= 0.0 {
            return;
        }

        let raining = gameplay.weather.raining();
        let Gameplay {
            rules,
            players,
            store,
            drops,
            rng,
            ..
        } = &mut *gameplay;
        let content = rules.content();
        let max_height = config.max_height as i32;
        let block_at = |x: f32, y: f32, z: f32| -> Option<u32> {
            let (x, y, z) = (x.floor() as i32, y.floor() as i32, z.floor() as i32);
            if y < 0 || y >= max_height {
                return Some(rules::AIR);
            }
            let coords = ChunkUtils::map_voxel_to_chunk(x, y, z, config.chunk_size);
            chunks
                .is_chunk_ready(&coords)
                .then(|| chunks.get_voxel(x, y, z))
        };
        let fluid = |id: u32| content.block_by_id(id).and_then(|b| b.fluid);
        let solid = |id: u32| {
            content
                .block_by_id(id)
                .is_some_and(|b| b.collision && b.fluid.is_none())
        };

        for (id, player) in players.iter_mut() {
            let Some(entity) = clients.get(id).map(|c| c.entity) else {
                continue;
            };
            let Some(p) = positions.get(entity).map(|p| [p.0 .0, p.0 .1, p.0 .2]) else {
                continue;
            };
            let feet_y = p[1] - EYE_HEIGHT;
            if !player.vulnerable() {
                let outcome = survival::creative_tick(&mut player.vitals, feet_y, dt);
                if outcome.changed {
                    events.dispatch(
                        Event::new(VITALS_EVENT)
                            .payload(vitals_payload(player, Some(survival::DamageKind::Void)))
                            .filter(ClientFilter::Direct(id.clone()))
                            .build(),
                    );
                }
                if outcome.died {
                    // Creative goods never spill into the world: the
                    // inventory stays with the player.
                    player.mining = None;
                    let record = store.record(id, player, Some(p));
                    if let Err(e) = store.save(&record) {
                        error!("could not save player {id} after death: {e}");
                    }
                }
                continue;
            }
            // Below the world there are no blocks, only the void.
            let in_void = feet_y < -2.0;
            let (Some(head), Some(feet), Some(below)) = (
                block_at(p[0], p[1], p[2]),
                block_at(p[0], feet_y + 0.1, p[2]),
                block_at(p[0], feet_y - 0.05, p[2]),
            ) else {
                continue; // standing in a chunk that is not loaded yet
            };
            let moved = player
                .last_position
                .map(|l| ((p[0] - l[0]).powi(2) + (p[2] - l[2]).powi(2)).sqrt())
                .unwrap_or(0.0)
                .min(2.0);
            player.last_position = Some(p);
            let lava = |id: u32| fluid(id) == Some(platform_content::FluidKind::Lava);
            let fire = |id: u32| content.block_by_id(id).is_some_and(|b| b.key == "fire");
            let water = |id: u32| fluid(id) == Some(platform_content::FluidKind::Water);
            let surroundings = Surroundings {
                feet_y,
                on_ground: solid(below),
                head_in_water: water(head),
                feet_in_water: water(feet),
                in_lava: lava(feet) || lava(head),
                in_void,
                in_fire: fire(feet) || fire(head),
                rained_on: raining && {
                    let (x, y, z) = (
                        p[0].floor() as i32,
                        p[1].floor() as i32,
                        p[2].floor() as i32,
                    );
                    y >= max_height || voxelize::VoxelAccess::get_sunlight(&*chunks, x, y, z) >= 15
                },
                moved,
            };
            let outcome = survival::tick(&mut player.vitals, surroundings, dt);
            if outcome.changed {
                let cause = outcome.damage.last().map(|(kind, _)| *kind);
                events.dispatch(
                    Event::new(VITALS_EVENT)
                        .payload(vitals_payload(player, cause))
                        .filter(ClientFilter::Direct(id.clone()))
                        .build(),
                );
            }
            if outcome.died {
                on_player_death(id, player, p, store, drops, rng, &mut events);
            }
        }
    }
}

/// Everything that happens when a player dies, from any cause: the whole
/// inventory spills where they fell, windows close, and the record is saved.
pub(crate) fn on_player_death(
    id: &str,
    player: &mut PlayerState,
    eye: [f32; 3],
    store: &PlayerStore,
    drops: &mut drops::Drops,
    rng: &mut u64,
    events: &mut voxelize::Events,
) {
    player.mining = None;
    // Experience is lost with the rest.
    player.xp = 0;
    let feet_y = eye[1] - EYE_HEIGHT;
    let mut spilled: Vec<inventory::Stack> = Vec::new();
    spilled.extend(player.inventory.slots.iter_mut().filter_map(|s| s.take()));
    spilled.extend(player.armor.iter_mut().filter_map(|s| s.take()));
    spilled.extend(player.craft_grid.iter_mut().filter_map(|s| s.take()));
    spilled.extend(player.offhand.take());
    spilled.extend(player.cursor.take());
    if let Some(window) = player.window.take() {
        spilled.extend(window.grid.into_iter().flatten());
    }
    for stack in spilled {
        *rng = rng
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let a = (*rng >> 33) as f32 / (1u64 << 31) as f32 * std::f32::consts::TAU;
        drops.spawn(
            stack,
            [eye[0], feet_y + 0.5, eye[2]],
            [a.cos() * 3.0, 4.0, a.sin() * 3.0],
            None,
        );
    }
    let direct = || ClientFilter::Direct(id.to_owned());
    events.dispatch(
        Event::new(INVENTORY_EVENT)
            .payload(json!({ "slots": player.inventory.slots, "selected": player.inventory.selected, "realm": player.realm }))
            .filter(direct())
            .build(),
    );
    events.dispatch(
        Event::new(items_api::WINDOW_EVENT)
            .payload(json!({ "kind": null }))
            .filter(direct())
            .build(),
    );
    let record = store.record(id, player, Some(eye));
    if let Err(e) = store.save(&record) {
        error!("could not save player {id} after death: {e}");
    }
}
