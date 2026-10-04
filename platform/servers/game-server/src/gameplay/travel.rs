//! Travel between dimensions through portals.
//!
//! Every dimension is its own engine world in this process, and all of
//! them share one player store. Standing in a rift for a few seconds
//! departs: the player's record is saved with the destination dimension and
//! where to arrive, the player is frozen here (nothing they do here is
//! saved any more), and the client is told to join the destination world.
//! The destination loads the record on join, generates the arrival area,
//! reuses a portal within 16 columns or builds one, and moves the player
//! into it. A player whose record names another dimension is redirected
//! there on join, so the server alone decides where a player is.

use std::collections::HashMap;
use std::sync::Arc;

use platform_content::Dimension;
use platform_ticket::Realm;
use platform_worldgen::{Sky, Underworld};
use serde::{Deserialize, Serialize};
use serde_json::json;
use voxelize::{
    ChunkRequestsComp, Chunks, ClientFilter, Event, PositionComp, Vec2, Vec3, VoxelAccess,
};

use super::survival::EYE_HEIGHT;
use super::Gameplay;
use crate::portals::{self, PortalBlocks};

/// Tells a client to join another world: `{ "world": name }`.
pub const TRAVEL_EVENT: &str = "platform.travel";
/// Moves a client: `{ "feet": [x, y, z] }`, the cell its feet stand in.
pub const TELEPORT_EVENT: &str = "platform.teleport";
/// Seconds after arriving or joining before stepping out of a portal
/// counts.
pub const SETTLE_SECONDS: f32 = 3.0;
/// Seconds standing in a rift before travelling.
pub const SURVIVAL_DELAY: f32 = 4.0;
pub const CREATIVE_DELAY: f32 = 1.0;

/// Where a travelling player is to arrive, in the destination's blocks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Arrival {
    pub from: Dimension,
    pub at: [f64; 3],
    /// Anchor of the portal they left through, linked to the one they
    /// arrive in.
    #[serde(default)]
    pub portal: Option<[i32; 3]>,
    /// `at` is a linked portal's anchor, not a scaled position.
    #[serde(default)]
    pub exact: bool,
}

/// One end of a portal link.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct End {
    pub dimension: Dimension,
    pub at: [i32; 3],
}

/// Pairs of portals that lead to each other, shared by every dimension of
/// a world and saved next to its player records (`portal_links.json`).
pub struct PortalLinks {
    path: Option<std::path::PathBuf>,
    map: HashMap<End, End>,
}

impl PortalLinks {
    pub fn in_memory() -> Self {
        Self {
            path: None,
            map: HashMap::new(),
        }
    }

    pub fn load(dir: &std::path::Path) -> Result<Self, String> {
        let path = dir.join("portal_links.json");
        let pairs: Vec<(End, End)> = match std::fs::read(&path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display()))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        let mut map = HashMap::new();
        for (a, b) in pairs {
            map.insert(a, b);
            map.insert(b, a);
        }
        Ok(Self {
            path: Some(path),
            map,
        })
    }

    pub fn partner(&self, end: &End) -> Option<End> {
        self.map.get(end).copied()
    }

    /// Link two portals, unlinking whatever either was linked to.
    pub fn link(&mut self, a: End, b: End) -> std::io::Result<()> {
        for end in [a, b] {
            if let Some(old) = self.map.remove(&end) {
                self.map.remove(&old);
            }
        }
        self.map.insert(a, b);
        self.map.insert(b, a);
        self.save()
    }

    fn save(&self) -> std::io::Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let mut pairs: Vec<(End, End)> = self
            .map
            .iter()
            .filter(|(a, b)| (a.dimension.key(), a.at) < (b.dimension.key(), b.at))
            .map(|(a, b)| (*a, *b))
            .collect();
        pairs.sort_by_key(|(a, b)| (a.dimension.key(), a.at, b.dimension.key(), b.at));
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(
            &tmp,
            serde_json::to_vec_pretty(&pairs).expect("links serialize"),
        )?;
        std::fs::rename(tmp, path)
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TravelState {
    /// Set until the arrival area is ready and the player is placed.
    pub arrival: Option<Arrival>,
    /// Left for another dimension: frozen and never saved here again.
    pub departed: bool,
    /// Seconds spent standing in a rift.
    pub in_portal: f32,
    /// Arrived inside a portal: no travel until they step out of it.
    pub blocked: bool,
    /// Seconds before `blocked` can clear: the body reaches its new place
    /// a moment after the client is moved.
    pub settle: f32,
    /// Seconds since chunks for the arrival were last requested.
    pub since_request: f32,
}

/// The dimensions of this world and the engine world serving each.
#[derive(Clone)]
pub struct Dimensions {
    pub current: Dimension,
    pub worlds: Arc<HashMap<Dimension, String>>,
    pub links: Arc<std::sync::Mutex<PortalLinks>>,
    /// The world's land claims, shared by every dimension.
    pub land: super::land::SharedLand,
    /// Guilds (from the backend) and their vaults, shared by every dimension.
    pub guilds: super::guilds::SharedGuilds,
    pub vaults: super::guilds::SharedVaults,
    /// The market link to the backend, when there is a backend.
    pub bridge: Option<Arc<super::bridge::Bridge>>,
}

impl Dimensions {
    pub fn world_of(&self, dimension: Dimension) -> Option<&str> {
        self.worlds.get(&dimension).map(String::as_str)
    }
}

/// Where a traveller leaving `from` at `position` arrives in `to`
/// (horizontal coordinates scale; height is found on arrival).
pub fn destination(from: Dimension, to: Dimension, position: [f32; 3]) -> [f64; 3] {
    let k = to.scale() / from.scale();
    [position[0] as f64 * k, 64.0, position[2] as f64 * k]
}

/// The nearest island column within 32 blocks of `(x, z)` (every other
/// column, nearest first) and the height to stand at, given the topmost
/// solid block of a column.
pub fn sky_landing(
    x: i32,
    z: i32,
    top: impl Fn(i32, i32) -> Option<i32>,
) -> Option<(i32, i32, i32)> {
    let mut best: Option<((i32, i32, i32), i32)> = None;
    for dx in (-32..=32).step_by(2) {
        for dz in (-32..=32).step_by(2) {
            let d = dx * dx + dz * dz;
            if best.is_some_and(|(_, b)| b <= d) {
                continue;
            }
            if let Some(y) = top(x + dx, z + dz) {
                best = Some(((x + dx, z + dz, y + 1), d));
            }
        }
    }
    best.map(|(p, _)| p)
}

/// Heights portals are searched for and built at in a dimension, around
/// the arrival's centre height.
fn heights(dimension: Dimension, center_y: i32) -> std::ops::Range<i32> {
    let (lo, hi) = match dimension {
        Dimension::Overworld => (2, 250),
        Dimension::Underworld => (Underworld::LAVA_LEVEL + 1, Underworld::ROOF - 6),
        Dimension::Sky => (Sky::ISLAND_LEVEL - 40, Sky::CLOUD_LEVEL - 6),
    };
    (center_y - 24).max(lo)..(center_y + 24).min(hi)
}

fn send(events: &mut voxelize::Events, id: &str, name: &str, payload: serde_json::Value) {
    events.dispatch(
        Event::new(name)
            .payload(payload)
            .filter(ClientFilter::Direct(id.to_owned()))
            .build(),
    );
}

#[derive(Default)]
pub struct PortalSystem {
    last: Option<std::time::Instant>,
}

impl<'a> specs::System<'a> for PortalSystem {
    type SystemData = (
        specs::WriteExpect<'a, Chunks>,
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadExpect<'a, voxelize::WorldConfig>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteStorage<'a, ChunkRequestsComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(
        &mut self,
        (mut chunks, clients, config, positions, mut requests, mut g, mut events): Self::SystemData,
    ) {
        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0)
            .min(0.25);
        self.last = Some(now);
        let content = g.rules.content_arc();
        let kinds = PortalBlocks::all(&content);
        if kinds.is_empty() {
            return;
        }
        let dims = g.dimensions.clone();
        let size = config.chunk_size as i32;
        let solid = |chunks: &Chunks, [x, y, z]: [i32; 3]| {
            content
                .block_by_id(chunks.get_voxel(x, y, z))
                .is_some_and(|b| b.collision && b.fluid.is_none())
        };

        for (id, client) in clients.iter() {
            let Some(p) = positions
                .get(client.entity)
                .map(|p| [p.0 .0, p.0 .1, p.0 .2])
            else {
                continue;
            };
            let Gameplay { players, store, .. } = &mut *g;
            let Some(player) = players.get_mut(id) else {
                continue;
            };
            if player.travel.departed {
                continue;
            }

            // Arriving: generate the area, then find or build a portal.
            if let Some(arrival) = player.travel.arrival.clone() {
                let (x, z) = (arrival.at[0].floor() as i32, arrival.at[2].floor() as i32);
                let (cx, cz) = (x.div_euclid(size), z.div_euclid(size));
                // The sky looks further for an island to land on.
                let r = if dims.current == Dimension::Sky && !arrival.exact {
                    2
                } else {
                    1
                };
                let area: Vec<Vec2<i32>> = (-r..=r)
                    .flat_map(|dx| (-r..=r).map(move |dz| Vec2(cx + dx, cz + dz)))
                    .collect();
                if !area.iter().all(|c| chunks.is_chunk_ready(c)) {
                    player.travel.since_request -= dt;
                    if player.travel.since_request <= 0.0 {
                        player.travel.since_request = 1.0;
                        if let Some(r) = requests.get_mut(client.entity) {
                            r.requests.extend(area.iter().cloned());
                        }
                    }
                    continue;
                }
                let blocks =
                    PortalBlocks::between(&content, arrival.from, dims.current).unwrap_or(kinds[0]);
                let top = |x: i32, z: i32, below: i32| {
                    (2..below).rev().find(|&y| solid(&chunks, [x, y, z]))
                };
                let (x, z, center_y) = match dims.current {
                    _ if arrival.exact => (x, z, arrival.at[1] as i32),
                    Dimension::Overworld => (x, z, top(x, z, 250).map(|y| y + 1).unwrap_or(64)),
                    Dimension::Underworld => (x, z, arrival.at[1] as i32),
                    // Arrive on the nearest island (never on a cloud); over
                    // open void, a portal platform is built at island height.
                    Dimension::Sky => sky_landing(x, z, |x, z| top(x, z, Sky::CLOUD_LEVEL))
                        .unwrap_or((x, z, Sky::ISLAND_LEVEL + 1)),
                };
                let center = [x, center_y, z];
                let range = heights(dims.current, center_y);
                let feet = match portals::find_rift(&blocks, center, range.clone(), |[a, b, c]| {
                    chunks.get_voxel(a, b, c)
                }) {
                    Some(rift) => {
                        portals::anchor(&blocks, rift, |[a, b, c]| chunks.get_raw_voxel(a, b, c))
                    }
                    None => {
                        let site = portals::site(center, range, |q| solid(&chunks, q));
                        let (writes, stand) = portals::build(&blocks, site[0], site[1], site[2]);
                        let writes: Vec<(Vec3<i32>, u32)> = writes
                            .into_iter()
                            .map(|([a, b, c], v)| (Vec3(a, b, c), v))
                            .collect();
                        chunks.update_voxels(&writes);
                        stand
                    }
                };
                if let Some(from) = arrival.portal {
                    let linked = match dims.links.lock() {
                        Ok(mut links) => links.link(
                            End {
                                dimension: arrival.from,
                                at: from,
                            },
                            End {
                                dimension: dims.current,
                                at: feet,
                            },
                        ),
                        Err(_) => Err(std::io::Error::other("portal links lock poisoned")),
                    };
                    if let Err(e) = linked {
                        log::error!("could not save portal links: {e}");
                    }
                }
                player.travel.arrival = None;
                player.travel.blocked = true;
                player.travel.settle = SETTLE_SECONDS;
                player.travel.in_portal = 0.0;
                player.vitals.start_grace(5.0);
                send(&mut events, id, TELEPORT_EVENT, json!({ "feet": feet }));
                continue;
            }

            // Standing in a rift long enough departs.
            let feet = (p[1] - EYE_HEIGHT + 0.1).floor() as i32;
            let (x, z) = (p[0].floor() as i32, p[2].floor() as i32);
            let rift = [feet, feet + 1].into_iter().find_map(|y| {
                let id = chunks.get_voxel(x, y, z);
                let kind = kinds.iter().find(|k| k.rift == id)?;
                Some((*kind, [x, y, z]))
            });
            let in_rift = rift.is_some();
            player.travel.settle = (player.travel.settle - dt).max(0.0);
            if !in_rift {
                if player.travel.settle == 0.0 {
                    player.travel.blocked = false;
                }
                player.travel.in_portal = 0.0;
                continue;
            }
            if player.travel.blocked
                || player.vitals.is_dead()
                || player.window.is_some()
                || player.cursor.is_some()
            {
                continue;
            }
            player.travel.in_portal += dt;
            let delay = if player.realm == Realm::Creative {
                CREATIVE_DELAY
            } else {
                SURVIVAL_DELAY
            };
            if player.travel.in_portal < delay {
                continue;
            }
            let Some((blocks, cell)) = rift else {
                continue;
            };
            let Some(to) = blocks.route(dims.current) else {
                continue;
            };
            let Some(world) = dims.world_of(to) else {
                continue;
            };
            player.mining = None;
            let anchor = Some(portals::anchor(&blocks, cell, |[a, b, c]| {
                chunks.get_raw_voxel(a, b, c)
            }));
            let partner = anchor.and_then(|at| {
                dims.links.lock().ok()?.partner(&End {
                    dimension: dims.current,
                    at,
                })
            });
            player.travel.arrival = Some(match partner {
                Some(end) if end.dimension == to => Arrival {
                    from: dims.current,
                    at: [end.at[0] as f64, end.at[1] as f64, end.at[2] as f64],
                    portal: anchor,
                    exact: true,
                },
                _ => Arrival {
                    from: dims.current,
                    at: destination(dims.current, to, p),
                    portal: anchor,
                    exact: false,
                },
            });
            let mut record = store.record(id, player, None);
            record.dimension = to;
            if let Err(e) = store.save(&record) {
                log::error!("could not save {id} for travel: {e}");
                player.travel.arrival = None;
                player.travel.in_portal = 0.0;
                continue;
            }
            player.travel.departed = true;
            log::info!("{id} travels {:?} -> {:?}", dims.current, to);
            send(&mut events, id, TRAVEL_EVENT, json!({ "world": world }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinates_scale_between_dimensions() {
        let down = destination(
            Dimension::Overworld,
            Dimension::Underworld,
            [800.0, 70.0, -160.0],
        );
        assert_eq!([down[0], down[2]], [100.0, -20.0]);
        let up = destination(
            Dimension::Underworld,
            Dimension::Overworld,
            [100.0, 40.0, -20.0],
        );
        assert_eq!([up[0], up[2]], [800.0, -160.0]);
        let dims = Dimensions {
            current: Dimension::Underworld,
            worlds: Arc::new(HashMap::new()),
            links: Arc::new(std::sync::Mutex::new(PortalLinks::in_memory())),
            land: Default::default(),
            guilds: Default::default(),
            vaults: Default::default(),
            bridge: None,
        };
        assert_eq!(dims.world_of(Dimension::Overworld), None);
        let r = heights(Dimension::Underworld, 40);
        assert!(r.start > Underworld::LAVA_LEVEL && r.end < Underworld::ROOF);
        let sky = destination(Dimension::Overworld, Dimension::Sky, [50.0, 70.0, -9.0]);
        assert_eq!([sky[0], sky[2]], [50.0, -9.0], "the sky is not scaled");
    }

    #[test]
    fn sky_arrivals_land_on_the_nearest_island() {
        // An island covering x >= 10.
        let island = |x: i32, _z: i32| (x >= 10).then_some(96);
        assert_eq!(sky_landing(0, 0, island), Some((10, 0, 97)));
        assert_eq!(sky_landing(0, 0, |_, _| None), None, "open void");
        assert_eq!(sky_landing(12, 3, island), Some((12, 3, 97)));
    }

    #[test]
    fn portal_links_pair_up_relink_and_persist() {
        let dir = std::env::temp_dir().join(format!("portal-links-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let end = |d, x| End {
            dimension: d,
            at: [x, 64, 0],
        };
        let (o1, u1, u2) = (
            end(Dimension::Overworld, 80),
            end(Dimension::Underworld, 10),
            end(Dimension::Underworld, 30),
        );
        let mut links = PortalLinks::load(&dir).unwrap();
        links.link(o1, u1).unwrap();
        assert_eq!(links.partner(&o1), Some(u1));
        assert_eq!(links.partner(&u1), Some(o1));
        // Relinking the overworld portal drops its old partner's link.
        links.link(o1, u2).unwrap();
        assert_eq!(links.partner(&u1), None);
        let reloaded = PortalLinks::load(&dir).unwrap();
        assert_eq!(reloaded.partner(&u2), Some(o1));
        assert_eq!(reloaded.partner(&o1), Some(u2));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
