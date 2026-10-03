//! Server-authoritative gameplay: mining, building, inventory, crafting.
//!
//! Clients send intents as engine methods (`platform.<area>.<verb>`, see
//! docs/NETWORK_PROTOCOL.md §3). Each handler validates with [`rules`],
//! applies the authoritative change, persists the player, and answers the
//! sender with a `platform.result` event plus a fresh `platform.inventory`
//! snapshot when the inventory changed.

pub mod inventory;
pub mod rules;
pub mod store;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use log::{error, warn};
use platform_content::{Content, CraftingGrid};
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
use self::store::{PlayerRecord, PlayerStore, RECORD_VERSION};

pub const RESULT_EVENT: &str = "platform.result";
pub const INVENTORY_EVENT: &str = "platform.inventory";

/// World resource holding the rules and every online player's state.
pub struct Gameplay {
    rules: Rules,
    store: PlayerStore,
    players: HashMap<String, PlayerState>,
    rng: u64,
}

impl Gameplay {
    pub fn new(content: Arc<Content>, world_dir: &Path, seed: u32) -> Self {
        Self {
            rules: Rules::new(content),
            store: PlayerStore::new(world_dir),
            players: HashMap::new(),
            rng: seed as u64 ^ 0x5EED_CAFE_F00D,
        }
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
    send(world, client_id, RESULT_EVENT, payload);
}

fn send_inventory(world: &mut World, client_id: &str) {
    let snapshot = {
        let gameplay = world.ecs().read_resource::<Gameplay>();
        gameplay
            .players
            .get(client_id)
            .map(|p| json!({ "slots": p.inventory.slots, "selected": p.inventory.selected, "realm": p.realm }))
    };
    if let Some(snapshot) = snapshot {
        send(world, client_id, INVENTORY_EVENT, snapshot);
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
    if !gameplay.players.contains_key(client_id) {
        return None;
    }
    Some(f(&mut gameplay, &view, position))
}

fn persist(world: &mut World, client_id: &str) {
    let position = client_position(world, client_id);
    let gameplay = world.ecs().read_resource::<Gameplay>();
    let Some(player) = gameplay.players.get(client_id) else {
        return;
    };
    let record = PlayerRecord {
        version: RECORD_VERSION,
        id: client_id.to_owned(),
        inventory: player.inventory.clone(),
        position,
    };
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
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SelectPayload {
    slot: usize,
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
    let realm = realm_of(world, &id);
    let loaded = {
        let gameplay = world.ecs().read_resource::<Gameplay>();
        gameplay.store.load(&id)
    };
    let mut inventory = match loaded {
        Ok(Some(record)) => record.inventory,
        Ok(None) => Inventory::default(),
        Err(e) => {
            // Never hand out an empty inventory over a record we failed to
            // read: that would silently wipe the player on the next save.
            error!("refusing gameplay for {id}: cannot load player record: {e}");
            return;
        }
    };
    {
        let mut gameplay = world.ecs().write_resource::<Gameplay>();
        let dropped = inventory.normalize(gameplay.rules.content());
        if dropped > 0 {
            warn!("player {id}: dropped {dropped} stack(s) of items that no longer exist");
        }
        gameplay.players.insert(
            id.clone(),
            PlayerState {
                inventory,
                mining: None,
                realm,
            },
        );
    }
    send_inventory(world, &id);
}

fn on_leave(world: &mut World, entity: Entity) {
    let Some(id) = world
        .read_component::<IDComp>()
        .get(entity)
        .map(|c| c.0.clone())
    else {
        return;
    };
    persist(world, &id);
    world.ecs().write_resource::<Gameplay>().players.remove(&id);
}

pub fn install(world: &mut World, content: Arc<Content>, world_dir: &Path, seed: u32) {
    world
        .ecs_mut()
        .insert(Gameplay::new(content, world_dir, seed));
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
                persist(world, client_id);
                reply(
                    world,
                    client_id,
                    INTENT,
                    Ok(json!({ "voxel": p.voxel, "drops": outcome.drops, "toolBroke": outcome.tool_broke })),
                );
                send_inventory(world, client_id);
            }
            Some(Err(e)) => reply(world, client_id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.build.place", |world, client_id, payload| {
        const INTENT: &str = "build.place";
        let Some(p) = parse::<PlacePayload>(world, client_id, INTENT, payload) else {
            return;
        };
        let result = with_player(world, client_id, |g, view, position| {
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            rules.place(player, view, position, p.voxel, p.slot, p.block.as_deref())
        });
        match result {
            None => not_joined(world, client_id, INTENT),
            Some(Ok(block)) => {
                let [x, y, z] = p.voxel;
                world.chunks_mut().update_voxel(&Vec3(x, y, z), block);
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
}
