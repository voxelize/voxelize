//! Validation of player intents: mining, placing and crafting.
//!
//! Pure logic over a [`WorldView`], so every rule is unit-tested without an
//! engine world. The engine wiring in `mod.rs` supplies the view, applies
//! the returned voxel change and persists the player afterwards.

use std::sync::Arc;

use platform_content::{
    match_recipe, mining_rule, BlockDef, Content, CraftingGrid, ItemDef, MiningModifiers,
    MiningRule,
};
use platform_ticket::Realm;
use serde::{Deserialize, Serialize};

use super::inventory::{Inventory, InventoryError};

pub const AIR: u32 = 0;

/// What the rules need to know about the world around an intent.
pub trait WorldView {
    /// Block id at a voxel, `None` when its chunk is not loaded.
    fn block_at(&self, voxel: [i32; 3]) -> Option<u32>;
    /// Whether any player's body overlaps the voxel cell.
    fn players_overlap(&self, voxel: [i32; 3]) -> bool;
    /// Whether a block of the given id lies within `radius` of `voxel`.
    fn block_nearby(&self, voxel: [i32; 3], block: u32, radius: i32) -> bool;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentError {
    OutOfReach,
    NotLoaded,
    NothingThere,
    Unbreakable,
    NoSession,
    WrongBlock,
    TooFast,
    InventoryFull,
    NotPlaceable,
    Occupied,
    CollidesWithPlayer,
    UnknownBlock,
    NoRecipe,
    MissingIngredients,
    NeedsWorkbench,
    Inventory(InventoryError),
}

impl IntentError {
    pub fn code(&self) -> &'static str {
        match self {
            IntentError::OutOfReach => "out_of_reach",
            IntentError::NotLoaded => "not_loaded",
            IntentError::NothingThere => "nothing_there",
            IntentError::Unbreakable => "unbreakable",
            IntentError::NoSession => "no_mining_session",
            IntentError::WrongBlock => "wrong_block",
            IntentError::TooFast => "too_fast",
            IntentError::InventoryFull => "inventory_full",
            IntentError::NotPlaceable => "not_placeable",
            IntentError::Occupied => "occupied",
            IntentError::CollidesWithPlayer => "collides_with_player",
            IntentError::UnknownBlock => "unknown_block",
            IntentError::NoRecipe => "no_recipe",
            IntentError::MissingIngredients => "missing_ingredients",
            IntentError::NeedsWorkbench => "needs_workbench",
            IntentError::Inventory(e) => e.code(),
        }
    }
}

impl From<InventoryError> for IntentError {
    fn from(e: InventoryError) -> Self {
        IntentError::Inventory(e)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MiningSession {
    pub voxel: [i32; 3],
    pub block: u32,
    pub started_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerState {
    pub inventory: Inventory,
    pub mining: Option<MiningSession>,
    pub realm: Realm,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MineOutcome {
    pub harvested: bool,
    /// `(item id, count)` added to the inventory.
    pub drops: Vec<(u32, u32)>,
    pub tool_broke: bool,
}

pub struct Rules {
    content: Arc<Content>,
    /// Maximum distance, in blocks, from the reported player position to the
    /// centre of a targeted voxel. Generous enough to cover the eye/feet
    /// ambiguity of reported positions plus network lag.
    pub reach: f32,
    /// Fraction of the nominal mining time a finish may arrive early by
    /// (network jitter). 0.8 accepts a finish 20 % early.
    pub timing_tolerance: f32,
    /// Radius in which a workbench enables 3x3 crafting.
    pub workbench_radius: i32,
}

impl Rules {
    pub fn new(content: Arc<Content>) -> Self {
        Self {
            content,
            reach: 7.5,
            timing_tolerance: 0.8,
            workbench_radius: 4,
        }
    }

    pub fn content(&self) -> &Content {
        &self.content
    }

    fn within_reach(&self, position: [f32; 3], voxel: [i32; 3]) -> bool {
        let d2: f32 = (0..3)
            .map(|i| {
                let d = voxel[i] as f32 + 0.5 - position[i];
                d * d
            })
            .sum();
        d2 <= self.reach * self.reach
    }

    fn held_item(&self, player: &PlayerState) -> Option<&ItemDef> {
        player
            .inventory
            .selected_stack()
            .and_then(|s| self.content.item_by_id(s.item))
    }

    fn target_block(
        &self,
        view: &dyn WorldView,
        position: [f32; 3],
        voxel: [i32; 3],
    ) -> Result<(u32, &BlockDef), IntentError> {
        if !self.within_reach(position, voxel) {
            return Err(IntentError::OutOfReach);
        }
        let id = view.block_at(voxel).ok_or(IntentError::NotLoaded)?;
        if id == AIR {
            return Err(IntentError::NothingThere);
        }
        let block = self
            .content
            .block_by_id(id)
            .ok_or(IntentError::UnknownBlock)?;
        if block.fluid.is_some() {
            return Err(IntentError::NothingThere);
        }
        Ok((id, block))
    }

    pub fn start_mining(
        &self,
        player: &mut PlayerState,
        view: &dyn WorldView,
        position: [f32; 3],
        voxel: [i32; 3],
        now_ms: u64,
    ) -> Result<(), IntentError> {
        let (id, block) = self.target_block(view, position, voxel)?;
        if player.realm == Realm::Survival && block.hardness < 0.0 {
            return Err(IntentError::Unbreakable);
        }
        player.mining = Some(MiningSession {
            voxel,
            block: id,
            started_ms: now_ms,
        });
        Ok(())
    }

    /// Validate a finished break. On success the caller sets the voxel to
    /// air; the drops are already in the inventory.
    pub fn finish_mining(
        &self,
        player: &mut PlayerState,
        view: &dyn WorldView,
        position: [f32; 3],
        voxel: [i32; 3],
        now_ms: u64,
        random: &mut dyn FnMut() -> f64,
    ) -> Result<MineOutcome, IntentError> {
        let (id, block) = self.target_block(view, position, voxel)?;

        if player.realm == Realm::Creative {
            player.mining = None;
            return Ok(MineOutcome {
                harvested: false,
                drops: vec![],
                tool_broke: false,
            });
        }

        let session = player.mining.take().ok_or(IntentError::NoSession)?;
        if session.voxel != voxel {
            return Err(IntentError::NoSession);
        }
        if session.block != id {
            return Err(IntentError::WrongBlock);
        }
        // The fastest legitimate conditions (on the ground, dry): a client
        // may not claim to be faster than that.
        let rule = mining_rule(block, self.held_item(player), MiningModifiers::default());
        let harvests = match rule {
            MiningRule::Unbreakable => return Err(IntentError::Unbreakable),
            MiningRule::Breakable { harvests, .. } => harvests,
        };
        let min = rule
            .min_break_millis(self.timing_tolerance)
            .unwrap_or(u32::MAX) as u64;
        if now_ms.saturating_sub(session.started_ms) < min {
            // Keep the session: the client may simply be early.
            player.mining = Some(session);
            return Err(IntentError::TooFast);
        }

        let mut drops: Vec<(u32, u32)> = Vec::new();
        if harvests {
            for drop in &block.drops {
                if random() >= drop.chance as f64 {
                    continue;
                }
                let span = drop.max - drop.min + 1;
                let count = drop.min + ((random() * span as f64) as u32).min(span - 1);
                let item = self
                    .content
                    .item(&drop.item)
                    .map(|i| i.id)
                    .ok_or(IntentError::UnknownBlock)?;
                if count > 0 {
                    drops.push((item, count));
                }
            }
        }
        // Refuse the break rather than destroy drops that do not fit.
        let mut needed: Vec<(u32, u32)> = Vec::new();
        for &(item, count) in &drops {
            match needed.iter_mut().find(|(i, _)| *i == item) {
                Some(entry) => entry.1 += count,
                None => needed.push((item, count)),
            }
        }
        if needed
            .iter()
            .any(|&(item, count)| player.inventory.room_for(&self.content, item) < count)
        {
            return Err(IntentError::InventoryFull);
        }
        for &(item, count) in &drops {
            let left = player.inventory.add(&self.content, item, count);
            debug_assert_eq!(left, 0, "room was checked");
        }
        let tool_broke = block.hardness > 0.0 && player.inventory.wear_selected();
        Ok(MineOutcome {
            harvested: harvests,
            drops,
            tool_broke,
        })
    }

    /// Validate placing the item in `slot` (the selected slot when `None`)
    /// at `voxel`. In creative, `creative_block` names any block and nothing
    /// is consumed. Returns the block id to write.
    pub fn place(
        &self,
        player: &mut PlayerState,
        view: &dyn WorldView,
        position: [f32; 3],
        voxel: [i32; 3],
        slot: Option<usize>,
        creative_block: Option<&str>,
    ) -> Result<u32, IntentError> {
        if !self.within_reach(position, voxel) {
            return Err(IntentError::OutOfReach);
        }
        let current = view.block_at(voxel).ok_or(IntentError::NotLoaded)?;
        let replaceable = current == AIR
            || self
                .content
                .block_by_id(current)
                .is_some_and(|b| b.fluid.is_some() || (!b.collision && b.hardness == 0.0));
        if !replaceable {
            return Err(IntentError::Occupied);
        }

        let slot = slot.unwrap_or(player.inventory.selected);
        let block = match (player.realm, creative_block) {
            (Realm::Creative, Some(key)) => {
                self.content.block(key).ok_or(IntentError::UnknownBlock)?
            }
            _ => {
                let stack = player
                    .inventory
                    .get(slot)
                    .ok_or(IntentError::Inventory(InventoryError::EmptySlot))?;
                let item = self
                    .content
                    .item_by_id(stack.item)
                    .ok_or(IntentError::NotPlaceable)?;
                let key = item
                    .places_block
                    .as_deref()
                    .ok_or(IntentError::NotPlaceable)?;
                self.content.block(key).ok_or(IntentError::NotPlaceable)?
            }
        };
        if block.collision && view.players_overlap(voxel) {
            return Err(IntentError::CollidesWithPlayer);
        }
        if player.realm == Realm::Survival {
            player.inventory.take_one(slot)?;
        }
        Ok(block.id)
    }

    /// Craft once from a grid of item keys, taking the ingredients from the
    /// inventory. A 3x3 grid needs a workbench within reach.
    pub fn craft(
        &self,
        player: &mut PlayerState,
        view: &dyn WorldView,
        position: [f32; 3],
        grid: &CraftingGrid,
    ) -> Result<(u32, u32), IntentError> {
        if grid.size() > 2 {
            let table = self
                .content
                .block("crafting_table")
                .map(|b| b.id)
                .ok_or(IntentError::NeedsWorkbench)?;
            let at = position.map(|v| v.floor() as i32);
            if !view.block_nearby(at, table, self.workbench_radius) {
                return Err(IntentError::NeedsWorkbench);
            }
        }
        let found = match_recipe(&self.content, grid).ok_or(IntentError::NoRecipe)?;

        let mut needed: Vec<(u32, u32)> = Vec::new();
        for &(x, y) in &found.consumed {
            let key = grid.get(x, y).ok_or(IntentError::NoRecipe)?;
            let item = self.content.item(key).ok_or(IntentError::NoRecipe)?.id;
            match needed.iter_mut().find(|(i, _)| *i == item) {
                Some(entry) => entry.1 += 1,
                None => needed.push((item, 1)),
            }
        }
        if needed
            .iter()
            .any(|&(item, count)| player.inventory.count_of(item) < count)
        {
            return Err(IntentError::MissingIngredients);
        }
        let result = self
            .content
            .item(&found.result.item)
            .ok_or(IntentError::NoRecipe)?
            .id;
        let count = found.result.count;

        // Check the result fits once the ingredients are gone, on a copy, so
        // a failed craft changes nothing.
        let mut after = player.inventory.clone();
        for &(item, n) in &needed {
            after.remove(item, n);
        }
        if after.add(&self.content, result, count) > 0 {
            return Err(IntentError::InventoryFull);
        }
        player.inventory = after;
        Ok((result, count))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeWorld {
        blocks: HashMap<[i32; 3], u32>,
        player_cells: Vec<[i32; 3]>,
    }

    impl WorldView for FakeWorld {
        fn block_at(&self, voxel: [i32; 3]) -> Option<u32> {
            if voxel[0].abs() > 100 {
                return None;
            }
            Some(*self.blocks.get(&voxel).unwrap_or(&AIR))
        }
        fn players_overlap(&self, voxel: [i32; 3]) -> bool {
            self.player_cells.contains(&voxel)
        }
        fn block_nearby(&self, voxel: [i32; 3], block: u32, radius: i32) -> bool {
            self.blocks
                .iter()
                .any(|(p, b)| *b == block && (0..3).all(|i| (p[i] - voxel[i]).abs() <= radius))
        }
    }

    fn setup() -> (Rules, FakeWorld, PlayerState) {
        let content = Arc::new(Content::load(platform_content::default_pack_dir()).unwrap());
        let mut blocks = HashMap::new();
        blocks.insert([1, 0, 0], content.block("stone").unwrap().id);
        blocks.insert([2, 0, 0], content.block("dirt").unwrap().id);
        blocks.insert([3, 0, 0], content.block("bedrock").unwrap().id);
        blocks.insert([4, 0, 0], content.block("water").unwrap().id);
        blocks.insert([5, 0, 0], content.block("gold_ore").unwrap().id);
        (
            Rules::new(content),
            FakeWorld {
                blocks,
                player_cells: vec![[0, 0, 0], [0, 1, 0]],
            },
            PlayerState {
                inventory: Inventory::default(),
                mining: None,
                realm: Realm::Survival,
            },
        )
    }

    const HERE: [f32; 3] = [0.5, 1.6, 0.5];

    fn always(value: f64) -> impl FnMut() -> f64 {
        move || value
    }

    #[test]
    fn dirt_by_hand_after_the_mining_time_yields_dirt() {
        let (rules, world, mut player) = setup();
        rules
            .start_mining(&mut player, &world, HERE, [2, 0, 0], 1_000)
            .unwrap();
        // 0.5 hardness * 1.5 / 1.0 = 750 ms; 80 % tolerance = 600 ms.
        assert_eq!(
            rules.finish_mining(
                &mut player,
                &world,
                HERE,
                [2, 0, 0],
                1_500,
                &mut always(0.0)
            ),
            Err(IntentError::TooFast)
        );
        let outcome = rules
            .finish_mining(
                &mut player,
                &world,
                HERE,
                [2, 0, 0],
                1_600,
                &mut always(0.0),
            )
            .unwrap();
        let dirt = rules.content().item("dirt").unwrap().id;
        assert_eq!(outcome.drops, vec![(dirt, 1)]);
        assert_eq!(player.inventory.count_of(dirt), 1);
        assert!(player.mining.is_none());
    }

    #[test]
    fn stone_by_hand_breaks_slowly_and_drops_nothing() {
        let (rules, world, mut player) = setup();
        rules
            .start_mining(&mut player, &world, HERE, [1, 0, 0], 0)
            .unwrap();
        let outcome = rules
            .finish_mining(
                &mut player,
                &world,
                HERE,
                [1, 0, 0],
                6_000,
                &mut always(0.0),
            )
            .unwrap();
        assert!(!outcome.harvested);
        assert!(outcome.drops.is_empty());
    }

    #[test]
    fn a_pickaxe_harvests_stone_faster_and_wears() {
        let (rules, world, mut player) = setup();
        let pick = rules.content().item("wooden_pickaxe").unwrap().id;
        player.inventory.add(rules.content(), pick, 1);
        rules
            .start_mining(&mut player, &world, HERE, [1, 0, 0], 0)
            .unwrap();
        // 1.5 * 1.5 / 2.0 = 1125 ms -> 900 ms with tolerance
        let outcome = rules
            .finish_mining(&mut player, &world, HERE, [1, 0, 0], 900, &mut always(0.0))
            .unwrap();
        assert!(outcome.harvested);
        let rubble = rules.content().item("rubble").unwrap().id;
        assert_eq!(player.inventory.count_of(rubble), 1);
        assert_eq!(player.inventory.get(0).unwrap().durability, Some(59));
    }

    #[test]
    fn finishing_without_starting_or_on_another_block_is_refused() {
        let (rules, mut world, mut player) = setup();
        assert_eq!(
            rules.finish_mining(
                &mut player,
                &world,
                HERE,
                [2, 0, 0],
                9_000,
                &mut always(0.0)
            ),
            Err(IntentError::NoSession)
        );
        rules
            .start_mining(&mut player, &world, HERE, [2, 0, 0], 0)
            .unwrap();
        world
            .blocks
            .insert([2, 0, 0], rules.content().block("sand").unwrap().id);
        assert_eq!(
            rules.finish_mining(
                &mut player,
                &world,
                HERE,
                [2, 0, 0],
                9_000,
                &mut always(0.0)
            ),
            Err(IntentError::WrongBlock)
        );
    }

    #[test]
    fn reach_loading_bedrock_and_fluids() {
        let (rules, world, mut player) = setup();
        assert_eq!(
            rules.start_mining(&mut player, &world, HERE, [9, 0, 0], 0),
            Err(IntentError::OutOfReach)
        );
        assert_eq!(
            rules.start_mining(&mut player, &world, [150.0, 0.0, 0.0], [150, 0, 0], 0),
            Err(IntentError::NotLoaded)
        );
        assert_eq!(
            rules.start_mining(&mut player, &world, HERE, [3, 0, 0], 0),
            Err(IntentError::Unbreakable)
        );
        assert_eq!(
            rules.start_mining(&mut player, &world, HERE, [4, 0, 0], 0),
            Err(IntentError::NothingThere)
        );
    }

    #[test]
    fn a_full_inventory_refuses_the_break_instead_of_losing_drops() {
        let (rules, world, mut player) = setup();
        let sand = rules.content().item("sand").unwrap().id;
        player.inventory.add(rules.content(), sand, 64 * 36);
        rules
            .start_mining(&mut player, &world, HERE, [2, 0, 0], 0)
            .unwrap();
        assert_eq!(
            rules.finish_mining(
                &mut player,
                &world,
                HERE,
                [2, 0, 0],
                5_000,
                &mut always(0.0)
            ),
            Err(IntentError::InventoryFull)
        );
    }

    #[test]
    fn placing_consumes_the_item_and_checks_the_cell() {
        let (rules, world, mut player) = setup();
        let dirt_item = rules.content().item("dirt").unwrap().id;
        let dirt_block = rules.content().block("dirt").unwrap().id;
        player.inventory.add(rules.content(), dirt_item, 2);

        assert_eq!(
            rules.place(&mut player, &world, HERE, [0, 3, 1], None, None),
            Ok(dirt_block)
        );
        assert_eq!(player.inventory.count_of(dirt_item), 1);
        assert_eq!(
            rules.place(&mut player, &world, HERE, [1, 0, 0], None, None),
            Err(IntentError::Occupied)
        );
        assert_eq!(
            rules.place(&mut player, &world, HERE, [0, 1, 0], None, None),
            Err(IntentError::CollidesWithPlayer)
        );
        // water is replaceable
        assert_eq!(
            rules.place(&mut player, &world, HERE, [4, 0, 0], None, None),
            Ok(dirt_block)
        );
        assert_eq!(
            rules.place(&mut player, &world, HERE, [0, 3, 2], None, None),
            Err(IntentError::Inventory(InventoryError::EmptySlot))
        );
    }

    #[test]
    fn survival_cannot_place_by_naming_a_block() {
        let (rules, world, mut player) = setup();
        assert!(rules
            .place(&mut player, &world, HERE, [0, 3, 1], None, Some("gold_ore"))
            .is_err());
        player.realm = Realm::Creative;
        let gold = rules.content().block("gold_ore").unwrap().id;
        assert_eq!(
            rules.place(&mut player, &world, HERE, [0, 3, 1], None, Some("gold_ore")),
            Ok(gold)
        );
    }

    #[test]
    fn crafting_takes_ingredients_and_needs_a_bench_for_3x3() {
        let (rules, mut world, mut player) = setup();
        let c = rules.content();
        let (log, planks, stick) = (
            c.item("oak_log").unwrap().id,
            c.item("planks").unwrap().id,
            c.item("stick").unwrap().id,
        );
        player.inventory.add(c, log, 1);
        let one_log = CraftingGrid::from_rows(&[&[Some("oak_log"), None], &[None, None]]);
        assert_eq!(
            rules.craft(&mut player, &world, HERE, &one_log),
            Ok((planks, 4))
        );
        assert_eq!(player.inventory.count_of(log), 0);
        assert_eq!(
            rules.craft(&mut player, &world, HERE, &one_log),
            Err(IntentError::MissingIngredients)
        );

        let pickaxe = CraftingGrid::from_rows(&[
            &[Some("planks"), Some("planks"), Some("planks")],
            &[None, Some("stick"), None],
            &[None, Some("stick"), None],
        ]);
        player.inventory.add(c, stick, 2);
        assert_eq!(
            rules.craft(&mut player, &world, HERE, &pickaxe),
            Err(IntentError::NeedsWorkbench)
        );
        world
            .blocks
            .insert([2, 1, 2], c.block("crafting_table").unwrap().id);
        let pick = c.item("wooden_pickaxe").unwrap().id;
        assert_eq!(
            rules.craft(&mut player, &world, HERE, &pickaxe),
            Ok((pick, 1))
        );
        assert_eq!(player.inventory.count_of(planks), 1);
        assert_eq!(player.inventory.count_of(stick), 0);
    }

    #[test]
    fn creative_breaks_instantly_without_drops() {
        let (rules, world, mut player) = setup();
        player.realm = Realm::Creative;
        let outcome = rules
            .finish_mining(&mut player, &world, HERE, [1, 0, 0], 0, &mut always(0.0))
            .unwrap();
        assert!(outcome.drops.is_empty());
        assert_eq!(player.inventory, Inventory::default());
    }

    #[test]
    fn gold_needs_an_iron_pickaxe_to_drop() {
        let (rules, world, mut player) = setup();
        let stone_pick = rules.content().item("stone_pickaxe").unwrap().id;
        player.inventory.add(rules.content(), stone_pick, 1);
        rules
            .start_mining(&mut player, &world, HERE, [5, 0, 0], 0)
            .unwrap();
        let outcome = rules
            .finish_mining(
                &mut player,
                &world,
                HERE,
                [5, 0, 0],
                60_000,
                &mut always(0.0),
            )
            .unwrap();
        assert!(!outcome.harvested);
        assert!(outcome.drops.is_empty());
    }
}
