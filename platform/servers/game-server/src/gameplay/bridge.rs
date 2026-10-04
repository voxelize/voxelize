//! Calls from the game server to the backend's internal API for the
//! market: handing listed goods over and fetching deliveries.
//!
//! World systems never wait on the network. They queue a [`Request`]; one
//! task on the server's async runtime sends requests in order and files
//! each [`Response`] in the inbox of the engine world that asked, where
//! that world's market system picks it up on a later tick. Every request is
//! idempotent on the backend (listings by outbox id, deliveries by id), so
//! anything that fails in transit is simply sent again.

use std::collections::{HashMap, VecDeque};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// A listing waiting to reach the backend, saved with the seller's record
/// together with the inventory it left, so goods are never lost or doubled.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OutboxEntry {
    /// Unique id; the backend creates one listing per id.
    pub id: String,
    /// Content item key, count and durability of the goods.
    pub item: String,
    pub count: u32,
    #[serde(default)]
    pub durability: Option<u32>,
    /// `fixed` or `auction`.
    pub kind: String,
    pub price: u64,
    #[serde(default)]
    pub buyout: Option<u64>,
    pub hours: u32,
}

/// Goods the backend owes a player.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Delivery {
    pub id: String,
    pub player: String,
    pub item: String,
    pub count: u32,
    #[serde(default)]
    pub durability: Option<u32>,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub enum Request {
    CreateListing {
        world: String,
        player: String,
        entry: OutboxEntry,
    },
    PendingDeliveries {
        world: String,
        players: Vec<String>,
    },
    Acknowledge {
        world: String,
        delivery: String,
    },
    /// A buyer pays a stall's owner.
    Payment {
        world: String,
        key: String,
        from: String,
        to: String,
        amount: u64,
        reason: String,
    },
}

impl Request {
    fn world(&self) -> &str {
        match self {
            Request::CreateListing { world, .. }
            | Request::PendingDeliveries { world, .. }
            | Request::Acknowledge { world, .. }
            | Request::Payment { world, .. } => world,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Response {
    /// The backend holds the goods now.
    Listed {
        player: String,
        entry: String,
        listing: String,
    },
    /// The backend refused for good (`code`); the goods go back.
    Rejected {
        player: String,
        entry: String,
        code: String,
    },
    /// Not sent (network, backend down): try again later.
    ListingFailed {
        player: String,
        entry: String,
    },
    Deliveries(Vec<Delivery>),
    DeliveriesFailed,
    Acknowledged {
        delivery: String,
    },
    AcknowledgeFailed {
        delivery: String,
    },
    /// The money moved (or had already moved for this key).
    Paid {
        key: String,
    },
    /// Refused for good (`insufficient_funds`, …): the goods go back.
    PaymentRefused {
        key: String,
        code: String,
    },
    /// Not sent: try again later.
    PaymentFailed {
        key: String,
    },
}

/// The game server's side of the market link, shared by every dimension.
pub struct Bridge {
    /// The backend's name for this world (`main`), whatever the dimension.
    pub shard: String,
    outgoing: Mutex<mpsc::Sender<Request>>,
    inboxes: Mutex<HashMap<String, VecDeque<Response>>>,
}

impl Bridge {
    /// A bridge whose requests go nowhere until [`Bridge::start`] drains
    /// them (tests read them from the returned receiver).
    pub fn detached(shard: &str) -> (Arc<Self>, mpsc::Receiver<Request>) {
        let (tx, rx) = mpsc::channel();
        (
            Arc::new(Self {
                shard: shard.to_owned(),
                outgoing: Mutex::new(tx),
                inboxes: Mutex::new(HashMap::new()),
            }),
            rx,
        )
    }

    /// Start sending requests to the backend at `url` (the internal API base).
    pub fn start(url: String, token: String, shard: &str) -> Arc<Self> {
        let (bridge, rx) = Self::detached(shard);
        let worker = bridge.clone();
        actix_web::rt::spawn(async move {
            let client = awc::Client::builder()
                .timeout(Duration::from_secs(10))
                .finish();
            loop {
                let mut idle = true;
                while let Ok(request) = rx.try_recv() {
                    idle = false;
                    let world = request.world().to_owned();
                    let response = send(&client, &url, &token, &worker.shard, request).await;
                    worker.file(&world, response);
                }
                if idle {
                    actix_web::rt::time::sleep(Duration::from_millis(25)).await;
                }
            }
        });
        bridge
    }

    pub fn request(&self, request: Request) {
        if let Ok(tx) = self.outgoing.lock() {
            let _ = tx.send(request);
        }
    }

    /// File a response for a world (the worker does this).
    pub fn file(&self, world: &str, response: Response) {
        if let Ok(mut inboxes) = self.inboxes.lock() {
            inboxes
                .entry(world.to_owned())
                .or_default()
                .push_back(response);
        }
    }

    /// Everything that arrived for a world since last time.
    pub fn take(&self, world: &str) -> Vec<Response> {
        self.inboxes
            .lock()
            .ok()
            .and_then(|mut inboxes| inboxes.get_mut(world).map(|q| q.drain(..).collect()))
            .unwrap_or_default()
    }
}

/// An answer: status and JSON body (`Null` when there was none).
async fn post(
    client: &awc::Client,
    url: &str,
    token: &str,
    body: Value,
) -> Result<(u16, Value), String> {
    let mut response = client
        .post(url)
        .insert_header(("Authorization", format!("Bearer {token}")))
        .insert_header(("Accept", "application/json"))
        .send_json(&body)
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let bytes = response
        .body()
        .limit(4 * 1024 * 1024)
        .await
        .map_err(|e| e.to_string())?;
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Ok((status, value))
}

fn error_code(body: &Value) -> String {
    body.pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or("rejected")
        .to_owned()
}

async fn send(
    client: &awc::Client,
    base: &str,
    token: &str,
    shard: &str,
    request: Request,
) -> Response {
    match request {
        Request::CreateListing { player, entry, .. } => {
            let body = json!({
                "key": entry.id,
                "seller": player,
                "world": shard,
                "kind": entry.kind,
                "item": entry.item,
                "count": entry.count,
                "durability": entry.durability,
                "price": entry.price,
                "buyout": entry.buyout,
                "hours": entry.hours,
            });
            match post(client, &format!("{base}/market/listings"), token, body).await {
                Ok((200 | 201, body)) => {
                    match body.pointer("/listing/id").and_then(Value::as_str) {
                        Some(listing) => Response::Listed {
                            player,
                            entry: entry.id,
                            listing: listing.to_owned(),
                        },
                        None => Response::ListingFailed {
                            player,
                            entry: entry.id,
                        },
                    }
                }
                // A definite refusal: validation, unknown seller, conflict.
                Ok((400 | 404 | 409 | 422, body)) => Response::Rejected {
                    player,
                    entry: entry.id,
                    code: error_code(&body),
                },
                Ok((status, _)) => {
                    log::warn!("market: listing {} got HTTP {status}; will retry", entry.id);
                    Response::ListingFailed {
                        player,
                        entry: entry.id,
                    }
                }
                Err(e) => {
                    log::warn!("market: listing {} not sent ({e}); will retry", entry.id);
                    Response::ListingFailed {
                        player,
                        entry: entry.id,
                    }
                }
            }
        }
        Request::PendingDeliveries { players, .. } => {
            let body = json!({ "world": shard, "players": players });
            match post(client, &format!("{base}/deliveries/pending"), token, body).await {
                Ok((200, body)) => match body
                    .get("deliveries")
                    .cloned()
                    .map(serde_json::from_value::<Vec<Delivery>>)
                {
                    Some(Ok(deliveries)) => Response::Deliveries(deliveries),
                    _ => Response::DeliveriesFailed,
                },
                _ => Response::DeliveriesFailed,
            }
        }
        Request::Payment {
            key,
            from,
            to,
            amount,
            reason,
            ..
        } => {
            let body =
                json!({ "key": key, "from": from, "to": to, "amount": amount, "reason": reason });
            match post(client, &format!("{base}/payments"), token, body).await {
                Ok((200 | 201, _)) => Response::Paid { key },
                Ok((400 | 404 | 409 | 422, body)) => Response::PaymentRefused {
                    key,
                    code: error_code(&body),
                },
                Ok((status, _)) => {
                    log::warn!("market: payment {key} got HTTP {status}; will retry");
                    Response::PaymentFailed { key }
                }
                Err(e) => {
                    log::warn!("market: payment {key} not sent ({e}); will retry");
                    Response::PaymentFailed { key }
                }
            }
        }
        Request::Acknowledge { delivery, .. } => {
            let url = format!("{base}/deliveries/{delivery}/ack");
            match post(client, &url, token, json!({})).await {
                Ok((200, _)) => Response::Acknowledged { delivery },
                _ => Response::AcknowledgeFailed { delivery },
            }
        }
    }
}
