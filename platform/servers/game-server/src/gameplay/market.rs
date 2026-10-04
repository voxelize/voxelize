//! The market as the game server sees it: taking goods from a seller's
//! inventory into a listing, and handing deliveries over.
//!
//! Custody is never ambiguous. Listing removes the goods and records an
//! outbox entry in the same atomic player-record save; the entry leaves
//! the record only when the backend confirms the listing (the goods are
//! then in the backend's custody) or refuses it (the goods come back). A
//! delivery is applied by adding the goods and remembering its id in that
//! same record, and only then acknowledged; a delivery seen again is just
//! acknowledged again.

use std::collections::{HashSet, VecDeque};

use platform_ticket::Realm;
use serde::Deserialize;
use serde_json::json;
use voxelize::{ClientFilter, Event, PositionComp, World};

use super::bridge::{OutboxEntry, Request, Response};
use super::containers::{Container, StallSale};
use super::inventory::Stack;
use super::rules::{IntentError, PlayerState, Rules};
use super::{
    now_ms, parse, persist, reply, send_inventory, with_player, Gameplay, INVENTORY_EVENT,
};

/// Market notices for one player: `{ "listed" | "rejected" | "received" | "waiting": {...} }`.
pub const MARKET_EVENT: &str = "platform.market";
/// How many delivered ids a player record remembers.
pub const DELIVERED_MEMORY: usize = 256;
pub const MAX_PRICE: u64 = 1_000_000_000;
pub const MAX_HOURS: u32 = 168;
/// Seconds between delivery checks for the players in a world.
const POLL_SECONDS: f32 = 3.0;
/// Seconds before a listing that failed in transit is sent again.
const RETRY_SECONDS: f32 = 5.0;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct MarketState {
    /// Listings not yet confirmed by the backend (saved with the record).
    pub outbox: Vec<OutboxEntry>,
    /// Ids of deliveries already applied (saved with the record).
    pub delivered: VecDeque<String>,
    in_flight: HashSet<String>,
    retry_in: f32,
    told_full: HashSet<String>,
}

impl MarketState {
    pub fn restore(outbox: Vec<OutboxEntry>, delivered: Vec<String>) -> Self {
        Self {
            outbox,
            delivered: delivered.into(),
            ..Default::default()
        }
    }

    pub fn remember(&mut self, delivery: &str) {
        self.delivered.push_back(delivery.to_owned());
        while self.delivered.len() > DELIVERED_MEMORY {
            self.delivered.pop_front();
        }
    }
}

fn fixed() -> String {
    "fixed".to_owned()
}

fn default_hours() -> u32 {
    48
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListPayload {
    pub slot: usize,
    pub count: u32,
    pub price: u64,
    #[serde(default = "fixed")]
    pub kind: String,
    #[serde(default)]
    pub buyout: Option<u64>,
    #[serde(default = "default_hours")]
    pub hours: u32,
}

/// Take goods from a slot into a new outbox entry `id`. Creative goods
/// never enter the survival economy.
pub fn list(
    rules: &Rules,
    player: &mut PlayerState,
    p: &ListPayload,
    id: String,
) -> Result<OutboxEntry, IntentError> {
    if player.vitals.is_dead() {
        return Err(IntentError::Dead);
    }
    if player.realm != Realm::Survival {
        return Err(IntentError::SurvivalOnly);
    }
    let valid = matches!(p.kind.as_str(), "fixed" | "auction")
        && (1..=MAX_PRICE).contains(&p.price)
        && (1..=MAX_HOURS).contains(&p.hours)
        && match (p.kind.as_str(), p.buyout) {
            ("fixed", Some(_)) => false,
            (_, Some(b)) => b > p.price && b <= MAX_PRICE,
            _ => true,
        };
    if !valid {
        return Err(IntentError::BadListing);
    }
    let stack = player
        .inventory
        .get(p.slot)
        .cloned()
        .ok_or(IntentError::Inventory(
            super::inventory::InventoryError::EmptySlot,
        ))?;
    let item = rules
        .content()
        .item_by_id(stack.item)
        .ok_or(IntentError::BadListing)?
        .key
        .clone();
    let taken = player.inventory.take(p.slot, p.count)?;
    let entry = OutboxEntry {
        id,
        item,
        count: taken.count,
        durability: taken.durability,
        kind: p.kind.clone(),
        price: p.price,
        buyout: p.buyout,
        hours: p.hours,
        contract: None,
    };
    player.market.outbox.push(entry.clone());
    Ok(entry)
}

/// Hand `count` from a slot over to fulfil contract `contract` (the backend
/// checks the item, count and that this player took the contract).
pub fn deliver(
    rules: &Rules,
    player: &mut PlayerState,
    slot: usize,
    count: u32,
    contract: &str,
    id: String,
) -> Result<OutboxEntry, IntentError> {
    if player.vitals.is_dead() {
        return Err(IntentError::Dead);
    }
    if player.realm != Realm::Survival {
        return Err(IntentError::SurvivalOnly);
    }
    if contract.is_empty()
        || contract.len() > 40
        || !contract.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err(IntentError::BadListing);
    }
    let stack = player
        .inventory
        .get(slot)
        .cloned()
        .ok_or(IntentError::Inventory(
            super::inventory::InventoryError::EmptySlot,
        ))?;
    let item = rules
        .content()
        .item_by_id(stack.item)
        .ok_or(IntentError::BadListing)?
        .key
        .clone();
    let taken = player.inventory.take(slot, count)?;
    let entry = OutboxEntry {
        id,
        item,
        count: taken.count,
        durability: taken.durability,
        kind: "contract".into(),
        price: 0,
        buyout: None,
        hours: 0,
        contract: Some(contract.to_owned()),
    };
    player.market.outbox.push(entry.clone());
    Ok(entry)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeliverPayload {
    pub contract: String,
    pub slot: usize,
    pub count: u32,
}

pub fn install(world: &mut World) {
    world.set_method_handle("platform.contract.deliver", |world, client_id, payload| {
        const INTENT: &str = "contract.deliver";
        let Some(p) = parse::<DeliverPayload>(world, client_id, INTENT, payload) else {
            return;
        };
        let result = with_player(world, client_id, |g, _, _| {
            if g.dimensions.bridge.is_none() {
                return Err(IntentError::MarketUnavailable);
            }
            let id = format!(
                "c{:x}{:012x}",
                now_ms(),
                (g.random() * 2f64.powi(48)) as u64
            );
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            deliver(rules, player, p.slot, p.count, &p.contract, id)
        });
        match result {
            None => super::not_joined(world, client_id, INTENT),
            Some(Ok(entry)) => {
                persist(world, client_id);
                reply(
                    world,
                    client_id,
                    INTENT,
                    Ok(json!({ "entry": entry.id, "contract": p.contract })),
                );
                send_inventory(world, client_id);
            }
            Some(Err(e)) => reply(world, client_id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.market.list", |world, client_id, payload| {
        const INTENT: &str = "market.list";
        let Some(p) = parse::<ListPayload>(world, client_id, INTENT, payload) else {
            return;
        };
        let result = with_player(world, client_id, |g, _, _| {
            if g.dimensions.bridge.is_none() {
                return Err(IntentError::MarketUnavailable);
            }
            let id = format!(
                "o{:x}{:012x}",
                now_ms(),
                (g.random() * 2f64.powi(48)) as u64
            );
            let Gameplay { rules, players, .. } = g;
            let player = players.get_mut(client_id).expect("checked by with_player");
            list(rules, player, &p, id)
        });
        match result {
            None => super::not_joined(world, client_id, INTENT),
            Some(Ok(entry)) => {
                // Goods out of the inventory and into the outbox in one save.
                persist(world, client_id);
                reply(
                    world,
                    client_id,
                    INTENT,
                    Ok(json!({ "entry": entry.id, "item": entry.item, "count": entry.count })),
                );
                send_inventory(world, client_id);
            }
            Some(Err(e)) => reply(world, client_id, INTENT, Err(e)),
        }
    });
}

/// Sends outbox entries, asks for deliveries, applies what comes back.
#[derive(Default)]
pub struct MarketSystem {
    last: Option<std::time::Instant>,
    since_poll: f32,
    polling: bool,
    /// Stall sale payments sent and not yet answered.
    payments_in_flight: HashSet<String>,
    payment_retry: f32,
}

impl<'a> specs::System<'a> for MarketSystem {
    type SystemData = (
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
        specs::WriteExpect<'a, voxelize::Chunks>,
        specs::ReadExpect<'a, voxelize::WorldConfig>,
    );

    fn run(
        &mut self,
        (clients, positions, mut g, mut events, mut chunks, config): Self::SystemData,
    ) {
        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0)
            .min(0.5);
        self.last = Some(now);
        let Some(bridge) = g.dimensions.bridge.clone() else {
            return;
        };
        let Some(world) = g
            .dimensions
            .world_of(g.dimensions.current)
            .map(str::to_owned)
        else {
            return;
        };
        let content = g.rules.content_arc();
        let position_of = |id: &str| {
            clients
                .get(id)
                .and_then(|c| positions.get(c.entity))
                .map(|p| [p.0 .0, p.0 .1, p.0 .2])
        };
        let notify = |events: &mut voxelize::Events, id: &str, payload: serde_json::Value| {
            events.dispatch(
                Event::new(MARKET_EVENT)
                    .payload(payload)
                    .filter(ClientFilter::Direct(id.to_owned()))
                    .build(),
            );
        };
        let inventory_of = |events: &mut voxelize::Events, id: &str, player: &PlayerState| {
            events.dispatch(
                Event::new(INVENTORY_EVENT)
                    .payload(json!({ "slots": player.inventory.slots, "selected": player.inventory.selected, "realm": player.realm }))
                    .filter(ClientFilter::Direct(id.to_owned()))
                    .build(),
            );
        };

        let mut stalls_changed = false;
        for response in bridge.take(&world) {
            let Gameplay {
                players,
                store,
                drops,
                ..
            } = &mut *g;
            // Players who left are answered when they next join: every
            // request is idempotent, so their outbox is simply sent again.
            let online = |player: &str| clients.get(player).is_some();
            match response {
                Response::Listed {
                    player: id,
                    entry,
                    listing,
                } => {
                    let Some(player) = players
                        .get_mut(&id)
                        .filter(|p| !p.travel.departed && online(&id))
                    else {
                        continue;
                    };
                    let Some(done) = player.market.outbox.iter().position(|e| e.id == entry) else {
                        continue;
                    };
                    let done = player.market.outbox.remove(done);
                    player.market.in_flight.remove(&entry);
                    save(store, &id, player, position_of(&id));
                    let notice = if done.contract.is_some() {
                        json!({ "fulfilled": { "contract": listing, "item": done.item, "count": done.count } })
                    } else {
                        json!({ "listed": { "listing": listing, "item": done.item, "count": done.count, "kind": done.kind, "price": done.price } })
                    };
                    notify(&mut events, &id, notice);
                }
                Response::Rejected {
                    player: id,
                    entry,
                    code,
                } => {
                    let Some(player) = players
                        .get_mut(&id)
                        .filter(|p| !p.travel.departed && online(&id))
                    else {
                        continue;
                    };
                    let Some(done) = player.market.outbox.iter().position(|e| e.id == entry) else {
                        continue;
                    };
                    let done = player.market.outbox.remove(done);
                    player.market.in_flight.remove(&entry);
                    if let Some(item) = content.item(&done.item) {
                        let stack = Stack {
                            item: item.id,
                            count: done.count,
                            durability: done.durability,
                        };
                        if let Some(left) = player.inventory.add_stack(&content, stack) {
                            let p = position_of(&id).unwrap_or([0.0, 80.0, 0.0]);
                            drops.spawn(left, [p[0], p[1] - 1.0, p[2]], [0.0, 2.0, 0.0], None);
                        }
                    }
                    save(store, &id, player, position_of(&id));
                    inventory_of(&mut events, &id, player);
                    notify(
                        &mut events,
                        &id,
                        json!({ "rejected": { "code": code, "item": done.item, "count": done.count } }),
                    );
                }
                Response::ListingFailed { player: id, entry } => {
                    if let Some(player) = players.get_mut(&id) {
                        player.market.in_flight.remove(&entry);
                        player.market.retry_in = RETRY_SECONDS;
                    }
                }
                Response::Deliveries(deliveries) => {
                    self.polling = false;
                    for d in deliveries {
                        let Some(player) = players
                            .get_mut(&d.player)
                            .filter(|p| !p.travel.departed && online(&d.player))
                        else {
                            continue;
                        };
                        if player.market.delivered.contains(&d.id) {
                            bridge.request(Request::Acknowledge {
                                world: world.clone(),
                                delivery: d.id,
                            });
                            continue;
                        }
                        let Some(item) = content.item(&d.item) else {
                            log::warn!(
                                "delivery {} names unknown item {:?}; left pending",
                                d.id,
                                d.item
                            );
                            continue;
                        };
                        let stack = Stack {
                            item: item.id,
                            count: d.count,
                            durability: d.durability,
                        };
                        if !player.inventory.fits(&content, &stack) {
                            if player.market.told_full.insert(d.id.clone()) {
                                notify(
                                    &mut events,
                                    &d.player,
                                    json!({ "waiting": { "item": d.item, "count": d.count } }),
                                );
                            }
                            continue;
                        }
                        let _ = player.inventory.add_stack(&content, stack);
                        player.market.remember(&d.id);
                        player.market.told_full.remove(&d.id);
                        // Applied and remembered in one save before the ack.
                        save(store, &d.player, player, position_of(&d.player));
                        bridge.request(Request::Acknowledge {
                            world: world.clone(),
                            delivery: d.id.clone(),
                        });
                        inventory_of(&mut events, &d.player, player);
                        notify(
                            &mut events,
                            &d.player,
                            json!({ "received": { "item": d.item, "count": d.count, "reason": d.reason } }),
                        );
                    }
                }
                Response::DeliveriesFailed => self.polling = false,
                Response::Acknowledged { .. } | Response::AcknowledgeFailed { .. } => {}
                Response::Paid { key } if g.trades.open.iter().any(|t| t.id == key) => {
                    self.payments_in_flight.remove(&key);
                    if let Some(trade) = super::trade::on_paid(&mut g, &key) {
                        for side in &trade.sides {
                            if clients.get(&side.player).is_some() {
                                events.dispatch(
                                    Event::new(super::trade::TRADE_EVENT)
                                        .payload(json!({ "trade": null, "ended": "done" }))
                                        .filter(ClientFilter::Direct(side.player.clone()))
                                        .build(),
                                );
                            }
                        }
                    }
                }
                Response::PaymentRefused { key, code }
                    if g.trades.open.iter().any(|t| t.id == key) =>
                {
                    self.payments_in_flight.remove(&key);
                    if let Some(trade) = super::trade::on_refused(&mut g, &key) {
                        for side in &trade.sides {
                            if clients.get(&side.player).is_some() {
                                let mut view = super::trade::view(&trade, &side.player, &content);
                                view["refused"] = json!(code);
                                events.dispatch(
                                    Event::new(super::trade::TRADE_EVENT)
                                        .payload(view)
                                        .filter(ClientFilter::Direct(side.player.clone()))
                                        .build(),
                                );
                            }
                        }
                    }
                }
                Response::Paid { key } => {
                    self.payments_in_flight.remove(&key);
                    let sale = g.containers.map.values_mut().find_map(|c| match c {
                        Container::Stall(stall) => stall.sales.iter_mut().find(|s| s.key == key),
                        _ => None,
                    });
                    if let Some(sale) = sale {
                        sale.paid = true;
                        stalls_changed = true;
                    }
                }
                Response::PaymentRefused { key, code } => {
                    self.payments_in_flight.remove(&key);
                    let Gameplay {
                        containers, drops, ..
                    } = &mut *g;
                    for (at, container) in containers.map.iter_mut() {
                        let Container::Stall(stall) = container else {
                            continue;
                        };
                        let Some(i) = stall.sales.iter().position(|s| s.key == key && !s.paid)
                        else {
                            continue;
                        };
                        let sale = stall.sales.remove(i);
                        if let Some(left) = stall.restock(sale.slot, sale.stack.clone()) {
                            let p = [at[0] as f32 + 0.5, at[1] as f32 + 1.2, at[2] as f32 + 0.5];
                            drops.spawn(left, p, [0.0, 2.0, 0.0], None);
                        }
                        stalls_changed = true;
                        if clients.get(&sale.buyer).is_some() {
                            let item = content.item_by_id(sale.stack.item).map(|i| i.key.clone());
                            notify(
                                &mut events,
                                &sale.buyer,
                                json!({ "refused": { "code": code, "item": item, "count": sale.stack.count, "price": sale.price } }),
                            );
                        }
                        break;
                    }
                }
                Response::BlueprintStored { player, id, blocks } => {
                    if clients.get(&player).is_some() {
                        notify(
                            &mut events,
                            &player,
                            json!({ "blueprint": { "stored": id, "blocks": blocks } }),
                        );
                    }
                }
                Response::BlueprintRefused { player, code } => {
                    if clients.get(&player).is_some() {
                        notify(
                            &mut events,
                            &player,
                            json!({ "blueprint": { "refused": code } }),
                        );
                    }
                }
                Response::Captured { key, outcome } => {
                    super::guild_api::on_captured(&mut g, &mut chunks, &mut events, &key, outcome);
                }
                Response::WarKill {
                    killer,
                    victim,
                    counted,
                } => {
                    if counted && clients.get(&killer).is_some() {
                        notify(
                            &mut events,
                            &killer,
                            json!({ "war_kill": { "victim": victim } }),
                        );
                    }
                }
                Response::BlueprintLayout {
                    player,
                    id,
                    at,
                    layout,
                } => {
                    if clients.get(&player).is_none() {
                        continue;
                    }
                    let built =
                        super::blueprint::decode(&content, &layout).and_then(|(cells, size)| {
                            let players: Vec<[f32; 3]> = clients
                                .values()
                                .filter_map(|c| {
                                    positions.get(c.entity).map(|p| [p.0 .0, p.0 .1, p.0 .2])
                                })
                                .collect();
                            let view = super::EngineView {
                                chunks: &chunks,
                                chunk_size: config.chunk_size,
                                max_height: config.max_height as i32,
                                players,
                            };
                            super::blueprint::plan_build(&mut g, &player, &view, at, &cells, size)
                        });
                    match built {
                        Ok(writes) => {
                            let count = writes.len();
                            let writes: Vec<(voxelize::Vec3<i32>, u32)> = writes
                                .into_iter()
                                .map(|([x, y, z], raw)| (voxelize::Vec3(x, y, z), raw))
                                .collect();
                            chunks.update_voxels(&writes);
                            let Gameplay { players, store, .. } = &mut *g;
                            if let Some(p) = players.get(&player) {
                                save(store, &player, p, position_of(&player));
                                inventory_of(&mut events, &player, p);
                            }
                            notify(
                                &mut events,
                                &player,
                                json!({ "blueprint": { "built": id, "blocks": count } }),
                            );
                        }
                        Err(e) => notify(
                            &mut events,
                            &player,
                            json!({ "blueprint": { "refused": e.code() } }),
                        ),
                    }
                }
                Response::PaymentFailed { key } => {
                    self.payments_in_flight.remove(&key);
                    self.payment_retry = RETRY_SECONDS;
                }
            }
        }

        // Paid stall sales: hand the goods to their buyer (once: the key is
        // remembered with the buyer's inventory).
        let paid: Vec<([i32; 3], StallSale, String)> = g
            .containers
            .map
            .iter()
            .filter_map(|(at, c)| match c {
                Container::Stall(stall) => Some((*at, stall)),
                _ => None,
            })
            .flat_map(|(at, stall)| {
                stall
                    .sales
                    .iter()
                    .filter(|s| s.paid)
                    .map(move |s| (at, s.clone(), stall.owner.clone()))
            })
            .collect();
        for (at, sale, owner) in paid {
            let Gameplay {
                players,
                store,
                drops,
                containers,
                ..
            } = &mut *g;
            let Some(buyer) = players
                .get_mut(&sale.buyer)
                .filter(|p| !p.travel.departed && clients.get(&sale.buyer).is_some())
            else {
                continue;
            };
            if !buyer.market.delivered.contains(&sale.key) {
                if let Some(left) = buyer.inventory.add_stack(&content, sale.stack.clone()) {
                    let p = position_of(&sale.buyer).unwrap_or([
                        at[0] as f32,
                        at[1] as f32 + 1.0,
                        at[2] as f32,
                    ]);
                    drops.spawn(left, [p[0], p[1] - 1.0, p[2]], [0.0, 2.0, 0.0], None);
                }
                buyer.market.remember(&sale.key);
                save(store, &sale.buyer, buyer, position_of(&sale.buyer));
                inventory_of(&mut events, &sale.buyer, buyer);
                let item = content.item_by_id(sale.stack.item).map(|i| i.key.clone());
                notify(
                    &mut events,
                    &sale.buyer,
                    json!({ "bought": { "item": item, "count": sale.stack.count, "price": sale.price } }),
                );
                if clients.get(&owner).is_some() {
                    notify(
                        &mut events,
                        &owner,
                        json!({ "sold": { "item": item, "count": sale.stack.count, "price": sale.price } }),
                    );
                }
            }
            if let Some(Container::Stall(stall)) = containers.map.get_mut(&at) {
                stall.sales.retain(|s| s.key != sale.key);
            }
            stalls_changed = true;
        }

        // Unanswered stall and trade payments are asked again (idempotent by key).
        self.payment_retry = (self.payment_retry - dt).max(0.0);
        if self.payment_retry == 0.0 {
            for trade in g.trades.open.iter().filter(|t| t.paying) {
                if let Some((payer, amount)) = super::trade::net(trade) {
                    if self.payments_in_flight.insert(trade.id.clone()) {
                        bridge.request(Request::Payment {
                            world: world.clone(),
                            key: trade.id.clone(),
                            from: trade.sides[payer].player.clone(),
                            to: trade.sides[1 - payer].player.clone(),
                            amount,
                            reason: format!("Trade with {}", trade.sides[1 - payer].name),
                            kind: "trade",
                            land_guild: None,
                        });
                    }
                }
            }
            let dimension = g.dimensions.current;
            let land = g.dimensions.land.clone();
            for (at, c) in g.containers.map.iter() {
                let Container::Stall(stall) = c else {
                    continue;
                };
                let land_guild = super::stall::land_guild(&land, dimension, *at);
                for sale in stall.sales.iter().filter(|s| !s.paid) {
                    if self.payments_in_flight.insert(sale.key.clone()) {
                        let name = content
                            .item_by_id(sale.stack.item)
                            .map(|i| i.name.clone())
                            .unwrap_or_default();
                        bridge.request(Request::Payment {
                            world: world.clone(),
                            key: sale.key.clone(),
                            from: sale.buyer.clone(),
                            to: stall.owner.clone(),
                            amount: sale.price,
                            reason: format!("Stall: {} {name}", sale.stack.count),
                            kind: sale.payment_kind(),
                            land_guild: land_guild.clone(),
                        });
                    }
                }
            }
        }
        if stalls_changed {
            let dir = g.world_dir.clone();
            if let Err(e) = g.containers.save(&dir) {
                log::error!("could not save containers: {e}");
            }
        }

        // Send what waits, ask for deliveries now and then.
        let mut online = Vec::new();
        for (id, _) in clients.iter() {
            let Some(player) = g.players.get_mut(id) else {
                continue;
            };
            if player.travel.departed {
                continue;
            }
            online.push(id.clone());
            player.market.retry_in = (player.market.retry_in - dt).max(0.0);
            if player.market.retry_in > 0.0 {
                continue;
            }
            for entry in &player.market.outbox {
                if player.market.in_flight.insert(entry.id.clone()) {
                    bridge.request(Request::CreateListing {
                        world: world.clone(),
                        player: id.clone(),
                        entry: entry.clone(),
                    });
                }
            }
        }
        self.since_poll += dt;
        // A lost answer must not stop polling for good.
        if self.polling && self.since_poll > 30.0 {
            self.polling = false;
        }
        if !self.polling && self.since_poll >= POLL_SECONDS && !online.is_empty() {
            self.since_poll = 0.0;
            self.polling = true;
            bridge.request(Request::PendingDeliveries {
                world,
                players: online,
            });
        }
    }
}

fn save(
    store: &super::store::PlayerStore,
    id: &str,
    player: &PlayerState,
    position: Option<[f32; 3]>,
) {
    if player.travel.departed {
        return;
    }
    if let Err(e) = store.save(&store.record(id, player, position)) {
        log::error!("could not save player {id}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::inventory::Inventory;
    use crate::gameplay::survival::Vitals;
    use platform_content::Content;
    use std::sync::Arc;

    fn setup(realm: Realm) -> (Rules, PlayerState) {
        let content = Arc::new(Content::load(platform_content::default_pack_dir()).unwrap());
        let rules = Rules::new(content.clone());
        let mut player = PlayerState::new(Inventory::default(), realm, Vitals::default());
        player
            .inventory
            .add(&content, content.item("iron_ingot").unwrap().id, 10);
        (rules, player)
    }

    fn payload(count: u32, price: u64) -> ListPayload {
        ListPayload {
            slot: 0,
            count,
            price,
            kind: "fixed".into(),
            buyout: None,
            hours: 48,
        }
    }

    #[test]
    fn listing_moves_goods_from_the_inventory_into_the_outbox() {
        let (rules, mut player) = setup(Realm::Survival);
        let entry = list(&rules, &mut player, &payload(4, 120), "o1".into()).unwrap();
        assert_eq!(
            (entry.item.as_str(), entry.count, entry.price),
            ("iron_ingot", 4, 120)
        );
        assert_eq!(player.inventory.get(0).unwrap().count, 6);
        assert_eq!(player.market.outbox, vec![entry]);

        assert_eq!(
            list(&rules, &mut player, &payload(7, 1), "o2".into()),
            Err(IntentError::Inventory(
                super::super::inventory::InventoryError::BadCount
            ))
        );
        assert_eq!(
            list(&rules, &mut player, &payload(1, 0), "o3".into()),
            Err(IntentError::BadListing)
        );
        let mut auction = payload(1, 10);
        auction.kind = "auction".into();
        auction.buyout = Some(5);
        assert_eq!(
            list(&rules, &mut player, &auction, "o4".into()),
            Err(IntentError::BadListing)
        );
        auction.buyout = Some(50);
        assert!(list(&rules, &mut player, &auction, "o5".into()).is_ok());
        let mut fixed_buyout = payload(1, 10);
        fixed_buyout.buyout = Some(50);
        assert_eq!(
            list(&rules, &mut player, &fixed_buyout, "o6".into()),
            Err(IntentError::BadListing)
        );
        assert_eq!(player.market.outbox.len(), 2, "refusals take nothing");
        assert_eq!(player.inventory.get(0).unwrap().count, 5);
    }

    #[test]
    fn contract_deliveries_go_through_the_outbox() {
        let (rules, mut player) = setup(Realm::Survival);
        let entry = deliver(&rules, &mut player, 0, 4, "01ABC", "c1".into()).unwrap();
        assert_eq!(entry.contract.as_deref(), Some("01ABC"));
        assert_eq!(player.inventory.get(0).unwrap().count, 6);
        assert_eq!(player.market.outbox.len(), 1);
        assert_eq!(
            deliver(&rules, &mut player, 0, 4, "../x", "c2".into()),
            Err(IntentError::BadListing)
        );
        let (rules, mut creative) = setup(Realm::Creative);
        assert_eq!(
            deliver(&rules, &mut creative, 0, 1, "01ABC", "c3".into()),
            Err(IntentError::SurvivalOnly)
        );
    }

    #[test]
    fn creative_goods_never_reach_the_market() {
        let (rules, mut player) = setup(Realm::Creative);
        assert_eq!(
            list(&rules, &mut player, &payload(1, 5), "o1".into()),
            Err(IntentError::SurvivalOnly)
        );
        assert_eq!(player.inventory.get(0).unwrap().count, 10);
    }

    #[test]
    fn delivered_ids_are_remembered_up_to_a_limit() {
        let mut m = MarketState::default();
        for i in 0..(DELIVERED_MEMORY + 5) {
            m.remember(&format!("d{i}"));
        }
        assert_eq!(m.delivered.len(), DELIVERED_MEMORY);
        assert!(!m.delivered.contains(&"d0".to_owned()));
        assert!(m.delivered.contains(&format!("d{}", DELIVERED_MEMORY + 4)));
    }
}
