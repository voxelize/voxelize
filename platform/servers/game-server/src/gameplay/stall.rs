//! Trade stalls: players' shops in the world.
//!
//! The owner stocks a stall through its chest-style window and prices each
//! slot. Another player buying a slot sets its goods aside in a sale and
//! asks the backend to move the money (one ledger `sale`, idempotent by the
//! sale's key); the goods go to the buyer once paid, or back into the stock
//! if the payment is refused. Sales are saved with the stall, so a restart
//! asks again and lands on the same outcome. A paid sale is handed over at
//! most once: its key is remembered in the buyer's record, like a market
//! delivery.

use platform_ticket::Realm;
use serde::Deserialize;
use serde_json::{json, Value};
use specs::WorldExt;
use voxelize::{ClientFilter, Event, World};

use super::bridge::Request;
use super::containers::{Container, Stall, StallSale, STALL_SIZE};
use super::market::MAX_PRICE;
use super::rules::IntentError;
use super::{client_position, now_ms, parse, reply, Gameplay};

/// What a stall offers, sent to whoever looks at it:
/// `{ "at", "owner": { "id", "name" }, "mine", "creative", "offers": [...], "prices": [...] }`.
pub const STALL_EVENT: &str = "platform.stall";

/// The view of a stall for `viewer`.
pub fn view(
    stall: &Stall,
    at: [i32; 3],
    viewer: &str,
    content: &platform_content::Content,
) -> Value {
    let offers: Vec<Value> = stall
        .slots
        .iter()
        .enumerate()
        .filter_map(|(slot, s)| {
            let s = s.as_ref()?;
            let price = *stall.prices.get(slot)?;
            (price > 0).then(|| {
                json!({
                    "slot": slot,
                    "item": content.item_by_id(s.item).map(|i| i.key.clone()),
                    "count": s.count,
                    "durability": s.durability,
                    "price": price,
                })
            })
        })
        .collect();
    json!({
        "at": at,
        "owner": { "id": stall.owner, "name": stall.owner_name },
        "mine": stall.owner == viewer,
        "creative": stall.creative,
        "offers": offers,
        "prices": stall.prices,
        "pending": stall.sales.len(),
        // The owner prices every slot, priced or not.
        "stock": (stall.owner == viewer).then(|| {
            stall
                .slots
                .iter()
                .map(|s| {
                    s.as_ref().map(|s| {
                        json!({
                            "item": content.item_by_id(s.item).map(|i| i.key.clone()),
                            "count": s.count,
                        })
                    })
                })
                .collect::<Vec<_>>()
        }),
    })
}

pub(super) fn send_view(world: &mut World, id: &str, at: [i32; 3]) {
    let payload = {
        let g = world.ecs().read_resource::<Gameplay>();
        match g.containers.map.get(&at) {
            Some(Container::Stall(stall)) => view(stall, at, id, g.rules.content()),
            _ => return,
        }
    };
    world.events_mut().dispatch(
        Event::new(STALL_EVENT)
            .payload(payload)
            .filter(ClientFilter::Direct(id.to_owned()))
            .build(),
    );
}

/// Why `player` may not break the stall at `at`, if it is one.
pub(super) fn guard_break(g: &Gameplay, player: &str, at: [i32; 3]) -> Result<(), IntentError> {
    match g.containers.map.get(&at) {
        Some(Container::Stall(stall)) if stall.owner != player => Err(IntentError::NotOwner),
        Some(Container::Stall(stall)) if !stall.sales.is_empty() => Err(IntentError::Busy),
        _ => Ok(()),
    }
}

fn within_reach(g: &Gameplay, position: Option<[f32; 3]>, at: [i32; 3]) -> bool {
    let reach = g.rules.reach;
    position.is_some_and(|p| {
        (0..3)
            .map(|i| (at[i] as f32 + 0.5 - p[i]).powi(2))
            .sum::<f32>()
            <= reach * reach
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PricePayload {
    at: [i32; 3],
    slot: usize,
    price: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BuyPayload {
    at: [i32; 3],
    slot: usize,
}

/// Set a slot's price (owner only). 0 takes it off sale.
pub fn set_price(
    stall: &mut Stall,
    player: &str,
    slot: usize,
    price: u64,
) -> Result<(), IntentError> {
    if stall.owner != player {
        return Err(IntentError::NotOwner);
    }
    if slot >= STALL_SIZE || price > MAX_PRICE {
        return Err(IntentError::BadListing);
    }
    stall.prices[slot] = price;
    Ok(())
}

/// Set a slot's goods aside for `buyer` under `key`.
pub fn reserve(
    stall: &mut Stall,
    buyer: &str,
    buyer_realm: Realm,
    slot: usize,
    key: String,
) -> Result<StallSale, IntentError> {
    if stall.owner == buyer {
        return Err(IntentError::NotOwner);
    }
    if stall.creative || buyer_realm != Realm::Survival {
        return Err(IntentError::SurvivalOnly);
    }
    let price = *stall.prices.get(slot).ok_or(IntentError::BadListing)?;
    if price == 0 {
        return Err(IntentError::BadListing);
    }
    let stack = stall
        .slots
        .get_mut(slot)
        .and_then(Option::take)
        .ok_or(IntentError::NothingThere)?;
    let sale = StallSale {
        key,
        slot,
        buyer: buyer.to_owned(),
        price,
        stack,
        paid: false,
    };
    stall.sales.push(sale.clone());
    Ok(sale)
}

pub fn install(world: &mut World) {
    world.set_method_handle("platform.stall.price", |world, id, payload| {
        const INTENT: &str = "stall.price";
        let Some(p) = parse::<PricePayload>(world, id, INTENT, payload) else {
            return;
        };
        let position = client_position(world, id);
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            if !within_reach(&g, position, p.at) {
                Err(IntentError::OutOfReach)
            } else {
                let dir = g.world_dir.clone();
                let r = match g.containers.map.get_mut(&p.at) {
                    Some(Container::Stall(stall)) => set_price(stall, id, p.slot, p.price),
                    _ => Err(IntentError::NothingThere),
                };
                if r.is_ok() {
                    if let Err(e) = g.containers.save(&dir) {
                        log::error!("could not save containers: {e}");
                    }
                }
                r
            }
        };
        let ok = result.is_ok();
        reply(
            world,
            id,
            INTENT,
            result.map(|_| json!({ "slot": p.slot, "price": p.price })),
        );
        if ok {
            send_view(world, id, p.at);
        }
    });

    world.set_method_handle("platform.stall.buy", |world, id, payload| {
        const INTENT: &str = "stall.buy";
        let Some(p) = parse::<BuyPayload>(world, id, INTENT, payload) else {
            return;
        };
        let position = client_position(world, id);
        let result = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let (realm, dead) = match g.players.get(id) {
                Some(player) if !player.travel.departed => (player.realm, player.vitals.is_dead()),
                _ => (Realm::Survival, true),
            };
            let world_name = g
                .dimensions
                .world_of(g.dimensions.current)
                .map(str::to_owned);
            match (g.dimensions.bridge.clone(), world_name) {
                _ if dead => Err(IntentError::Dead),
                (None, _) | (_, None) => Err(IntentError::MarketUnavailable),
                _ if !within_reach(&g, position, p.at) => Err(IntentError::OutOfReach),
                (Some(bridge), Some(world_name)) => {
                    let key = format!(
                        "s{:x}{:012x}",
                        now_ms(),
                        (g.random() * 2f64.powi(48)) as u64
                    );
                    let dir = g.world_dir.clone();
                    let content = g.rules.content_arc();
                    let reserved = match g.containers.map.get_mut(&p.at) {
                        Some(Container::Stall(stall)) => reserve(stall, id, realm, p.slot, key)
                            .map(|sale| (sale, stall.owner.clone())),
                        _ => Err(IntentError::NothingThere),
                    };
                    if let Ok((sale, owner)) = &reserved {
                        // Saved before asking for money: a restart asks again.
                        if let Err(e) = g.containers.save(&dir) {
                            log::error!("could not save containers: {e}");
                        }
                        let name = content
                            .item_by_id(sale.stack.item)
                            .map(|i| i.name.clone())
                            .unwrap_or_default();
                        bridge.request(Request::Payment {
                            world: world_name,
                            key: sale.key.clone(),
                            from: id.to_owned(),
                            to: owner.clone(),
                            amount: sale.price,
                            reason: format!("Stall: {} {name}", sale.stack.count),
                        });
                    }
                    reserved.map(|(sale, _)| sale)
                }
            }
        };
        match result {
            Ok(sale) => {
                reply(
                    world,
                    id,
                    INTENT,
                    Ok(json!({ "pending": sale.key, "price": sale.price })),
                );
                send_view(world, id, p.at);
            }
            Err(e) => reply(world, id, INTENT, Err(e)),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::inventory::Stack;

    fn stall() -> Stall {
        let mut s = Stall::new("owner", "Olga", false);
        s.slots[0] = Some(Stack {
            item: 7,
            count: 4,
            durability: None,
        });
        s
    }

    #[test]
    fn only_owners_price_and_priced_stock_sells_once() {
        let mut s = stall();
        assert_eq!(set_price(&mut s, "eve", 0, 10), Err(IntentError::NotOwner));
        assert_eq!(
            set_price(&mut s, "owner", 9, 10),
            Err(IntentError::BadListing)
        );
        assert_eq!(
            reserve(&mut s, "bob", Realm::Survival, 0, "k1".into()),
            Err(IntentError::BadListing),
            "not priced"
        );
        set_price(&mut s, "owner", 0, 25).unwrap();
        assert_eq!(
            reserve(&mut s, "owner", Realm::Survival, 0, "k1".into()),
            Err(IntentError::NotOwner)
        );
        assert_eq!(
            reserve(&mut s, "bob", Realm::Creative, 0, "k1".into()),
            Err(IntentError::SurvivalOnly)
        );
        let sale = reserve(&mut s, "bob", Realm::Survival, 0, "k1".into()).unwrap();
        assert_eq!((sale.price, sale.stack.count, sale.paid), (25, 4, false));
        assert!(s.slots[0].is_none(), "set aside");
        assert_eq!(
            reserve(&mut s, "carl", Realm::Survival, 0, "k2".into()),
            Err(IntentError::NothingThere)
        );

        // Refused: back where it was, or anywhere free.
        assert_eq!(s.restock(0, sale.stack.clone()), None);
        assert_eq!(s.slots[0].as_ref().map(|x| x.count), Some(4));
        assert_eq!(s.restock(0, sale.stack.clone()), None);
        assert!(s.slots[1].is_some());
    }

    #[test]
    fn creative_stalls_never_sell() {
        let mut s = Stall::new("owner", "Olga", true);
        s.slots[0] = Some(Stack {
            item: 7,
            count: 1,
            durability: None,
        });
        set_price(&mut s, "owner", 0, 5).unwrap();
        assert_eq!(
            reserve(&mut s, "bob", Realm::Survival, 0, "k".into()),
            Err(IntentError::SurvivalOnly)
        );
    }

    #[test]
    fn the_view_lists_priced_stock() {
        let content =
            platform_content::Content::load(platform_content::default_pack_dir()).unwrap();
        let mut s = Stall::new("owner", "Olga", false);
        let bread = content.item("bread").unwrap().id;
        s.slots[2] = Some(Stack {
            item: bread,
            count: 3,
            durability: None,
        });
        s.slots[3] = Some(Stack {
            item: bread,
            count: 1,
            durability: None,
        });
        s.prices[2] = 12;
        let v = view(&s, [1, 2, 3], "bob", &content);
        assert_eq!(v["mine"], false);
        assert_eq!(v["owner"]["name"], "Olga");
        assert_eq!(v["offers"].as_array().unwrap().len(), 1);
        assert_eq!(v["offers"][0]["item"], "bread");
        assert_eq!(v["offers"][0]["price"], 12);
        let mine = view(&s, [1, 2, 3], "owner", &content);
        assert_eq!(mine["mine"], true);
        assert_eq!(mine["stock"].as_array().unwrap().len(), 9);
        assert_eq!(mine["stock"][3]["count"], 1);
        assert!(v["stock"].is_null(), "only the owner sees unpriced stock");
    }
}
