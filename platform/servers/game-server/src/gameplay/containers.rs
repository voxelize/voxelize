//! Blocks that hold items: chests and furnaces (block entities).
//!
//! Contents live here keyed by block position and are saved to
//! `<world>/containers.json` with an atomic write. Breaking the block spills
//! its contents as dropped items, so nothing is ever destroyed with it.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use platform_content::Content;
use serde::{Deserialize, Serialize};

use super::inventory::Stack;

pub const CHEST_SIZE: usize = 27;
/// Furnace slots: input, fuel, output.
pub const FURNACE_INPUT: usize = 0;
pub const FURNACE_FUEL: usize = 1;
pub const FURNACE_OUTPUT: usize = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Furnace {
    pub slots: Vec<Option<Stack>>,
    /// Game ticks of fuel left in the current burn.
    pub burn_left: u32,
    /// Length of the current burn, for the flame gauge.
    pub burn_total: u32,
    /// Game ticks of progress on the current item.
    pub progress: u32,
}

impl Default for Furnace {
    fn default() -> Self {
        Self {
            slots: vec![None; 3],
            burn_left: 0,
            burn_total: 0,
            progress: 0,
        }
    }
}

impl Furnace {
    pub fn is_lit(&self) -> bool {
        self.burn_left > 0
    }

    /// Ticks the current input needs, if it can be smelted at all.
    pub fn recipe_ticks(&self, content: &Content) -> Option<u32> {
        let input = self.slots[FURNACE_INPUT].as_ref()?;
        let key = &content.item_by_id(input.item)?.key;
        content.processing_for("furnace", key).map(|r| r.ticks)
    }

    fn can_smelt(&self, content: &Content) -> bool {
        let Some(input) = self.slots[FURNACE_INPUT].as_ref() else {
            return false;
        };
        let Some(item) = content.item_by_id(input.item) else {
            return false;
        };
        let Some(recipe) = content.processing_for("furnace", &item.key) else {
            return false;
        };
        if input.count < recipe.input.count {
            return false;
        }
        let Some(out) = content.item(&recipe.output.item) else {
            return false;
        };
        match &self.slots[FURNACE_OUTPUT] {
            None => true,
            Some(o) => o.item == out.id && o.count + recipe.output.count <= out.stack_size,
        }
    }

    /// Advance one game tick. Returns whether anything visible changed.
    pub fn tick(&mut self, content: &Content) -> bool {
        let before = (self.burn_left > 0, self.progress, self.slots.clone());
        let can = self.can_smelt(content);

        if self.burn_left == 0 && can {
            if let Some(fuel) = self.slots[FURNACE_FUEL].as_mut() {
                let ticks = content
                    .item_by_id(fuel.item)
                    .and_then(|i| content.fuel_ticks(&i.key));
                if let Some(ticks) = ticks {
                    fuel.count -= 1;
                    if fuel.count == 0 {
                        self.slots[FURNACE_FUEL] = None;
                    }
                    self.burn_left = ticks;
                    self.burn_total = ticks;
                }
            }
        }

        if self.burn_left > 0 {
            self.burn_left -= 1;
            if can {
                self.progress += 1;
                let needed = self.recipe_ticks(content).unwrap_or(u32::MAX);
                if self.progress >= needed {
                    self.progress = 0;
                    self.smelt_one(content);
                }
            } else {
                self.progress = 0;
            }
        } else {
            self.progress = self.progress.saturating_sub(2);
        }
        before != (self.burn_left > 0, self.progress, self.slots.clone())
    }

    fn smelt_one(&mut self, content: &Content) {
        let input = self.slots[FURNACE_INPUT]
            .as_mut()
            .expect("can_smelt checked");
        let item = content.item_by_id(input.item).expect("known item");
        let recipe = content
            .processing_for("furnace", &item.key)
            .expect("recipe");
        input.count -= recipe.input.count;
        if input.count == 0 {
            self.slots[FURNACE_INPUT] = None;
        }
        let out = content
            .item(&recipe.output.item)
            .expect("validated content");
        match self.slots[FURNACE_OUTPUT].as_mut() {
            Some(o) => o.count += recipe.output.count,
            None => {
                self.slots[FURNACE_OUTPUT] = Some(Stack {
                    item: out.id,
                    count: recipe.output.count,
                    durability: out.durability,
                })
            }
        }
    }
}

/// Loot for a chest generated inside structure number `stage - 1`,
/// deterministic for its position so it cannot be re-rolled.
pub fn structure_loot(content: &Content, stage: u32, at: [i32; 3]) -> Vec<Option<Stack>> {
    let mut slots = vec![None; CHEST_SIZE];
    let Some(st) = stage
        .checked_sub(1)
        .and_then(|i| content.structures().get(i as usize))
    else {
        return slots;
    };
    let mut h = (at[0] as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (at[1] as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F)
        ^ (at[2] as u64).wrapping_mul(0x1656_67B1_9E37_79F9);
    let mut next = || {
        h = h.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = h;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    };
    for drop in &st.loot {
        if (next() >> 11) as f64 / (1u64 << 53) as f64 >= drop.chance as f64 {
            continue;
        }
        let Some(item) = content.item(&drop.item) else {
            continue;
        };
        let count = drop.min + (next() % (drop.max - drop.min + 1) as u64) as u32;
        if count == 0 {
            continue;
        }
        // A random free slot, so chests do not all look alike.
        for _ in 0..CHEST_SIZE {
            let slot = (next() % CHEST_SIZE as u64) as usize;
            if slots[slot].is_none() {
                slots[slot] = Some(Stack {
                    item: item.id,
                    count: count.min(item.stack_size),
                    durability: item.durability,
                });
                break;
            }
        }
    }
    slots
}

/// Slots of a trade stall.
pub const STALL_SIZE: usize = 9;

/// A player's shop in the world: stock, a price per slot, and sales whose
/// payment is on its way (their goods are set aside, out of the stock).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stall {
    pub owner: String,
    #[serde(default)]
    pub owner_name: String,
    /// Stalls placed in creative never sell: creative goods stay out of
    /// the economy.
    #[serde(default)]
    pub creative: bool,
    pub slots: Vec<Option<Stack>>,
    /// Price per slot in whole Crowns; 0 is not for sale.
    pub prices: Vec<u64>,
    #[serde(default)]
    pub sales: Vec<StallSale>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StallSale {
    /// Payment idempotency key.
    pub key: String,
    pub slot: usize,
    pub buyer: String,
    pub price: u64,
    pub stack: Stack,
    /// The backend took the money; the goods are the buyer's.
    #[serde(default)]
    pub paid: bool,
}

impl Stall {
    pub fn new(owner: &str, owner_name: &str, creative: bool) -> Self {
        Self {
            owner: owner.to_owned(),
            owner_name: owner_name.to_owned(),
            creative,
            slots: vec![None; STALL_SIZE],
            prices: vec![0; STALL_SIZE],
            sales: Vec::new(),
        }
    }

    /// Put goods back after a refused payment: their slot, any free slot,
    /// or (stock full) hand them back to drop.
    pub fn restock(&mut self, slot: usize, stack: Stack) -> Option<Stack> {
        if let Some(cell) = self.slots.get_mut(slot).filter(|c| c.is_none()) {
            *cell = Some(stack);
            return None;
        }
        match self.slots.iter_mut().find(|c| c.is_none()) {
            Some(cell) => {
                *cell = Some(stack);
                None
            }
            None => Some(stack),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Container {
    Chest { slots: Vec<Option<Stack>> },
    Furnace(Furnace),
    Stall(Stall),
}

impl Container {
    /// A fresh container for a block key, if that block holds items.
    pub fn for_block(key: &str) -> Option<Self> {
        match key {
            "chest" => Some(Container::Chest {
                slots: vec![None; CHEST_SIZE],
            }),
            "furnace" => Some(Container::Furnace(Furnace::default())),
            _ => None,
        }
    }

    pub fn slots(&self) -> &[Option<Stack>] {
        match self {
            Container::Chest { slots } => slots,
            Container::Furnace(f) => &f.slots,
            Container::Stall(s) => &s.slots,
        }
    }

    pub fn slots_mut(&mut self) -> &mut Vec<Option<Stack>> {
        match self {
            Container::Chest { slots } => slots,
            Container::Furnace(f) => &mut f.slots,
            Container::Stall(s) => &mut s.slots,
        }
    }

    /// Everything inside, emptied out (for spilling when broken).
    pub fn take_all(&mut self) -> Vec<Stack> {
        self.slots_mut()
            .iter_mut()
            .filter_map(|s| s.take())
            .collect()
    }
}

/// Containers of one world, persisted as one JSON file.
#[derive(Debug, Default)]
pub struct Containers {
    pub map: HashMap<[i32; 3], Container>,
    pub dirty: bool,
}

#[derive(Serialize, Deserialize)]
struct ContainersFile {
    version: u32,
    containers: Vec<([i32; 3], Container)>,
}

fn file(world_dir: &Path) -> PathBuf {
    world_dir.join("containers.json")
}

impl Containers {
    pub fn load(world_dir: &Path) -> Result<Self, String> {
        let path = file(world_dir);
        let text = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        let parsed: ContainersFile =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        if parsed.version != 1 {
            return Err(format!(
                "{}: unsupported version {}",
                path.display(),
                parsed.version
            ));
        }
        Ok(Self {
            map: parsed.containers.into_iter().collect(),
            dirty: false,
        })
    }

    pub fn save(&mut self, world_dir: &Path) -> Result<(), String> {
        let path = file(world_dir);
        let mut entries: Vec<([i32; 3], Container)> =
            self.map.iter().map(|(k, v)| (*k, v.clone())).collect();
        entries.sort_by_key(|(k, _)| *k);
        let bytes = serde_json::to_vec(&ContainersFile {
            version: 1,
            containers: entries,
        })
        .map_err(|e| e.to_string())?;
        fs::create_dir_all(world_dir).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        let result = (|| {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(&bytes)?;
            f.sync_all()?;
            fs::rename(&tmp, &path)
        })();
        if let Err(e) = result {
            let _ = fs::remove_file(&tmp);
            return Err(format!("{}: {e}", path.display()));
        }
        self.dirty = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content() -> Content {
        Content::load(platform_content::default_pack_dir()).unwrap()
    }

    fn st(c: &Content, key: &str, count: u32) -> Option<Stack> {
        let item = c.item(key).unwrap();
        Some(Stack {
            item: item.id,
            count,
            durability: item.durability,
        })
    }

    #[test]
    fn furnace_smelts_with_fuel_and_stops_without() {
        let c = content();
        let mut f = Furnace::default();
        f.slots[FURNACE_INPUT] = st(&c, "raw_iron", 3);
        for _ in 0..1000 {
            f.tick(&c);
        }
        assert!(f.slots[FURNACE_OUTPUT].is_none(), "no fuel, no smelting");

        f.slots[FURNACE_FUEL] = st(&c, "planks", 1); // 300 ticks: one item
        for _ in 0..200 {
            f.tick(&c);
        }
        assert_eq!(f.slots[FURNACE_OUTPUT], st(&c, "iron_ingot", 1));
        assert!(f.slots[FURNACE_FUEL].is_none());
        for _ in 0..1000 {
            f.tick(&c);
        }
        assert_eq!(
            f.slots[FURNACE_OUTPUT],
            st(&c, "iron_ingot", 1),
            "fuel ran out"
        );
        assert_eq!(f.slots[FURNACE_INPUT].as_ref().unwrap().count, 2);

        f.slots[FURNACE_FUEL] = st(&c, "coal", 1);
        for _ in 0..400 {
            f.tick(&c);
        }
        assert_eq!(f.slots[FURNACE_OUTPUT], st(&c, "iron_ingot", 3));
        assert!(f.is_lit(), "coal keeps burning after the input runs out");
    }

    #[test]
    fn fuel_is_not_wasted_without_something_to_smelt() {
        let c = content();
        let mut f = Furnace::default();
        f.slots[FURNACE_FUEL] = st(&c, "coal", 2);
        f.slots[FURNACE_INPUT] = st(&c, "dirt", 5);
        for _ in 0..100 {
            f.tick(&c);
        }
        assert_eq!(f.slots[FURNACE_FUEL], st(&c, "coal", 2));
        assert!(!f.is_lit());
    }

    #[test]
    fn a_full_output_stops_smelting() {
        let c = content();
        let mut f = Furnace::default();
        f.slots[FURNACE_INPUT] = st(&c, "raw_iron", 2);
        f.slots[FURNACE_FUEL] = st(&c, "coal", 1);
        f.slots[FURNACE_OUTPUT] = st(&c, "iron_ingot", 64);
        for _ in 0..500 {
            f.tick(&c);
        }
        assert_eq!(f.slots[FURNACE_INPUT], st(&c, "raw_iron", 2));
        assert_eq!(f.slots[FURNACE_FUEL], st(&c, "coal", 1));
    }

    #[test]
    fn structure_loot_is_fixed_per_position_and_respects_the_table() {
        let c = content();
        let hut = c
            .structures()
            .iter()
            .position(|s| s.key == "wayfarer_hut")
            .unwrap() as u32
            + 1;
        let a = structure_loot(&c, hut, [10, 70, -4]);
        assert_eq!(a, structure_loot(&c, hut, [10, 70, -4]));
        let allowed: Vec<u32> = c.structures()[hut as usize - 1]
            .loot
            .iter()
            .map(|d| c.item(&d.item).unwrap().id)
            .collect();
        assert!(a.iter().flatten().all(|s| allowed.contains(&s.item)));
        let filled = (0..40)
            .filter(|i| {
                structure_loot(&c, hut, [*i, 70, 0])
                    .iter()
                    .any(Option::is_some)
            })
            .count();
        assert!(filled > 30, "most chests hold something: {filled}/40");
        assert!(
            structure_loot(&c, 0, [0, 0, 0]).iter().all(Option::is_none),
            "stage 0 is not loot"
        );
    }

    #[test]
    fn containers_round_trip_on_disk() {
        let c = content();
        let dir = std::env::temp_dir().join(format!("platform-containers-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut all = Containers::default();
        let mut chest = Container::for_block("chest").unwrap();
        chest.slots_mut()[4] = st(&c, "gold_ingot", 9);
        all.map.insert([1, 64, -2], chest.clone());
        all.map
            .insert([5, 70, 5], Container::for_block("furnace").unwrap());
        all.save(&dir).unwrap();
        let loaded = Containers::load(&dir).unwrap();
        assert_eq!(loaded.map.get(&[1, 64, -2]), Some(&chest));
        assert_eq!(loaded.map.len(), 2);
        assert!(Container::for_block("dirt").is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
