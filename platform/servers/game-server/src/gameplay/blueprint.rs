//! Blueprints in the game: capturing a box of blocks into a layout the
//! backend stores and sells, and building a licensed blueprint from the
//! player's own materials.
//!
//! A layout is `{ "format": 1, "size": [x, y, z], "palette": [{ "block": key | null, "raw": bits }], "runs": [[index, count]] }`
//! with runs walking the box x-major, then y, then z. Only blocks a player
//! could place (an item places them; no fluids) are captured; everything
//! else is captured as air. Building checks the whole box first (loaded,
//! land permission, free cells, no players inside, materials) and then
//! changes it all at once, consuming the materials: all or nothing.

use std::collections::{BTreeMap, HashMap};

use platform_content::Content;
use platform_ticket::Realm;
use serde::Deserialize;
use serde_json::{json, Value};
use voxelize::{BlockUtils, World};

use super::bridge::Request;
use super::land::Action;
use super::rules::{IntentError, WorldView};
use super::{client_position, now_ms, parse, reply, with_player, Gameplay};

pub const MAX_SIDE: i32 = 32;
/// How far from the player's position a captured or built box may be.
pub const MAX_DISTANCE: f32 = 64.0;

/// The block a palette entry stands for, if a player could place it.
fn placeable(content: &Content, id: u32) -> Option<&str> {
    let block = content.block_by_id(id)?;
    if block.fluid.is_some() || id == 0 {
        return None;
    }
    content
        .items()
        .iter()
        .any(|i| i.places_block.as_deref() == Some(block.key.as_str()))
        .then_some(block.key.as_str())
}

/// The item that places a block key.
fn item_for<'a>(content: &'a Content, block: &str) -> Option<&'a platform_content::ItemDef> {
    content
        .items()
        .iter()
        .find(|i| i.places_block.as_deref() == Some(block))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Captured {
    pub size: [i32; 3],
    pub palette: Vec<(Option<String>, u32)>,
    pub runs: Vec<(usize, u32)>,
    pub materials: BTreeMap<String, u32>,
    pub blocks: u32,
}

/// Capture the box `min..=max` read through `raw_at` (`None`: not loaded).
pub fn capture(
    content: &Content,
    min: [i32; 3],
    max: [i32; 3],
    raw_at: impl Fn([i32; 3]) -> Option<u32>,
) -> Result<Captured, IntentError> {
    let size = [
        max[0] - min[0] + 1,
        max[1] - min[1] + 1,
        max[2] - min[2] + 1,
    ];
    if size.iter().any(|&s| !(1..=MAX_SIDE).contains(&s)) {
        return Err(IntentError::BadBlueprint);
    }
    let mut palette: Vec<(Option<String>, u32)> = vec![(None, 0)];
    let mut index: HashMap<u32, usize> = HashMap::new();
    let mut runs: Vec<(usize, u32)> = Vec::new();
    let mut materials: BTreeMap<String, u32> = BTreeMap::new();
    let mut blocks = 0;
    for x in 0..size[0] {
        for y in 0..size[1] {
            for z in 0..size[2] {
                let raw =
                    raw_at([min[0] + x, min[1] + y, min[2] + z]).ok_or(IntentError::NotLoaded)?;
                let entry = match placeable(content, BlockUtils::extract_id(raw)) {
                    None => 0,
                    Some(key) => {
                        blocks += 1;
                        if let Some(item) = item_for(content, key) {
                            *materials.entry(item.key.clone()).or_default() += 1;
                        }
                        *index.entry(raw).or_insert_with(|| {
                            palette.push((Some(key.to_owned()), raw));
                            palette.len() - 1
                        })
                    }
                };
                match runs.last_mut() {
                    Some((i, n)) if *i == entry => *n += 1,
                    _ => runs.push((entry, 1)),
                }
            }
        }
    }
    if blocks == 0 {
        return Err(IntentError::BadBlueprint);
    }
    Ok(Captured {
        size,
        palette,
        runs,
        materials,
        blocks,
    })
}

#[derive(Debug, Deserialize)]
struct Layout {
    format: u32,
    size: [i32; 3],
    palette: Vec<PaletteEntry>,
    runs: Vec<(usize, u32)>,
}

#[derive(Debug, Deserialize)]
struct PaletteEntry {
    block: Option<String>,
    raw: u32,
}

/// The blocks of a layout as `(offset, raw voxel)`, checked against the
/// content pack: every block must exist and keep its own id.
pub fn decode(
    content: &Content,
    layout: &Value,
) -> Result<(Vec<([i32; 3], u32)>, [i32; 3]), IntentError> {
    let layout: Layout =
        serde_json::from_value(layout.clone()).map_err(|_| IntentError::BadBlueprint)?;
    if layout.format != 1 || layout.size.iter().any(|&s| !(1..=MAX_SIDE).contains(&s)) {
        return Err(IntentError::BadBlueprint);
    }
    let mut raws = Vec::with_capacity(layout.palette.len());
    for entry in &layout.palette {
        raws.push(match &entry.block {
            None => None,
            Some(key) => {
                let block = content.block(key).ok_or(IntentError::BadBlueprint)?;
                // Ids are stable; the bits beyond the id carry rotation and stage.
                Some((entry.raw & !0xFFFF) | block.id)
            }
        });
    }
    let [sx, sy, sz] = layout.size;
    let total = (sx * sy * sz) as u64;
    let mut cells = Vec::new();
    let mut i: u64 = 0;
    for (entry, count) in layout.runs {
        let raw = *raws.get(entry).ok_or(IntentError::BadBlueprint)?;
        for _ in 0..count {
            if i >= total {
                return Err(IntentError::BadBlueprint);
            }
            if let Some(raw) = raw {
                let (x, rest) = ((i / (sy * sz) as u64) as i32, i % (sy * sz) as u64);
                let (y, z) = ((rest / sz as u64) as i32, (rest % sz as u64) as i32);
                cells.push(([x, y, z], raw));
            }
            i += 1;
        }
    }
    if i != total {
        return Err(IntentError::BadBlueprint);
    }
    Ok((cells, layout.size))
}

/// Items needed to build these blocks, by item id.
pub fn bill(
    content: &Content,
    cells: &[([i32; 3], u32)],
) -> Result<BTreeMap<u32, u32>, IntentError> {
    let mut need = BTreeMap::new();
    for (_, raw) in cells {
        let block = content
            .block_by_id(BlockUtils::extract_id(*raw))
            .ok_or(IntentError::BadBlueprint)?;
        let item = item_for(content, &block.key).ok_or(IntentError::BadBlueprint)?;
        *need.entry(item.id).or_default() += 1;
    }
    Ok(need)
}

fn far(position: [f32; 3], min: [i32; 3], size: [i32; 3]) -> bool {
    let center = [
        min[0] as f32 + size[0] as f32 / 2.0,
        min[1] as f32 + size[1] as f32 / 2.0,
        min[2] as f32 + size[2] as f32 / 2.0,
    ];
    (0..3)
        .map(|i| (center[i] - position[i]).powi(2))
        .sum::<f32>()
        > MAX_DISTANCE * MAX_DISTANCE
}

/// Whether `player` may build everywhere in the box.
fn land_allows_box(g: &Gameplay, player: &str, min: [i32; 3], size: [i32; 3]) -> bool {
    let dimension = g.dimensions.current;
    let Ok(index) = g.dimensions.land.read() else {
        return false;
    };
    let step = super::land::LAND_CHUNK as usize;
    let xs: Vec<i32> = (min[0]..min[0] + size[0])
        .step_by(step)
        .chain([min[0] + size[0] - 1])
        .collect();
    let zs: Vec<i32> = (min[2]..min[2] + size[2])
        .step_by(step)
        .chain([min[2] + size[2] - 1])
        .collect();
    xs.iter().all(|&x| {
        zs.iter()
            .all(|&z| index.allows(dimension, player, [x, min[1], z], Action::Build))
    })
}

/// Check the box and the materials, then take the materials and return the
/// writes. Nothing changes unless everything is in order.
pub fn plan_build(
    g: &mut Gameplay,
    player_id: &str,
    view: &dyn WorldView,
    at: [i32; 3],
    cells: &[([i32; 3], u32)],
    size: [i32; 3],
) -> Result<Vec<([i32; 3], u32)>, IntentError> {
    if !land_allows_box(g, player_id, at, size) {
        return Err(IntentError::LandProtected);
    }
    let content = g.rules.content_arc();
    let mut writes = Vec::with_capacity(cells.len());
    for (offset, raw) in cells {
        let p = [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]];
        let here = view.block_at(p).ok_or(IntentError::NotLoaded)?;
        let free = here == 0
            || content
                .block_by_id(here)
                .is_some_and(|b| b.fluid.is_some() || (!b.collision && b.hardness == 0.0));
        if !free {
            return Err(IntentError::Occupied);
        }
        let solid = content
            .block_by_id(BlockUtils::extract_id(*raw))
            .is_some_and(|b| b.collision);
        if solid && view.players_overlap(p) {
            return Err(IntentError::CollidesWithPlayer);
        }
        writes.push((p, *raw));
    }
    let need = bill(&content, cells)?;
    let player = g
        .players
        .get_mut(player_id)
        .ok_or(IntentError::NothingThere)?;
    if player.vitals.is_dead() {
        return Err(IntentError::Dead);
    }
    if player.realm == Realm::Survival {
        if need
            .iter()
            .any(|(&item, &count)| player.inventory.count_of(item) < count)
        {
            return Err(IntentError::MissingIngredients);
        }
        for (&item, &count) in &need {
            player.inventory.remove(item, count);
        }
    }
    Ok(writes)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapturePayload {
    min: [i32; 3],
    max: [i32; 3],
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BuildPayload {
    id: String,
    at: [i32; 3],
}

pub fn install(world: &mut World) {
    world.set_method_handle("platform.blueprint.capture", |world, id, payload| {
        const INTENT: &str = "blueprint.capture";
        let Some(p) = parse::<CapturePayload>(world, id, INTENT, payload) else {
            return;
        };
        let min = [p.min[0].min(p.max[0]), p.min[1].min(p.max[1]), p.min[2].min(p.max[2])];
        let max = [p.min[0].max(p.max[0]), p.min[1].max(p.max[1]), p.min[2].max(p.max[2])];
        let name = p.name.trim().chars().take(64).collect::<String>();
        let result = with_player(world, id, |g, view, position| {
            let (Some(bridge), Some(world_name)) = (
                g.dimensions.bridge.clone(),
                g.dimensions.world_of(g.dimensions.current).map(str::to_owned),
            ) else {
                return Err(IntentError::MarketUnavailable);
            };
            if name.is_empty() {
                return Err(IntentError::BadBlueprint);
            }
            let size = [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];
            if far(position, min, size) {
                return Err(IntentError::OutOfReach);
            }
            // Only what you may build on is yours to capture.
            if !land_allows_box(g, id, min, size) {
                return Err(IntentError::LandProtected);
            }
            let captured = capture(g.rules.content(), min, max, |p| view.raw_at(p))?;
            let key = format!("b{:x}{:012x}", now_ms(), (g.random() * 2f64.powi(48)) as u64);
            let body = json!({
                "key": key,
                "creator": id,
                "world": bridge.shard,
                "name": name,
                "size": captured.size,
                "palette": captured.palette.iter().map(|(b, raw)| json!({ "block": b, "raw": raw })).collect::<Vec<_>>(),
                "runs": captured.runs.iter().map(|(i, n)| json!([i, n])).collect::<Vec<_>>(),
                "materials": captured.materials,
            });
            bridge.request(Request::UploadBlueprint {
                world: world_name,
                player: id.to_owned(),
                body,
            });
            Ok(captured)
        });
        match result {
            None => super::not_joined(world, id, INTENT),
            Some(Ok(c)) => reply(world, id, INTENT, Ok(json!({ "blocks": c.blocks, "size": c.size, "materials": c.materials }))),
            Some(Err(e)) => reply(world, id, INTENT, Err(e)),
        }
    });

    world.set_method_handle("platform.blueprint.build", |world, id, payload| {
        const INTENT: &str = "blueprint.build";
        let Some(p) = parse::<BuildPayload>(world, id, INTENT, payload) else {
            return;
        };
        if !p.id.chars().all(|c| c.is_ascii_alphanumeric()) || p.id.len() > 40 {
            reply(world, id, INTENT, Err(IntentError::BadBlueprint));
            return;
        }
        let position = client_position(world, id);
        let result = with_player(world, id, |g, _, _| {
            let (Some(bridge), Some(world_name)) = (
                g.dimensions.bridge.clone(),
                g.dimensions
                    .world_of(g.dimensions.current)
                    .map(str::to_owned),
            ) else {
                return Err(IntentError::MarketUnavailable);
            };
            if position.is_none_or(|pos| far(pos, p.at, [1, 1, 1])) {
                return Err(IntentError::OutOfReach);
            }
            let player = g.players.get_mut(id).expect("checked by with_player");
            if player.vitals.is_dead() {
                return Err(IntentError::Dead);
            }
            bridge.request(Request::FetchBlueprint {
                world: world_name,
                player: id.to_owned(),
                id: p.id.clone(),
                at: p.at,
            });
            Ok(())
        });
        match result {
            None => super::not_joined(world, id, INTENT),
            Some(Ok(())) => reply(world, id, INTENT, Ok(json!({ "pending": p.id }))),
            Some(Err(e)) => reply(world, id, INTENT, Err(e)),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content() -> Content {
        Content::load(platform_content::default_pack_dir()).unwrap()
    }

    #[test]
    fn capture_and_decode_round_trip_with_rotation_and_a_bill() {
        let c = content();
        let planks = c.block("planks").unwrap().id;
        let water = c.block("water").unwrap().id;
        let furnace = BlockUtils::insert_rotation(
            c.block("furnace").unwrap().id,
            &voxelize::BlockRotation::encode(0, 4),
        );
        let world: HashMap<[i32; 3], u32> = HashMap::from([
            ([10, 5, 10], planks),
            ([11, 5, 10], planks),
            ([10, 6, 11], furnace),
            ([11, 6, 11], water),
        ]);
        let cap = capture(&c, [10, 5, 10], [11, 6, 11], |p| {
            Some(*world.get(&p).unwrap_or(&0))
        })
        .unwrap();
        assert_eq!(cap.size, [2, 2, 2]);
        assert_eq!(cap.blocks, 3, "water is not captured");
        assert_eq!(cap.materials.get("planks"), Some(&2));
        assert_eq!(cap.materials.get("furnace"), Some(&1));

        let layout = json!({
            "format": 1, "size": cap.size,
            "palette": cap.palette.iter().map(|(b, raw)| json!({ "block": b, "raw": raw })).collect::<Vec<_>>(),
            "runs": cap.runs.iter().map(|(i, n)| json!([i, n])).collect::<Vec<_>>(),
        });
        let (cells, size) = decode(&c, &layout).unwrap();
        assert_eq!(size, [2, 2, 2]);
        let mut cells = cells;
        cells.sort();
        assert_eq!(
            cells,
            vec![
                ([0, 0, 0], planks),
                ([0, 1, 1], furnace),
                ([1, 0, 0], planks)
            ]
        );
        let need = bill(&c, &cells).unwrap();
        assert_eq!(need.get(&c.item("planks").unwrap().id), Some(&2));
    }

    #[test]
    fn bad_boxes_and_layouts_are_refused() {
        let c = content();
        assert_eq!(
            capture(&c, [0, 0, 0], [40, 0, 0], |_| Some(0)),
            Err(IntentError::BadBlueprint)
        );
        assert_eq!(
            capture(&c, [0, 0, 0], [3, 3, 3], |_| Some(0)),
            Err(IntentError::BadBlueprint),
            "empty"
        );
        assert_eq!(
            capture(&c, [0, 0, 0], [1, 1, 1], |_| None),
            Err(IntentError::NotLoaded)
        );
        let short = json!({ "format": 1, "size": [2, 1, 1], "palette": [{ "block": "planks", "raw": 12 }], "runs": [[0, 1]] });
        assert_eq!(decode(&c, &short), Err(IntentError::BadBlueprint));
        let unknown = json!({ "format": 1, "size": [1, 1, 1], "palette": [{ "block": "unobtainium", "raw": 0 }], "runs": [[0, 1]] });
        assert_eq!(decode(&c, &unknown), Err(IntentError::BadBlueprint));
    }
}
