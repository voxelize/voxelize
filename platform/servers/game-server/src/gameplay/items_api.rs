//! Engine wiring for windows (inventory screen, workbench, furnace, chest),
//! block containers and dropped items.

use serde::Deserialize;
use serde_json::{json, Value};
use specs::WorldExt;
use voxelize::{ClientFilter, Event, PositionComp, World};

use super::containers::{Container, Furnace};
use super::inventory::Stack;
use super::rules::{IntentError, OpenWindow};
use super::window::{Click, Window, WindowKind};
use super::{client_position, not_joined, parse, persist, reply, send, send_inventory, Gameplay};

pub const WINDOW_EVENT: &str = "platform.window";
pub const DROPS_EVENT: &str = "platform.drops";
pub const PICKUP_EVENT: &str = "platform.pickup";

fn container_kind(container: &Container) -> WindowKind {
    match container {
        Container::Chest { .. } => WindowKind::Chest,
        Container::Furnace(_) => WindowKind::Furnace,
        // The owner stocks a stall like a small chest.
        Container::Stall(_) => WindowKind::Chest,
        Container::Vault { .. } => WindowKind::Chest,
    }
}

/// Experience for taking `count` of a smelted item: the recipe's
/// experience each, the fraction paid by chance (`roll` in 0..1).
pub(super) fn smelting_xp(
    content: &platform_content::Content,
    item: u32,
    count: u32,
    roll: f64,
) -> u32 {
    let Some(key) = content.item_by_id(item).map(|i| i.key.clone()) else {
        return 0;
    };
    let each = content
        .processing()
        .iter()
        .find(|r| r.output.item == key)
        .map_or(0.0, |r| r.experience as f64);
    let total = each * count as f64;
    total.floor() as u32 + u32::from(roll < total.fract())
}

/// Assemble the player's open window (or the inventory screen).
fn build_window(g: &Gameplay, id: &str) -> Option<Window> {
    let player = g.players.get(id)?;
    let inventory = &player.inventory.slots;
    let window = match &player.window {
        None => {
            let mut c = vec![None];
            c.extend(player.craft_grid.iter().cloned());
            c.extend(player.armor.iter().cloned());
            c.push(player.offhand.clone());
            Window::new(WindowKind::Player, c, inventory)
        }
        Some(open) => match open.kind {
            WindowKind::Player => return None,
            WindowKind::Workbench => {
                let mut c = vec![None];
                c.extend(open.grid.iter().cloned());
                Window::new(WindowKind::Workbench, c, inventory)
            }
            WindowKind::Furnace | WindowKind::Chest => {
                let container = g.containers.map.get(&open.at?)?;
                let slots = match container.vault_guild() {
                    Some(guild) => g.dimensions.vaults.lock().ok()?.slots(guild),
                    None => container.slots().to_vec(),
                };
                Window::new(container_kind(container), slots, inventory)
            }
        },
    };
    let mut window = window;
    window.refresh_result(g.rules.content());
    Some(window)
}

/// Write a window's slots back to where they live.
fn store_window(g: &mut Gameplay, id: &str, w: &Window) {
    let at = g
        .players
        .get(id)
        .and_then(|p| p.window.as_ref())
        .and_then(|o| o.at);
    if let (WindowKind::Furnace | WindowKind::Chest, Some(at)) = (w.kind, at) {
        if let Some(guild) = g
            .containers
            .map
            .get(&at)
            .and_then(|c| c.vault_guild())
            .map(str::to_owned)
        {
            let stored = g
                .dimensions
                .vaults
                .lock()
                .map_err(|_| std::io::Error::other("vaults lock poisoned"))
                .and_then(|mut v| v.store(&guild, w.container().to_vec()));
            if let Err(e) = stored {
                log::error!("could not save the vault of guild {guild}: {e}");
            }
        } else if let Some(container) = g.containers.map.get_mut(&at) {
            *container.slots_mut() = w.container().to_vec();
            g.containers.dirty = true;
        }
    }
    let Some(player) = g.players.get_mut(id) else {
        return;
    };
    player.inventory.slots = w.inventory().to_vec();
    match w.kind {
        WindowKind::Player => {
            let c = w.container();
            player.craft_grid = c[1..5].to_vec();
            player.armor = c[5..9].to_vec();
            player.offhand = c[9].clone();
        }
        WindowKind::Workbench => {
            if let Some(open) = player.window.as_mut() {
                open.grid = w.container()[1..10].to_vec();
            }
        }
        _ => {}
    }
}

pub(super) fn window_payload(g: &Gameplay, id: &str) -> Value {
    let Some(player) = g.players.get(id) else {
        return json!({ "kind": null });
    };
    let Some(w) = build_window(g, id) else {
        return json!({ "kind": null });
    };
    let at = player.window.as_ref().and_then(|o| o.at);
    let furnace = at
        .and_then(|at| g.containers.map.get(&at))
        .and_then(|c| match c {
            Container::Furnace(f) => Some(furnace_payload(f, g)),
            _ => None,
        });
    json!({
        "kind": w.kind,
        "open": player.window.is_some(),
        "at": at,
        "slots": w.slots,
        "rules": w.rules,
        "inventoryStart": w.inventory_start,
        "grid": w.grid,
        "cursor": player.cursor,
        "furnace": furnace,
    })
}

fn furnace_payload(f: &Furnace, g: &Gameplay) -> Value {
    json!({
        "burnLeft": f.burn_left,
        "burnTotal": f.burn_total,
        "progress": f.progress,
        "progressTotal": f.recipe_ticks(g.rules.content()).unwrap_or(0),
    })
}

pub(super) fn send_window(world: &mut World, id: &str) {
    let payload = window_payload(&world.ecs().read_resource::<Gameplay>(), id);
    send(world, id, WINDOW_EVENT, payload);
}

/// Everyone else looking into the container at `at`.
fn viewers(g: &Gameplay, at: [i32; 3], except: &str) -> Vec<String> {
    // Every vault of a guild shows the same items.
    let vault = g.containers.map.get(&at).and_then(|c| c.vault_guild());
    g.players
        .iter()
        .filter(|(id, p)| {
            id.as_str() != except
                && p.window.as_ref().and_then(|w| w.at).is_some_and(|open| {
                    open == at
                        || vault.is_some_and(|guild| {
                            g.containers.map.get(&open).and_then(|c| c.vault_guild()) == Some(guild)
                        })
                })
        })
        .map(|(id, _)| id.clone())
        .collect()
}

fn spill_at(g: &mut Gameplay, stacks: Vec<Stack>, at: [f32; 3], owner: Option<&str>) {
    for (i, stack) in stacks.into_iter().enumerate() {
        let angle = i as f32 * 2.399;
        g.drops.spawn(
            stack,
            at,
            [angle.cos() * 2.0, 3.0, angle.sin() * 2.0],
            owner,
        );
    }
}

/// Close whatever window the player has open, returning grid and cursor
/// items to the inventory and dropping what does not fit.
pub(super) fn close_window(world: &mut World, id: &str) {
    let position = client_position(world, id);
    {
        let mut g = world.ecs().write_resource::<Gameplay>();
        let Some(mut w) = build_window(&g, id) else {
            return;
        };
        let mut cursor = g.players.get_mut(id).and_then(|p| p.cursor.take());
        let overflow = w.close(g.rules.content(), &mut cursor);
        store_window(&mut g, id, &w);
        if let Some(player) = g.players.get_mut(id) {
            player.window = None;
            player.cursor = None;
        }
        if let Some(p) = position {
            spill_at(&mut g, overflow, p, Some(id));
        }
    }
    send(world, id, WINDOW_EVENT, json!({ "kind": null }));
    send_inventory(world, id);
}

pub(super) fn block_removed(world: &mut World, voxel: [i32; 3], drops: &[(u32, u32)]) {
    // Writes are staged until the next tick, so the broken block is still
    // readable here.
    let loot_stage = {
        let chunks = world.chunks();
        let raw = voxelize::VoxelAccess::get_raw_voxel(&*chunks, voxel[0], voxel[1], voxel[2]);
        let id = raw & 0xFFFF;
        let g = world.ecs().read_resource::<Gameplay>();
        let is_chest = g
            .rules
            .content()
            .block_by_id(id)
            .is_some_and(|b| b.key == "chest");
        let stage = (raw >> 24) & 0xF;
        (is_chest && stage > 0).then_some(stage)
    };
    let center = [
        voxel[0] as f32 + 0.5,
        voxel[1] as f32 + 0.5,
        voxel[2] as f32 + 0.5,
    ];
    let closed: Vec<String> = {
        let mut g = world.ecs().write_resource::<Gameplay>();
        let mut stacks: Vec<Stack> = drops
            .iter()
            .map(|&(item, count)| Stack {
                item,
                count,
                durability: g
                    .rules
                    .content()
                    .item_by_id(item)
                    .and_then(|i| i.durability),
            })
            .collect();
        let mut closed = Vec::new();
        if !g.containers.map.contains_key(&voxel) {
            // An unopened structure chest still holds its loot.
            if let Some(stage) = loot_stage {
                stacks.extend(
                    super::containers::structure_loot(g.rules.content(), stage, voxel)
                        .into_iter()
                        .flatten(),
                );
            }
        }
        if let Some(mut container) = g.containers.map.remove(&voxel) {
            stacks.extend(container.take_all());
            g.containers.dirty = true;
            closed = viewers(&g, voxel, "");
            for id in &closed {
                if let Some(p) = g.players.get_mut(id) {
                    p.window = None;
                }
            }
        }
        spill_at(&mut g, stacks, center, None);
        if g.containers.dirty {
            let dir = g.world_dir.clone();
            if let Err(e) = g.containers.save(&dir) {
                log::error!("could not save containers: {e}");
            }
        }
        closed
    };
    for id in closed {
        send(world, &id, WINDOW_EVENT, json!({ "kind": null }));
    }
}

pub(super) fn block_placed(world: &mut World, voxel: [i32; 3], block: u32, placer: &str) {
    let name = world
        .clients()
        .get(placer)
        .map(|c| c.username.clone())
        .unwrap_or_default();
    let mut g = world.ecs().write_resource::<Gameplay>();
    let Some(key) = g.rules.content().block_by_id(block).map(|b| b.key.clone()) else {
        return;
    };
    let creative = g
        .players
        .get(placer)
        .is_some_and(|p| p.realm == platform_ticket::Realm::Creative);
    // A stall belongs to whoever placed it.
    let container = if key == "trade_stall" {
        Some(Container::Stall(super::containers::Stall::new(
            placer, &name, creative,
        )))
    } else if key == "guild_vault" {
        // The vault of the guild whose land it stands on (checked before placing).
        let dimension = g.dimensions.current;
        g.dimensions
            .land
            .read()
            .ok()
            .and_then(|l| {
                l.at(dimension, voxel[0], voxel[2])
                    .and_then(|l| l.guild.clone())
            })
            .map(|guild| Container::Vault {
                guild: guild.id,
                empty: Vec::new(),
            })
    } else {
        Container::for_block(&key)
    };
    if let Some(container) = container {
        g.containers.map.insert(voxel, container);
        let dir = g.world_dir.clone();
        if let Err(e) = g.containers.save(&dir) {
            log::error!("could not save containers: {e}");
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenPayload {
    #[serde(default)]
    voxel: Option<[i32; 3]>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClickPayload {
    slot: usize,
    click: Click,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DragPayload {
    slots: Vec<usize>,
    #[serde(default)]
    one_each: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FillPayload {
    recipe: String,
    #[serde(default)]
    max: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DropPayload {
    #[serde(default)]
    all: bool,
}

/// Run a window operation and push the results to the player and to anyone
/// else viewing the same container.
fn window_op(
    world: &mut World,
    id: &str,
    intent: &str,
    op: impl FnOnce(
        &mut Window,
        &platform_content::Content,
        &mut Option<Stack>,
    ) -> Result<Vec<Stack>, IntentError>,
) {
    let position = client_position(world, id);
    let result = {
        let mut g = world.ecs().write_resource::<Gameplay>();
        match g.players.get(id) {
            None => None,
            Some(p) if super::rules::active(p).is_err() => {
                Some(super::rules::active(p).map(|_| unreachable!()))
            }
            Some(_) => match build_window(&g, id) {
                None => Some(Err(IntentError::NothingThere)),
                Some(mut w) => {
                    let mut cursor = g.players.get_mut(id).and_then(|p| p.cursor.take());
                    let content = g.rules.content_arc();
                    // A furnace's output: smelting experience is paid on taking it.
                    let output_before = (w.kind == WindowKind::Furnace)
                        .then(|| w.slots.get(2).cloned().flatten())
                        .flatten();
                    let outcome = op(&mut w, &content, &mut cursor);
                    if let Some(p) = g.players.get_mut(id) {
                        p.cursor = cursor;
                    }
                    if let (Ok(_), Some(before)) = (&outcome, output_before) {
                        let left = w
                            .slots
                            .get(2)
                            .cloned()
                            .flatten()
                            .filter(|s| s.item == before.item)
                            .map_or(0, |s| s.count);
                        let taken = before.count.saturating_sub(left);
                        let roll = g.random();
                        if let Some(p) = g.players.get_mut(id) {
                            if taken > 0 && p.realm == platform_ticket::Realm::Survival {
                                p.xp = p.xp.saturating_add(smelting_xp(
                                    &content,
                                    before.item,
                                    taken,
                                    roll,
                                ));
                            }
                        }
                    }
                    if let Ok(dropped) = &outcome {
                        store_window(&mut g, id, &w);
                        if let Some(pos) = position {
                            spill_at(&mut g, dropped.clone(), pos, Some(id));
                        }
                    }
                    let at = g
                        .players
                        .get(id)
                        .and_then(|p| p.window.as_ref())
                        .and_then(|o| o.at);
                    let others = at.map(|at| viewers(&g, at, id)).unwrap_or_default();
                    if g.containers.dirty {
                        let dir = g.world_dir.clone();
                        if let Err(e) = g.containers.save(&dir) {
                            log::error!("could not save containers: {e}");
                        }
                    }
                    Some(outcome.map(|_| others))
                }
            },
        }
    };
    match result {
        None => not_joined(world, id, intent),
        Some(Ok(others)) => {
            send_window(world, id);
            send_inventory(world, id);
            for other in others {
                send_window(world, &other);
            }
            persist(world, id);
            // Experience from smelting, and armor put on or taken off.
            super::send_vitals(world, id, None);
        }
        Some(Err(e)) => {
            reply(world, id, intent, Err(e));
            send_window(world, id);
        }
    }
}

pub(super) fn install(world: &mut World) {
    world.set_method_handle("platform.window.open", |world, id, payload| {
        const INTENT: &str = "window.open";
        let Some(p) = parse::<OpenPayload>(world, id, INTENT, payload) else {
            return;
        };
        // Someone else's stall shows its offers instead of opening.
        let stall_owner = p.voxel.and_then(|at| {
            let g = world.ecs().read_resource::<Gameplay>();
            match g.containers.map.get(&at) {
                Some(Container::Stall(stall)) => Some(stall.owner.clone()),
                _ => None,
            }
        });
        if let (Some(owner), Some(at)) = (&stall_owner, p.voxel) {
            if owner != id {
                super::stall::send_view(world, id, at);
                reply(world, id, INTENT, Ok(json!({ "stall": at })));
                return;
            }
        }
        close_window(world, id);
        let position = client_position(world, id);
        let loot_opened = false;
        let opened = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let reach = g.rules.reach;
            match (p.voxel, g.players.contains_key(id)) {
                (_, false) => Err(None),
                (None, true) => Ok(()),
                (Some(voxel), true) => {
                    let block = {
                        let chunks = world.chunks();
                        voxelize::VoxelAccess::get_voxel(&*chunks, voxel[0], voxel[1], voxel[2])
                    };
                    let key = g.rules.content().block_by_id(block).map(|b| b.key.clone());
                    let close = position.is_some_and(|pos| {
                        (0..3)
                            .map(|i| (voxel[i] as f32 + 0.5 - pos[i]).powi(2))
                            .sum::<f32>()
                            <= reach * reach
                    });
                    let kind = match key.as_deref() {
                        Some("crafting_table") => Some(WindowKind::Workbench),
                        Some("furnace") => Some(WindowKind::Furnace),
                        Some("chest") => Some(WindowKind::Chest),
                        Some("guild_vault") => Some(WindowKind::Chest),
                        Some("trade_stall") => Some(WindowKind::Chest),
                        _ => None,
                    };
                    let protected = kind.is_some_and(|k| k != WindowKind::Workbench) && {
                        let dimension = g.dimensions.current;
                        !g.dimensions
                            .land
                            .read()
                            .map(|index| {
                                index.allows(dimension, id, voxel, super::land::Action::Containers)
                            })
                            .unwrap_or(false)
                    };
                    // A vault opens for its guild's survival members only.
                    let vault_refused =
                        match g.containers.map.get(&voxel).and_then(|c| c.vault_guild()) {
                            None => None,
                            Some(_)
                                if g.players.get(id).is_some_and(|p| {
                                    p.realm != platform_ticket::Realm::Survival
                                }) =>
                            {
                                Some(IntentError::SurvivalOnly)
                            }
                            Some(guild) => (!g
                                .dimensions
                                .guilds
                                .read()
                                .is_ok_and(|index| index.is_member(id, guild)))
                            .then_some(IntentError::NotOwner),
                        };
                    match (kind, close) {
                        (None, _) => Err(Some(IntentError::NothingThere)),
                        (_, false) => Err(Some(IntentError::OutOfReach)),
                        _ if protected => Err(Some(IntentError::LandProtected)),
                        _ if vault_refused.is_some() => Err(vault_refused),
                        (Some(kind), true) => {
                            if kind != WindowKind::Workbench
                                && !g.containers.map.contains_key(&voxel)
                            {
                                // A container block placed before containers existed.
                                let fresh =
                                    Container::for_block(key.as_deref().unwrap_or_default());
                                if let Some(fresh) = fresh {
                                    g.containers.map.insert(voxel, fresh);
                                }
                            }
                            let player = g.players.get_mut(id).expect("checked");
                            if player.vitals.is_dead() {
                                Err(Some(IntentError::Dead))
                            } else {
                                player.window = Some(OpenWindow {
                                    kind,
                                    at: Some(voxel),
                                    grid: if kind == WindowKind::Workbench {
                                        vec![None; 9]
                                    } else {
                                        Vec::new()
                                    },
                                });
                                Ok(())
                            }
                        }
                    }
                }
            }
        };
        if let (true, Some(voxel)) = (loot_opened, p.voxel) {
            // The loot now lives in the container: clear the marker so it
            // can never be rolled again, and save.
            let id_only = {
                let chunks = world.chunks();
                voxelize::VoxelAccess::get_voxel(&*chunks, voxel[0], voxel[1], voxel[2])
            };
            world
                .chunks_mut()
                .update_voxel(&voxelize::Vec3(voxel[0], voxel[1], voxel[2]), id_only);
            let mut g = world.ecs().write_resource::<Gameplay>();
            let dir = g.world_dir.clone();
            if let Err(e) = g.containers.save(&dir) {
                log::error!("could not save containers: {e}");
            }
        }
        match opened {
            Err(None) => not_joined(world, id, INTENT),
            Err(Some(e)) => reply(world, id, INTENT, Err(e)),
            Ok(()) => {
                send_window(world, id);
                if let (Some(_), Some(at)) = (stall_owner, p.voxel) {
                    super::stall::send_view(world, id, at);
                }
            }
        }
    });

    world.set_method_handle("platform.window.close", |world, id, _| {
        close_window(world, id);
        persist(world, id);
    });

    world.set_method_handle("platform.window.click", |world, id, payload| {
        const INTENT: &str = "window.click";
        let Some(p) = parse::<ClickPayload>(world, id, INTENT, payload) else {
            return;
        };
        window_op(world, id, INTENT, |w, content, cursor| {
            w.click(content, cursor, p.slot, p.click)
                .map_err(IntentError::Window)
        });
    });

    world.set_method_handle("platform.window.drag", |world, id, payload| {
        const INTENT: &str = "window.drag";
        let Some(p) = parse::<DragPayload>(world, id, INTENT, payload) else {
            return;
        };
        window_op(world, id, INTENT, |w, content, cursor| {
            w.drag(content, cursor, &p.slots, p.one_each)
                .map(|_| Vec::new())
                .map_err(IntentError::Window)
        });
    });

    world.set_method_handle("platform.window.fill", |world, id, payload| {
        const INTENT: &str = "window.fill";
        let Some(p) = parse::<FillPayload>(world, id, INTENT, payload) else {
            return;
        };
        window_op(world, id, INTENT, |w, content, _| {
            match w.fill_recipe(content, &p.recipe, p.max) {
                Ok(0) => Err(IntentError::MissingIngredients),
                Ok(_) => Ok(Vec::new()),
                Err(_) => Err(IntentError::NoRecipe),
            }
        });
    });

    // Q: drop from the selected hotbar slot without opening a window.
    world.set_method_handle("platform.inventory.drop", |world, id, payload| {
        const INTENT: &str = "inventory.drop";
        let Some(p) = parse::<DropPayload>(world, id, INTENT, payload) else {
            return;
        };
        let position = client_position(world, id);
        let direction = facing(world, id);
        let dropped = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let Some(player) = g.players.get_mut(id) else {
                drop(g);
                return not_joined(world, id, INTENT);
            };
            let slot = player.inventory.selected;
            let stack = player.inventory.slots[slot].take();
            let dropped = stack.map(|mut s| {
                let n = if p.all { s.count } else { 1 };
                s.count -= n;
                let out = Stack {
                    count: n,
                    ..s.clone()
                };
                player.inventory.slots[slot] = (s.count > 0).then_some(s);
                out
            });
            if let (Some(stack), Some(pos)) = (dropped.clone(), position) {
                let [dx, dy, dz] = direction;
                g.drops.spawn(
                    stack,
                    [pos[0] + dx * 0.4, pos[1] - 0.3, pos[2] + dz * 0.4],
                    [dx * 6.0, dy * 6.0 + 2.0, dz * 6.0],
                    Some(id),
                );
            }
            dropped.is_some()
        };
        if dropped {
            send_inventory(world, id);
            persist(world, id);
        }
    });
}

/// Where the player is looking, from their last peer update.
fn facing(world: &World, id: &str) -> [f32; 3] {
    let Some(entity) = world.clients().get(id).map(|c| c.entity) else {
        return [0.0, 0.0, 0.0];
    };
    let directions = world.read_component::<voxelize::DirectionComp>();
    directions
        .get(entity)
        .map(|d| [d.0 .0, d.0 .1, d.0 .2])
        .unwrap_or([0.0, 0.0, 0.0])
}

/// Furnaces, dropped items and pickups, every tick.
#[derive(Default)]
pub struct WorldItemsSystem {
    last: Option<std::time::Instant>,
    furnace_ticks: f32,
    since_drops_sent: f32,
    since_furnace_sent: f32,
    since_saved: f32,
}

impl<'a> specs::System<'a> for WorldItemsSystem {
    type SystemData = (
        specs::ReadExpect<'a, voxelize::Chunks>,
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadExpect<'a, voxelize::WorldConfig>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (chunks, clients, config, positions, mut g, mut events): Self::SystemData) {
        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0)
            .min(0.25);
        self.last = Some(now);
        if dt <= 0.0 {
            return;
        }
        let content = g.rules.content_arc();
        let direct = |id: &str| ClientFilter::Direct(id.to_owned());

        // Furnaces run at 20 game ticks per second.
        self.furnace_ticks += dt * 20.0;
        let steps = self.furnace_ticks.floor() as u32;
        self.furnace_ticks -= steps as f32;
        let mut changed_furnaces = Vec::new();
        for (at, container) in g.containers.map.iter_mut() {
            if let Container::Furnace(f) = container {
                let mut changed = false;
                for _ in 0..steps {
                    changed |= f.tick(&content);
                }
                if changed {
                    changed_furnaces.push(*at);
                }
            }
        }
        if !changed_furnaces.is_empty() {
            g.containers.dirty = true;
        }
        self.since_furnace_sent += dt;
        if self.since_furnace_sent >= 0.25 {
            self.since_furnace_sent = 0.0;
            let watchers: Vec<String> =
                g.players
                    .iter()
                    .filter(|(_, p)| {
                        p.window.as_ref().and_then(|w| w.at).is_some_and(|at| {
                            changed_furnaces.contains(&at)
                                || g.containers.map.get(&at).is_some_and(
                                    |c| matches!(c, Container::Furnace(f) if f.is_lit()),
                                )
                        })
                    })
                    .map(|(id, _)| id.clone())
                    .collect();
            for id in watchers {
                events.dispatch(
                    Event::new(WINDOW_EVENT)
                        .payload(window_payload(&g, &id))
                        .filter(direct(&id))
                        .build(),
                );
            }
        }

        // Blocks broken by behaviours (decayed leaves, uprooted plants) drop.
        let broken = g.broken.drain();
        for b in broken {
            let id = b.raw & 0xFFFF;
            let Some(def) = content.block_by_id(id) else {
                continue;
            };
            let stage = (b.raw >> 24) & 0xF;
            let ripe = def.stages > 0 && stage + 1 >= def.stages && !def.grown_drops.is_empty();
            let table = if ripe { &def.grown_drops } else { &def.drops };
            for drop in table {
                g.rng = g
                    .rng
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                let roll = (g.rng >> 11) as f64 / (1u64 << 53) as f64;
                if roll >= drop.chance as f64 {
                    continue;
                }
                let span = drop.max - drop.min + 1;
                let count = drop.min + ((g.rng >> 7) % span as u64) as u32;
                let Some(item) = content.item(&drop.item) else {
                    continue;
                };
                let center = [
                    b.voxel[0] as f32 + 0.5,
                    b.voxel[1] as f32 + 0.5,
                    b.voxel[2] as f32 + 0.5,
                ];
                g.drops.spawn(
                    Stack {
                        item: item.id,
                        count,
                        durability: item.durability,
                    },
                    center,
                    [0.0, 2.0, 0.0],
                    None,
                );
            }
        }

        // Dropped items: physics, merging, despawn.
        let max_height = config.max_height as i32;
        let solid = |x: i32, y: i32, z: i32| {
            if y < 0 || y >= max_height {
                return false;
            }
            let coords = voxelize::ChunkUtils::map_voxel_to_chunk(x, y, z, config.chunk_size);
            if !chunks.is_chunk_ready(&coords) {
                return true; // hold items still until their chunk loads
            }
            let id = voxelize::VoxelAccess::get_voxel(&*chunks, x, y, z);
            content
                .block_by_id(id)
                .is_some_and(|b| b.collision && b.fluid.is_none())
        };
        let limit = |item: u32| content.item_by_id(item).map(|i| i.stack_size).unwrap_or(1);
        g.drops.step(dt, solid, limit);

        // Pickups.
        let ids: Vec<String> = g.players.keys().cloned().collect();
        for id in ids {
            let Some(entity) = clients.get(&id).map(|c| c.entity) else {
                continue;
            };
            let Some(p) = positions.get(entity).map(|p| [p.0 .0, p.0 .1, p.0 .2]) else {
                continue;
            };
            if g.players
                .get(&id)
                .is_none_or(|pl| super::rules::active(pl).is_err())
            {
                continue;
            }
            let feet = [p[0], p[1] - super::survival::EYE_HEIGHT, p[2]];
            let mut picked = Vec::new();
            for drop_id in g.drops.in_reach(&id, feet) {
                let Some(stack) = g.drops.get_mut(drop_id).map(|d| d.stack.clone()) else {
                    continue;
                };
                let player = g.players.get_mut(&id).expect("listed");
                let left = player.inventory.add(&content, stack.item, stack.count);
                if left < stack.count {
                    picked.push((stack.item, stack.count - left));
                    // Tools keep their wear: add() gives fresh durability, so restore it.
                    if let Some(d) = stack.durability {
                        if let Some(s) =
                            player.inventory.slots.iter_mut().flatten().rev().find(|s| {
                                s.item == stack.item
                                    && s.durability
                                        == content.item_by_id(stack.item).and_then(|i| i.durability)
                            })
                        {
                            s.durability = Some(d);
                        }
                    }
                }
                if left == 0 {
                    g.drops.remove(drop_id);
                } else if let Some(d) = g.drops.get_mut(drop_id) {
                    d.stack.count = left;
                }
            }
            if !picked.is_empty() {
                let player = &g.players[&id];
                events.dispatch(
                    Event::new(super::INVENTORY_EVENT)
                        .payload(json!({ "slots": player.inventory.slots, "selected": player.inventory.selected, "realm": player.realm }))
                        .filter(direct(&id))
                        .build(),
                );
                events.dispatch(
                    Event::new(PICKUP_EVENT)
                        .payload(json!({ "items": picked }))
                        .filter(direct(&id))
                        .build(),
                );
                if player.window.is_none() {
                    // keep an open inventory screen in sync
                }
                events.dispatch(
                    Event::new(WINDOW_EVENT)
                        .payload(window_payload(&g, &id))
                        .filter(direct(&id))
                        .build(),
                );
            }
        }

        // Tell nearby clients where items are, ten times a second at most.
        self.since_drops_sent += dt;
        if g.drops.changed && self.since_drops_sent >= 0.1 {
            self.since_drops_sent = 0.0;
            g.drops.changed = false;
            for client in clients.values() {
                let Some(p) = positions.get(client.entity) else {
                    continue;
                };
                let near: Vec<Value> = g
                    .drops
                    .items
                    .iter()
                    .filter(|d| (d.position[0] - p.0 .0).abs() < 64.0 && (d.position[2] - p.0 .2).abs() < 64.0)
                    .map(|d| json!({ "id": d.id, "item": d.stack.item, "count": d.stack.count, "p": d.position }))
                    .collect();
                events.dispatch(
                    Event::new(DROPS_EVENT)
                        .payload(json!({ "items": near }))
                        .filter(direct(&client.id))
                        .build(),
                );
            }
        }

        // Furnace progress is saved every few seconds; chest edits save at once.
        self.since_saved += dt;
        if g.containers.dirty && self.since_saved >= 5.0 {
            self.since_saved = 0.0;
            let dir = g.world_dir.clone();
            if let Err(e) = g.containers.save(&dir) {
                log::error!("could not save containers: {e}");
            }
        }
    }
}

/// Using an anvil repairs the held item fully for experience levels (one per
/// quarter of its durability restored; free in creative). Returns false
/// when the block is not an anvil.
pub(super) fn use_anvil(world: &mut World, id: &str, voxel: [i32; 3]) -> bool {
    const INTENT: &str = "use";
    let is_anvil = {
        let g = world.ecs().read_resource::<Gameplay>();
        let block =
            voxelize::VoxelAccess::get_voxel(&*world.chunks(), voxel[0], voxel[1], voxel[2]);
        g.rules
            .content()
            .block_by_id(block)
            .is_some_and(|b| b.key == "anvil")
    };
    if !is_anvil {
        return false;
    }
    if !super::land_allows(world, id, voxel, super::land::Action::Use) {
        reply(world, id, INTENT, Err(IntentError::LandProtected));
        return true;
    }
    let position = client_position(world, id);
    let result = {
        let mut g = world.ecs().write_resource::<Gameplay>();
        let reach = g.rules.reach;
        let content = g.rules.content_arc();
        let close = position.is_some_and(|p| {
            (0..3)
                .map(|i| (voxel[i] as f32 + 0.5 - p[i]).powi(2))
                .sum::<f32>()
                <= reach * reach
        });
        match g.players.get_mut(id) {
            None => Err(IntentError::NothingThere),
            Some(_) if !close => Err(IntentError::OutOfReach),
            Some(player) if super::rules::active(player).is_err() => {
                super::rules::active(player).map(|_| unreachable!())
            }
            Some(player) => repair_held(&content, player),
        }
    };
    let ok = result.is_ok();
    reply(world, id, INTENT, result);
    if ok {
        send_inventory(world, id);
        super::send_vitals(world, id, None);
        persist(world, id);
    }
    true
}

/// Repair the selected item at an anvil, paying levels in survival.
pub(super) fn repair_held(
    content: &platform_content::Content,
    player: &mut super::rules::PlayerState,
) -> Result<Value, IntentError> {
    let slot = player.inventory.selected;
    let stack = player.inventory.get(slot).ok_or(IntentError::CannotUse)?;
    let max = content
        .item_by_id(stack.item)
        .and_then(|i| i.durability)
        .ok_or(IntentError::CannotUse)?;
    let worn = max.saturating_sub(stack.durability.unwrap_or(max));
    let cost = super::xp::repair_cost(worn, max);
    if cost == 0 {
        return Err(IntentError::CannotUse);
    }
    if player.realm == platform_ticket::Realm::Survival {
        player.xp = super::xp::spend_levels(player.xp, cost).ok_or(IntentError::NotEnoughXp)?;
    }
    if let Some(s) = player
        .inventory
        .slots
        .get_mut(slot)
        .and_then(Option::as_mut)
    {
        s.durability = Some(max);
    }
    Ok(json!({ "repaired": slot, "levels": cost }))
}

#[cfg(test)]
mod xp_tests {
    use super::*;
    use crate::gameplay::inventory::{Inventory, Stack};
    use crate::gameplay::rules::PlayerState;

    #[test]
    fn anvils_repair_for_levels_and_furnaces_pay_experience() {
        let c = platform_content::Content::load(platform_content::default_pack_dir()).unwrap();
        let pick = c.item("iron_pickaxe").unwrap();
        let max = pick.durability.unwrap();
        let mut inv = Inventory::default();
        inv.slots[0] = Some(Stack {
            item: pick.id,
            count: 1,
            durability: Some(max - max / 2),
        });
        let mut p = PlayerState::new(inv, platform_ticket::Realm::Survival, Default::default());
        assert_eq!(repair_held(&c, &mut p), Err(IntentError::NotEnoughXp));
        p.xp = super::super::xp::points_for_level(3);
        let r = repair_held(&c, &mut p).unwrap();
        assert_eq!(r["levels"], 2);
        assert_eq!(super::super::xp::level_of(p.xp).0, 1);
        assert_eq!(p.inventory.get(0).unwrap().durability, Some(max));
        assert_eq!(
            repair_held(&c, &mut p),
            Err(IntentError::CannotUse),
            "nothing to repair"
        );

        // Iron gives 0.7 each: 10 ingots are 7 points.
        let iron = c.item("iron_ingot").unwrap().id;
        assert_eq!(smelting_xp(&c, iron, 10, 0.99), 7);
        assert_eq!(smelting_xp(&c, iron, 1, 0.5), 1);
        assert_eq!(smelting_xp(&c, iron, 1, 0.9), 0);
    }
}
