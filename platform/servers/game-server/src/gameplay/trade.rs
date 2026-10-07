//! The direct trade window between two players standing near each other.
//!
//! Custody: offering moves items from a player's inventory into their
//! *hold*, saved in the same player record (one atomic write); the trade
//! file keeps the session and a copy of both offers. When both confirm,
//! Crowns move first (one ledger transfer for the difference, no fee, by
//! the trade's key), then each player's outcome is applied to their own
//! record exactly once (their key is remembered with the inventory):
//! clear the hold and receive the other side's items. A cancelled trade
//! gives each player their hold back. Outcomes wait for their player to be
//! online in this world, so no record is ever written by two worlds.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use platform_content::Content;
use platform_ticket::Realm;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specs::WorldExt;
use voxelize::{ClientFilter, Event, World};

use super::inventory::{Inventory, Stack};
use super::rules::{IntentError, PlayerState};
use super::{client_position, now_ms, parse, persist, reply, send_inventory, Gameplay};

pub const TRADE_EVENT: &str = "platform.trade";
/// Players trade within this many blocks of each other.
pub const TRADE_DISTANCE: f32 = 8.0;
/// A trade is cancelled when its players drift this far apart.
pub const BREAK_DISTANCE: f32 = 16.0;
/// Seconds an invitation stays valid.
pub const INVITE_SECONDS: f32 = 30.0;
pub const MAX_CROWNS: u64 = 1_000_000_000;
pub const MAX_STACKS: usize = 9;

/// A player's own offered items, saved with their record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hold {
    pub trade: String,
    pub items: Vec<Stack>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Side {
    pub player: String,
    #[serde(default)]
    pub name: String,
    pub items: Vec<Stack>,
    pub crowns: u64,
    pub confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub sides: [Side; 2],
    /// Set while the Crowns are being moved.
    #[serde(default)]
    pub paying: bool,
}

/// What a player is owed when a trade ends.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Outcome {
    pub player: String,
    pub trade: String,
    /// The other side's items when done; empty when cancelled (the player
    /// gets back the hold saved in their own record).
    pub receive: Vec<Stack>,
    pub done: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Trades {
    pub open: Vec<Trade>,
    pub outcomes: Vec<Outcome>,
    /// Invitations, target -> (inviter, seconds left). Not saved.
    #[serde(skip)]
    pub invites: HashMap<String, (String, f32)>,
}

fn file(dir: &Path) -> PathBuf {
    dir.join("trades.json")
}

impl Trades {
    /// Load, cancelling trades that were not paying when the server
    /// stopped (paying ones are settled when the payment answers again).
    pub fn load(dir: &Path) -> Result<Self, String> {
        let path = file(dir);
        let mut trades: Trades = match std::fs::read(&path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display()))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Trades::default(),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        let stale: Vec<String> = trades
            .open
            .iter()
            .filter(|t| !t.paying)
            .map(|t| t.id.clone())
            .collect();
        for id in stale {
            trades.cancel(&id);
        }
        Ok(trades)
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let path = file(dir);
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(self).expect("trades serialize"))?;
        std::fs::rename(tmp, path)
    }

    pub fn of(&self, player: &str) -> Option<&Trade> {
        self.open
            .iter()
            .find(|t| t.sides.iter().any(|s| s.player == player))
    }

    pub fn of_mut(&mut self, player: &str) -> Option<&mut Trade> {
        self.open
            .iter_mut()
            .find(|t| t.sides.iter().any(|s| s.player == player))
    }

    /// End a trade without exchange: everyone gets their own items back.
    pub fn cancel(&mut self, id: &str) -> Option<Trade> {
        let i = self.open.iter().position(|t| t.id == id)?;
        let trade = self.open.remove(i);
        for side in &trade.sides {
            self.outcomes.push(Outcome {
                player: side.player.clone(),
                trade: trade.id.clone(),
                receive: Vec::new(),
                done: false,
            });
        }
        Some(trade)
    }

    /// Complete a trade: each side receives the other's items.
    pub fn complete(&mut self, id: &str) -> Option<Trade> {
        let i = self.open.iter().position(|t| t.id == id)?;
        let trade = self.open.remove(i);
        for (me, other) in [(0, 1), (1, 0)] {
            self.outcomes.push(Outcome {
                player: trade.sides[me].player.clone(),
                trade: trade.id.clone(),
                receive: trade.sides[other].items.clone(),
                done: true,
            });
        }
        Some(trade)
    }
}

/// Who pays whom, if anyone: `(payer side, amount)`.
pub fn net(trade: &Trade) -> Option<(usize, u64)> {
    let (a, b) = (trade.sides[0].crowns, trade.sides[1].crowns);
    match a.cmp(&b) {
        std::cmp::Ordering::Greater => Some((0, a - b)),
        std::cmp::Ordering::Less => Some((1, b - a)),
        std::cmp::Ordering::Equal => None,
    }
}

/// Change a player's offer: `picks` are added to what they already offer
/// (with `reset`, the old offer first goes back into the inventory), and
/// the Crowns are set. Nothing changes on refusal. Every change clears both
/// confirmations.
pub fn offer(
    content: &Content,
    trade: &mut Trade,
    player: &mut PlayerState,
    me: usize,
    picks: &[(usize, u32)],
    crowns: u64,
    reset: bool,
) -> Result<(), IntentError> {
    if trade.paying {
        return Err(IntentError::Busy);
    }
    if crowns > MAX_CROWNS || picks.len() > MAX_STACKS {
        return Err(IntentError::BadListing);
    }
    let mut inventory: Inventory = player.inventory.clone();
    let mut items = Vec::new();
    if reset {
        for stack in &trade.sides[me].items {
            if inventory.add_stack(content, stack.clone()).is_some() {
                return Err(IntentError::InventoryFull);
            }
        }
    } else {
        items = trade.sides[me].items.clone();
    }
    if items.len() + picks.len() > MAX_STACKS {
        return Err(IntentError::BadListing);
    }
    for &(slot, count) in picks {
        items.push(inventory.take(slot, count)?);
    }
    player.inventory = inventory;
    player.trade_hold = Some(Hold {
        trade: trade.id.clone(),
        items: items.clone(),
    });
    trade.sides[me].items = items;
    trade.sides[me].crowns = crowns;
    for side in trade.sides.iter_mut() {
        side.confirmed = false;
    }
    Ok(())
}

/// Apply an outcome to its player (once: the trade key is remembered with
/// their inventory). Leftovers that do not fit are returned to drop.
pub fn apply(content: &Content, player: &mut PlayerState, outcome: &Outcome) -> Vec<Stack> {
    let key = format!("trade:{}", outcome.trade);
    if player.market.delivered.contains(&key) {
        return Vec::new();
    }
    let hold = match player.trade_hold.take() {
        Some(h) if h.trade == outcome.trade => Some(h),
        other => {
            player.trade_hold = other;
            None
        }
    };
    // Done: the other side's goods. Cancelled: your own hold, as saved
    // with your inventory.
    let receive = if outcome.done {
        outcome.receive.clone()
    } else {
        hold.map(|h| h.items).unwrap_or_default()
    };
    let mut left = Vec::new();
    for stack in &receive {
        if let Some(rest) = player.inventory.add_stack(content, stack.clone()) {
            left.push(rest);
        }
    }
    player.market.remember(&key);
    left
}

/// The window state for one side of a trade.
pub fn view(trade: &Trade, player: &str, content: &Content) -> Value {
    let me = if trade.sides[0].player == player {
        0
    } else {
        1
    };
    let side = |s: &Side| {
        json!({
            "name": s.name,
            "items": s.items.iter().map(|i| json!({ "item": content.item_by_id(i.item).map(|d| d.key.clone()), "count": i.count })).collect::<Vec<_>>(),
            "crowns": s.crowns,
            "confirmed": s.confirmed,
        })
    };
    json!({ "trade": { "id": trade.id, "mine": side(&trade.sides[me]), "theirs": side(&trade.sides[1 - me]), "paying": trade.paying } })
}

pub(super) fn send(world: &mut World, player: &str, payload: Value) {
    world.events_mut().dispatch(
        Event::new(TRADE_EVENT)
            .payload(payload)
            .filter(ClientFilter::Direct(player.to_owned()))
            .build(),
    );
}

fn send_views(world: &mut World, trade_id: &str) {
    let views: Vec<(String, Value)> = {
        let g = world.ecs().read_resource::<Gameplay>();
        let Some(trade) = g.trades.open.iter().find(|t| t.id == trade_id) else {
            return;
        };
        trade
            .sides
            .iter()
            .map(|s| (s.player.clone(), view(trade, &s.player, g.rules.content())))
            .collect()
    };
    for (player, v) in views {
        send(world, &player, v);
    }
}

fn save_trades(g: &Gameplay) {
    if let Err(e) = g.trades.save(&g.world_dir) {
        log::error!("could not save trades: {e}");
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WithPayload {
    player: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pick {
    slot: usize,
    count: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OfferPayload {
    #[serde(default)]
    items: Vec<Pick>,
    #[serde(default)]
    crowns: u64,
    /// Take the whole current offer back first.
    #[serde(default)]
    reset: bool,
}

fn eligible(g: &Gameplay, id: &str) -> Result<(), IntentError> {
    let player = g.players.get(id).ok_or(IntentError::NothingThere)?;
    if player.travel.departed || player.vitals.is_dead() {
        return Err(IntentError::Dead);
    }
    if player.realm != Realm::Survival {
        return Err(IntentError::SurvivalOnly);
    }
    if g.trades.of(id).is_some() {
        return Err(IntentError::Busy);
    }
    Ok(())
}

fn near(world: &World, a: &str, b: &str, limit: f32) -> bool {
    match (client_position(world, a), client_position(world, b)) {
        (Some(p), Some(q)) => (0..3).map(|i| (p[i] - q[i]).powi(2)).sum::<f32>() <= limit * limit,
        _ => false,
    }
}

pub fn install(world: &mut World) {
    world.set_method_handle("platform.trade.request", |world, id, payload| {
        const INTENT: &str = "trade.request";
        let Some(p) = parse::<WithPayload>(world, id, INTENT, payload) else {
            return;
        };
        let close = near(world, id, &p.player, TRADE_DISTANCE);
        let name = world
            .clients()
            .get(id)
            .map(|c| c.username.clone())
            .unwrap_or_default();
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            if g.dimensions.bridge.is_none() {
                Err(IntentError::MarketUnavailable)
            } else if p.player == id {
                Err(IntentError::BadListing)
            } else if !close {
                Err(IntentError::OutOfReach)
            } else {
                eligible(&g, id)
                    .and_then(|_| eligible(&g, &p.player))
                    .map(|_| {
                        g.trades
                            .invites
                            .insert(p.player.clone(), (id.to_owned(), INVITE_SECONDS));
                    })
            }
        };
        let ok = result.is_ok();
        reply(
            world,
            id,
            INTENT,
            result.map(|_| json!({ "invited": p.player })),
        );
        if ok {
            send(
                world,
                &p.player,
                json!({ "invite": { "from": id, "name": name } }),
            );
        }
    });

    world.set_method_handle("platform.trade.accept", |world, id, payload| {
        const INTENT: &str = "trade.accept";
        let Some(p) = parse::<WithPayload>(world, id, INTENT, payload) else {
            return;
        };
        let close = near(world, id, &p.player, TRADE_DISTANCE);
        let names = |who: &str| {
            world
                .clients()
                .get(who)
                .map(|c| c.username.clone())
                .unwrap_or_default()
        };
        let (mine, theirs) = (names(id), names(&p.player));
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            match g.trades.invites.get(id) {
                Some((from, _)) if *from == p.player => {
                    if !close {
                        Err(IntentError::OutOfReach)
                    } else {
                        eligible(&g, id)
                            .and_then(|_| eligible(&g, &p.player))
                            .map(|_| {
                                g.trades.invites.remove(id);
                                let trade_id = format!(
                                    "t{:x}{:012x}",
                                    now_ms(),
                                    (g.random() * 2f64.powi(48)) as u64
                                );
                                let side = |player: &str, name: String| Side {
                                    player: player.to_owned(),
                                    name,
                                    items: Vec::new(),
                                    crowns: 0,
                                    confirmed: false,
                                };
                                g.trades.open.push(Trade {
                                    id: trade_id.clone(),
                                    sides: [
                                        side(&p.player, theirs.clone()),
                                        side(id, mine.clone()),
                                    ],
                                    paying: false,
                                });
                                save_trades(&g);
                                trade_id
                            })
                    }
                }
                _ => Err(IntentError::NothingThere),
            }
        };
        match result {
            Ok(trade) => {
                reply(world, id, INTENT, Ok(json!({ "trade": trade })));
                send_views(world, &trade);
            }
            Err(e) => reply(world, id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.trade.offer", |world, id, payload| {
        const INTENT: &str = "trade.offer";
        let Some(p) = parse::<OfferPayload>(world, id, INTENT, payload) else {
            return;
        };
        let picks: Vec<(usize, u32)> = p.items.iter().map(|x| (x.slot, x.count)).collect();
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let content = g.rules.content_arc();
            let Gameplay {
                trades, players, ..
            } = &mut *g;
            match (trades.of_mut(id), players.get_mut(id)) {
                (Some(trade), Some(player)) => {
                    let me = if trade.sides[0].player == id { 0 } else { 1 };
                    offer(&content, trade, player, me, &picks, p.crowns, p.reset)
                        .map(|_| trade.id.clone())
                }
                _ => Err(IntentError::NothingThere),
            }
        };
        match result {
            Ok(trade) => {
                // The record (inventory and hold together) first. The trade
                // file follows; a crash in between ends the trade unpaid,
                // and a cancel returns the hold from the record.
                persist(world, id);
                save_trades(&world.ecs().read_resource::<Gameplay>());
                reply(world, id, INTENT, Ok(json!({ "trade": trade })));
                send_inventory(world, id);
                send_views(world, &trade);
            }
            Err(e) => reply(world, id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.trade.confirm", |world, id, _| {
        const INTENT: &str = "trade.confirm";
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let world_name = g
                .dimensions
                .world_of(g.dimensions.current)
                .map(str::to_owned);
            let bridge = g.dimensions.bridge.clone();
            let outcome = match g.trades.of_mut(id) {
                None => Err(IntentError::NothingThere),
                Some(trade) if trade.paying => Err(IntentError::Busy),
                Some(trade) => {
                    let me = if trade.sides[0].player == id { 0 } else { 1 };
                    trade.sides[me].confirmed = true;
                    let both = trade.sides.iter().all(|s| s.confirmed);
                    Ok((
                        trade.id.clone(),
                        both,
                        both.then(|| net(trade)).flatten(),
                        trade.clone(),
                    ))
                }
            };
            match outcome {
                Ok((trade_id, both, pay, trade)) => {
                    let mut unavailable = false;
                    match (both, pay, bridge, world_name) {
                        (true, Some((payer, amount)), Some(bridge), Some(world_name)) => {
                            if let Some(t) = g.trades.of_mut(id) {
                                t.paying = true;
                            }
                            save_trades(&g);
                            bridge.request(super::bridge::Request::Payment {
                                world: world_name,
                                key: trade_id.clone(),
                                from: trade.sides[payer].player.clone(),
                                to: trade.sides[1 - payer].player.clone(),
                                amount,
                                reason: format!("Trade with {}", trade.sides[1 - payer].name),
                                kind: "trade",
                                land_guild: None,
                            });
                        }
                        (true, None, _, _) => {
                            g.trades.complete(&trade_id);
                            save_trades(&g);
                        }
                        (true, Some(_), _, _) => {
                            // No backend to move the Crowns: unconfirm again.
                            if let Some(t) = g.trades.of_mut(id) {
                                t.sides.iter_mut().for_each(|s| s.confirmed = false);
                            }
                            unavailable = true;
                        }
                        _ => save_trades(&g),
                    }
                    if unavailable {
                        Err(IntentError::MarketUnavailable)
                    } else {
                        Ok((trade_id, trade))
                    }
                }
                Err(e) => Err(e),
            }
        };
        match result {
            Ok((trade_id, trade)) => {
                reply(world, id, INTENT, Ok(json!({ "trade": trade_id })));
                send_views(world, &trade_id);
                if world
                    .ecs()
                    .read_resource::<Gameplay>()
                    .trades
                    .of(id)
                    .is_none()
                {
                    for side in &trade.sides {
                        send(
                            world,
                            &side.player,
                            json!({ "trade": null, "ended": "done" }),
                        );
                    }
                }
            }
            Err(e) => reply(world, id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.trade.cancel", |world, id, _| {
        const INTENT: &str = "trade.cancel";
        let ended = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            match g.trades.of(id).map(|t| (t.id.clone(), t.paying)) {
                Some((_, true)) => Err(IntentError::Busy),
                Some((trade_id, false)) => {
                    let trade = g.trades.cancel(&trade_id);
                    save_trades(&g);
                    Ok(trade)
                }
                None => Err(IntentError::NothingThere),
            }
        };
        match ended {
            Ok(trade) => {
                reply(world, id, INTENT, Ok(json!({})));
                for side in trade.iter().flat_map(|t| t.sides.iter()) {
                    send(
                        world,
                        &side.player,
                        json!({ "trade": null, "ended": "cancelled" }),
                    );
                }
            }
            Err(e) => reply(world, id, INTENT, Err(e)),
        }
    });
}

/// Ends trades whose players left or drifted apart, expires invitations,
/// and applies outcomes to players online in this world.
#[derive(Default)]
pub struct TradeSystem {
    last: Option<std::time::Instant>,
}

impl<'a> specs::System<'a> for TradeSystem {
    type SystemData = (
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadStorage<'a, voxelize::PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (clients, positions, mut g, mut events): Self::SystemData) {
        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0)
            .min(0.5);
        self.last = Some(now);
        let position_of = |id: &str| {
            clients
                .get(id)
                .and_then(|c| positions.get(c.entity))
                .map(|p| [p.0 .0, p.0 .1, p.0 .2])
        };
        let notify = |events: &mut voxelize::Events, id: &str, payload: Value| {
            events.dispatch(
                Event::new(TRADE_EVENT)
                    .payload(payload)
                    .filter(ClientFilter::Direct(id.to_owned()))
                    .build(),
            );
        };
        g.trades.invites.retain(|_, (_, ttl)| {
            *ttl -= dt;
            *ttl > 0.0
        });

        let mut changed = false;
        let present = |g: &Gameplay, id: &str| {
            position_of(id).is_some()
                && g.players
                    .get(id)
                    .is_some_and(|p| !p.travel.departed && !p.vitals.is_dead())
        };
        let broken: Vec<String> = g
            .trades
            .open
            .iter()
            .filter(|t| !t.paying)
            .filter(|t| {
                let [a, b] = [&t.sides[0].player, &t.sides[1].player];
                match (
                    present(&g, a),
                    present(&g, b),
                    position_of(a),
                    position_of(b),
                ) {
                    (true, true, Some(p), Some(q)) => {
                        (0..3).map(|i| (p[i] - q[i]).powi(2)).sum::<f32>()
                            > BREAK_DISTANCE * BREAK_DISTANCE
                    }
                    _ => true,
                }
            })
            .map(|t| t.id.clone())
            .collect();
        for id in broken {
            if let Some(trade) = g.trades.cancel(&id) {
                changed = true;
                for side in &trade.sides {
                    if clients.get(&side.player).is_some() {
                        notify(
                            &mut events,
                            &side.player,
                            json!({ "trade": null, "ended": "cancelled" }),
                        );
                    }
                }
            }
        }

        // Outcomes for players here now.
        let content = g.rules.content_arc();
        let due: Vec<Outcome> = g
            .trades
            .outcomes
            .iter()
            .filter(|o| {
                clients.get(&o.player).is_some()
                    && g.players.get(&o.player).is_some_and(|p| !p.travel.departed)
            })
            .cloned()
            .collect();
        for outcome in due {
            let Gameplay {
                players,
                store,
                drops,
                trades,
                ..
            } = &mut *g;
            let player = players.get_mut(&outcome.player).expect("filtered");
            let left = apply(&content, player, &outcome);
            let p = position_of(&outcome.player).unwrap_or([0.0, 80.0, 0.0]);
            for stack in left {
                drops.spawn(stack, [p[0], p[1] - 1.0, p[2]], [0.0, 2.0, 0.0], None);
            }
            if let Err(e) = store.save(&store.record(&outcome.player, player, Some(p))) {
                log::error!("could not save player {}: {e}", outcome.player);
                continue;
            }
            trades
                .outcomes
                .retain(|o| !(o.player == outcome.player && o.trade == outcome.trade));
            changed = true;
            events.dispatch(
                Event::new(super::INVENTORY_EVENT)
                    .payload(json!({ "slots": player.inventory.slots, "selected": player.inventory.selected, "realm": player.realm }))
                    .filter(ClientFilter::Direct(outcome.player.clone()))
                    .build(),
            );
            if outcome.done {
                notify(
                    &mut events,
                    &outcome.player,
                    json!({ "received": outcome.receive.iter().map(|s| json!({ "item": content.item_by_id(s.item).map(|d| d.key.clone()), "count": s.count })).collect::<Vec<_>>() }),
                );
            }
        }
        if changed {
            save_trades(&g);
        }
    }
}

/// The Crowns of trade `key` moved: complete it.
pub(super) fn on_paid(g: &mut Gameplay, key: &str) -> Option<Trade> {
    let paying = g.trades.open.iter().any(|t| t.id == key && t.paying);
    let trade = paying.then(|| g.trades.complete(key)).flatten();
    if trade.is_some() {
        save_trades(g);
    }
    trade
}

/// The Crowns were refused: the trade stays open, unconfirmed.
pub(super) fn on_refused(g: &mut Gameplay, key: &str) -> Option<Trade> {
    let trade = g.trades.open.iter_mut().find(|t| t.id == key && t.paying)?;
    trade.paying = false;
    for side in trade.sides.iter_mut() {
        side.confirmed = false;
    }
    let trade = trade.clone();
    save_trades(g);
    Some(trade)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::survival::Vitals;

    fn setup() -> (Content, PlayerState, PlayerState, Trade) {
        let content = Content::load(platform_content::default_pack_dir()).unwrap();
        let mut a = PlayerState::new(Inventory::default(), Realm::Survival, Vitals::default());
        let mut b = PlayerState::new(Inventory::default(), Realm::Survival, Vitals::default());
        a.inventory
            .add(&content, content.item("iron_ingot").unwrap().id, 10);
        b.inventory
            .add(&content, content.item("bread").unwrap().id, 4);
        let side = |p: &str| Side {
            player: p.into(),
            name: p.into(),
            items: vec![],
            crowns: 0,
            confirmed: false,
        };
        let trade = Trade {
            id: "t1".into(),
            sides: [side("a"), side("b")],
            paying: false,
        };
        (content, a, b, trade)
    }

    #[test]
    fn offers_move_items_into_holds_and_changes_clear_confirmations() {
        let (c, mut a, mut b, mut t) = setup();
        offer(&c, &mut t, &mut a, 0, &[(0, 6)], 0, false).unwrap();
        assert_eq!(a.inventory.count_of(c.item("iron_ingot").unwrap().id), 4);
        assert_eq!(a.trade_hold.as_ref().unwrap().items[0].count, 6);
        t.sides[0].confirmed = true;
        offer(&c, &mut t, &mut b, 1, &[(0, 4)], 25, false).unwrap();
        assert!(!t.sides[0].confirmed, "any change unconfirms");
        // Adding puts more beside it.
        offer(&c, &mut t, &mut a, 0, &[(0, 1)], 0, false).unwrap();
        assert_eq!(t.sides[0].items.len(), 2);
        assert_eq!(a.trade_hold.as_ref().unwrap().items.len(), 2);
        // A reset returns the old offer first.
        offer(&c, &mut t, &mut a, 0, &[(0, 2)], 0, true).unwrap();
        assert_eq!(a.inventory.count_of(c.item("iron_ingot").unwrap().id), 8);
        assert_eq!(t.sides[0].items.len(), 1);
        assert_eq!(t.sides[0].items[0].count, 2);
        // Too many: nothing changes.
        assert!(offer(&c, &mut t, &mut a, 0, &[(0, 99)], 0, false).is_err());
        assert_eq!(a.inventory.count_of(c.item("iron_ingot").unwrap().id), 8);
        assert_eq!(net(&t), Some((1, 25)), "b pays a the difference");
    }

    #[test]
    fn completion_swaps_and_cancel_returns_exactly_once() {
        let (c, mut a, mut b, mut t) = setup();
        offer(&c, &mut t, &mut a, 0, &[(0, 6)], 0, false).unwrap();
        offer(&c, &mut t, &mut b, 1, &[(0, 4)], 0, false).unwrap();
        let mut trades = Trades {
            open: vec![t.clone()],
            ..Default::default()
        };
        trades.complete("t1").unwrap();
        let (oa, ob) = (trades.outcomes[0].clone(), trades.outcomes[1].clone());
        assert!(apply(&c, &mut a, &oa).is_empty());
        assert!(apply(&c, &mut a, &oa).is_empty(), "applied once");
        apply(&c, &mut b, &ob);
        let (iron, bread) = (
            c.item("iron_ingot").unwrap().id,
            c.item("bread").unwrap().id,
        );
        assert_eq!(
            (a.inventory.count_of(iron), a.inventory.count_of(bread)),
            (4, 4)
        );
        assert_eq!(
            (b.inventory.count_of(iron), b.inventory.count_of(bread)),
            (6, 0)
        );
        assert!(a.trade_hold.is_none() && b.trade_hold.is_none());

        let (c, mut a, _, mut t) = setup();
        offer(&c, &mut t, &mut a, 0, &[(0, 3)], 0, false).unwrap();
        let mut trades = Trades {
            open: vec![t],
            ..Default::default()
        };
        trades.cancel("t1");
        let back = trades
            .outcomes
            .iter()
            .find(|o| o.player == "a")
            .unwrap()
            .clone();
        apply(&c, &mut a, &back);
        assert_eq!(a.inventory.count_of(iron), 10);
    }

    #[test]
    fn a_restart_cancels_unpaid_trades_and_keeps_paying_ones() {
        let dir = std::env::temp_dir().join(format!("trades-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (_, _, _, t) = setup();
        let mut paying = t.clone();
        paying.id = "t2".into();
        paying.paying = true;
        Trades {
            open: vec![t, paying],
            ..Default::default()
        }
        .save(&dir)
        .unwrap();
        let loaded = Trades::load(&dir).unwrap();
        assert_eq!(loaded.open.len(), 1);
        assert_eq!(loaded.open[0].id, "t2");
        assert_eq!(
            loaded.outcomes.len(),
            2,
            "both sides of the unpaid trade get their goods back"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
