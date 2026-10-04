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
use super::survival::Vitals;

pub const AIR: u32 = 0;

/// What the rules need to know about the world around an intent.
pub trait WorldView {
    /// Block id at a voxel, `None` when its chunk is not loaded.
    fn block_at(&self, voxel: [i32; 3]) -> Option<u32>;
    /// The raw voxel (id plus rotation, stage...), `None` when not loaded.
    fn raw_at(&self, voxel: [i32; 3]) -> Option<u32> {
        self.block_at(voxel)
    }
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
    Dead,
    NeedsSupport,
    CannotUse,
    Window(super::window::WindowError),
    NotFood,
    NotHungry,
    UnknownItem,
    CreativeOnly,
    /// The land there belongs to someone who has not allowed this.
    LandProtected,
    MarketUnavailable,
    SurvivalOnly,
    BadListing,
    NotOwner,
    Busy,
    BadBlueprint,
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
            IntentError::Dead => "dead",
            IntentError::NeedsSupport => "needs_support",
            IntentError::CannotUse => "cannot_use",
            IntentError::Window(e) => e.code(),
            IntentError::NotFood => "not_food",
            IntentError::NotHungry => "not_hungry",
            IntentError::UnknownItem => "unknown_item",
            IntentError::CreativeOnly => "creative_only",
            IntentError::LandProtected => "land_protected",
            IntentError::MarketUnavailable => "market_unavailable",
            IntentError::SurvivalOnly => "survival_only",
            IntentError::BadListing => "bad_listing",
            IntentError::NotOwner => "not_owner",
            IntentError::Busy => "busy",
            IntentError::BadBlueprint => "bad_blueprint",
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

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerState {
    pub inventory: Inventory,
    pub mining: Option<MiningSession>,
    pub realm: Realm,
    pub vitals: Vitals,
    /// Position at the previous survival tick, for movement effort.
    pub last_position: Option<[f32; 3]>,
    /// Stack held by the mouse in an open window.
    pub cursor: Option<super::inventory::Stack>,
    /// The inventory screen's own 2x2 crafting grid.
    pub craft_grid: Vec<Option<super::inventory::Stack>>,
    pub armor: Vec<Option<super::inventory::Stack>>,
    pub offhand: Option<super::inventory::Stack>,
    pub window: Option<OpenWindow>,
    /// Seconds until this player can attack again.
    pub attack_cooldown: f32,
    /// Travel between dimensions (see `travel.rs`).
    pub travel: super::travel::TravelState,
    /// Id of the land the player was last told they are in.
    pub land_seen: Option<String>,
    /// Listings on their way to the backend and deliveries applied.
    pub market: super::market::MarketState,
    /// Items offered in an open trade (saved with the record).
    pub trade_hold: Option<super::trade::Hold>,
}

/// The window a player has open.
#[derive(Debug, Clone, PartialEq)]
pub struct OpenWindow {
    pub kind: super::window::WindowKind,
    /// The block it belongs to (workbench, furnace, chest).
    pub at: Option<[i32; 3]>,
    /// A workbench's own 3x3 grid (emptied on close).
    pub grid: Vec<Option<super::inventory::Stack>>,
}

impl PlayerState {
    pub fn new(inventory: Inventory, realm: Realm, vitals: Vitals) -> Self {
        Self {
            inventory,
            mining: None,
            realm,
            vitals,
            last_position: None,
            cursor: None,
            craft_grid: vec![None; 4],
            armor: vec![None; 4],
            offhand: None,
            window: None,
            attack_cooldown: 0.0,
            travel: Default::default(),
            land_seen: None,
            market: Default::default(),
            trade_hold: None,
        }
    }
}

fn alive(player: &PlayerState) -> Result<(), IntentError> {
    if player.vitals.is_dead() {
        Err(IntentError::Dead)
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MineOutcome {
    pub harvested: bool,
    /// `(item id, count)` to spawn at the block.
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

    pub fn content_arc(&self) -> Arc<Content> {
        self.content.clone()
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
        alive(player)?;
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
    /// air and spawns the returned drops in the world.
    pub fn finish_mining(
        &self,
        player: &mut PlayerState,
        view: &dyn WorldView,
        position: [f32; 3],
        voxel: [i32; 3],
        now_ms: u64,
        random: &mut dyn FnMut() -> f64,
    ) -> Result<MineOutcome, IntentError> {
        alive(player)?;
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
        let stage = view.raw_at(voxel).map(|raw| (raw >> 24) & 0xF).unwrap_or(0);
        let ripe = block.stages > 0 && stage + 1 >= block.stages && !block.grown_drops.is_empty();
        let table = if ripe {
            &block.grown_drops
        } else {
            &block.drops
        };
        if harvests {
            for drop in table {
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
        // Drops are spawned in the world by the caller and picked up by
        // walking over them, so a full inventory never destroys anything.
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
        alive(player)?;
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
        if !block.support.is_empty() {
            let below = view
                .block_at([voxel[0], voxel[1] - 1, voxel[2]])
                .ok_or(IntentError::NotLoaded)?;
            let ok = self
                .content
                .block_by_id(below)
                .is_some_and(|b| block.support.contains(&b.key));
            if !ok {
                return Err(IntentError::NeedsSupport);
            }
        }
        if block.collision && view.players_overlap(voxel) {
            return Err(IntentError::CollidesWithPlayer);
        }
        if player.realm == Realm::Survival {
            player.inventory.take_one(slot)?;
        }
        Ok(block.id)
    }

    /// Use a block or the held item on it: circuit blocks toggle (levers,
    /// buttons, clocks, gates) whatever is held; a hoe tills dirt or turf
    /// with air above into farmland. Returns the raw voxel to write.
    pub fn use_on(
        &self,
        player: &mut PlayerState,
        view: &dyn WorldView,
        position: [f32; 3],
        voxel: [i32; 3],
    ) -> Result<u32, IntentError> {
        alive(player)?;
        let (id, block) = self.target_block(view, position, voxel)?;
        let raw = view.raw_at(voxel).ok_or(IntentError::NotLoaded)?;
        if let Some(next) = crate::behaviors::use_circuit(&self.content, raw) {
            return Ok(next);
        }
        let held = self.held_item(player).ok_or(IntentError::CannotUse)?;
        let is_hoe = held
            .tool
            .as_ref()
            .is_some_and(|t| t.kind == platform_content::ToolKind::Hoe);
        let tillable = block.key == "dirt" || block.key == "turf";
        let above = view
            .block_at([voxel[0], voxel[1] + 1, voxel[2]])
            .ok_or(IntentError::NotLoaded)?;
        let farmland = self
            .content
            .block("farmland")
            .ok_or(IntentError::CannotUse)?
            .id;
        if !is_hoe || !tillable || above != AIR || id == farmland {
            return Err(IntentError::CannotUse);
        }
        if player.realm == Realm::Survival {
            player.inventory.wear_selected();
        }
        Ok(farmland)
    }

    /// Creative players take any item into a slot (a full stack, fresh).
    pub fn creative_take(
        &self,
        player: &mut PlayerState,
        slot: usize,
        item_key: &str,
    ) -> Result<u32, IntentError> {
        if player.realm != Realm::Creative {
            return Err(IntentError::CreativeOnly);
        }
        let item = self
            .content
            .item(item_key)
            .ok_or(IntentError::UnknownItem)?;
        player.inventory.set_fresh(&self.content, slot, item.id)?;
        Ok(item.id)
    }

    /// Whether the held item lights portals.
    pub fn holds_igniter(&self, player: &PlayerState) -> bool {
        self.held_item(player)
            .and_then(|i| i.tool.as_ref())
            .is_some_and(|t| t.kind == platform_content::ToolKind::Igniter)
    }

    /// Light the portal frame at `voxel` with the held igniter: the rift
    /// cells to write (wearing the igniter), or `CannotUse` when it closes
    /// no valid frame or that kind of portal leads nowhere from `here`.
    pub fn ignite(
        &self,
        player: &mut PlayerState,
        view: &dyn WorldView,
        position: [f32; 3],
        voxel: [i32; 3],
        here: platform_content::Dimension,
    ) -> Result<Vec<([i32; 3], u32)>, IntentError> {
        alive(player)?;
        if !self.holds_igniter(player) {
            return Err(IntentError::CannotUse);
        }
        self.target_block(view, position, voxel)?;
        let blocks = view
            .block_at(voxel)
            .and_then(|frame| crate::portals::PortalBlocks::by_frame(&self.content, frame))
            .filter(|kind| kind.route(here).is_some())
            .ok_or(IntentError::CannotUse)?;
        let (cells, axis) = crate::portals::ignite(&blocks, voxel, |p| view.block_at(p))
            .ok_or(IntentError::CannotUse)?;
        if player.realm == Realm::Survival {
            player.inventory.wear_selected();
        }
        let raw = crate::portals::rift_raw(&blocks, axis);
        Ok(cells.into_iter().map(|c| (c, raw)).collect())
    }

    /// Eat one food item from `slot` (the selected slot when `None`).
    pub fn eat(&self, player: &mut PlayerState, slot: Option<usize>) -> Result<u32, IntentError> {
        alive(player)?;
        let slot = slot.unwrap_or(player.inventory.selected);
        let stack = player
            .inventory
            .get(slot)
            .ok_or(IntentError::Inventory(InventoryError::EmptySlot))?;
        let food = self
            .content
            .item_by_id(stack.item)
            .and_then(|i| i.food)
            .ok_or(IntentError::NotFood)?;
        if player.realm == Realm::Survival {
            if !player.vitals.eat(food) {
                return Err(IntentError::NotHungry);
            }
            player.inventory.take_one(slot)?;
        }
        Ok(food)
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
        alive(player)?;
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
            self.raw_at(voxel).map(|raw| raw & 0xFFFF)
        }
        fn raw_at(&self, voxel: [i32; 3]) -> Option<u32> {
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
            PlayerState::new(Inventory::default(), Realm::Survival, Vitals::default()),
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
        assert_eq!(outcome.drops, vec![(rubble, 1)]);
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
    fn a_full_inventory_still_breaks_and_returns_the_drops_to_spawn() {
        let (rules, world, mut player) = setup();
        let sand = rules.content().item("sand").unwrap().id;
        player.inventory.add(rules.content(), sand, 64 * 36);
        rules
            .start_mining(&mut player, &world, HERE, [2, 0, 0], 0)
            .unwrap();
        let outcome = rules
            .finish_mining(
                &mut player,
                &world,
                HERE,
                [2, 0, 0],
                5_000,
                &mut always(0.0),
            )
            .unwrap();
        assert_eq!(outcome.drops.len(), 1);
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
    fn the_dead_cannot_act_and_food_is_eaten_only_when_hungry() {
        let (rules, world, mut player) = setup();
        let bread = rules.content().item("bread").unwrap().id;
        player.inventory.add(rules.content(), bread, 2);
        assert_eq!(rules.eat(&mut player, None), Err(IntentError::NotHungry));
        player.vitals.food = 10.0;
        assert_eq!(rules.eat(&mut player, None), Ok(5));
        assert_eq!(player.inventory.count_of(bread), 1);
        player.vitals.health = 0.0;
        assert_eq!(rules.eat(&mut player, None), Err(IntentError::Dead));
        assert_eq!(
            rules.start_mining(&mut player, &world, HERE, [2, 0, 0], 0),
            Err(IntentError::Dead)
        );
    }

    #[test]
    fn hoes_till_soil_and_seeds_need_farmland() {
        let (rules, mut world, mut player) = setup();
        let c = rules.content();
        let hoe = c.item("wooden_hoe").unwrap().id;
        let seeds = c.item("wheat_seeds").unwrap().id;
        player.inventory.add(c, hoe, 1);
        player.inventory.add(c, seeds, 2);
        assert_eq!(
            rules.place(&mut player, &world, HERE, [2, 1, 0], Some(1), None),
            Err(IntentError::NeedsSupport)
        );
        let farmland = c.block("farmland").unwrap().id;
        assert_eq!(
            rules.use_on(&mut player, &world, HERE, [2, 0, 0]),
            Ok(farmland)
        );
        assert_eq!(
            rules.use_on(&mut player, &world, HERE, [1, 0, 0]),
            Err(IntentError::CannotUse),
            "stone"
        );
        world.blocks.insert([2, 0, 0], farmland);
        let crop = c.block("wheat_crop").unwrap().id;
        assert_eq!(
            rules.place(&mut player, &world, HERE, [2, 1, 0], Some(1), None),
            Ok(crop)
        );
    }

    #[test]
    fn empty_hands_flip_levers_but_not_stone() {
        let (rules, mut world, mut player) = setup();
        let lever = rules.content().block("lever").unwrap().id;
        world.blocks.insert([2, 0, 0], lever);
        let on = rules.use_on(&mut player, &world, HERE, [2, 0, 0]).unwrap();
        assert_eq!(on & 0xFFFF, lever);
        assert_eq!(voxelize::BlockUtils::extract_stage(on), 1);
        assert_eq!(
            rules.use_on(&mut player, &world, HERE, [1, 0, 0]),
            Err(IntentError::CannotUse)
        );
        assert_eq!(
            rules.use_on(&mut player, &world, HERE, [90, 0, 0]),
            Err(IntentError::OutOfReach)
        );
    }

    #[test]
    fn fire_strikers_light_closed_riftstone_frames_only() {
        let (rules, mut world, mut player) = setup();
        let c = rules.content();
        let frame = c.block("riftstone").unwrap().id;
        let rift = c.block("rift").unwrap().id;
        // A 2x3 interior frame in the x plane at z = 2, bottom row y = 0.
        for x in 0..4 {
            for y in 0..5 {
                if x == 0 || x == 3 || y == 0 || y == 4 {
                    world.blocks.insert([x, y, 2], frame);
                }
            }
        }
        assert_eq!(
            rules.ignite(
                &mut player,
                &world,
                HERE,
                [1, 0, 2],
                platform_content::Dimension::Overworld
            ),
            Err(IntentError::CannotUse),
            "empty hand"
        );
        let striker = c.item("fire_striker").unwrap().id;
        player.inventory.add(c, striker, 1);
        player.inventory.select(0).unwrap();
        let cells = rules
            .ignite(
                &mut player,
                &world,
                HERE,
                [1, 0, 2],
                platform_content::Dimension::Overworld,
            )
            .unwrap();
        assert_eq!(cells.len(), 6);
        assert!(cells.iter().all(|(_, raw)| raw & 0xFFFF == rift));
        assert_eq!(
            player.inventory.get(0).unwrap().durability,
            Some(63),
            "the striker wears"
        );
        world.blocks.insert([2, 4, 2], 0);
        assert_eq!(
            rules.ignite(
                &mut player,
                &world,
                HERE,
                [1, 0, 2],
                platform_content::Dimension::Overworld
            ),
            Err(IntentError::CannotUse),
            "an open frame"
        );
        world.blocks.insert([2, 4, 2], frame);
        assert_eq!(
            rules.ignite(
                &mut player,
                &world,
                HERE,
                [1, 0, 2],
                platform_content::Dimension::Sky
            ),
            Err(IntentError::CannotUse),
            "an underworld portal leads nowhere from the sky"
        );
        // A skystone frame lights into a sky rift.
        let (sky_frame, sky_rift) = (
            c.block("skystone").unwrap().id,
            c.block("sky_rift").unwrap().id,
        );
        for (_, v) in world.blocks.iter_mut().filter(|(_, v)| **v == frame) {
            *v = sky_frame;
        }
        let cells = rules
            .ignite(
                &mut player,
                &world,
                HERE,
                [1, 0, 2],
                platform_content::Dimension::Sky,
            )
            .unwrap();
        assert!(cells.iter().all(|(_, raw)| raw & 0xFFFF == sky_rift));
    }

    #[test]
    fn only_creative_players_take_items_from_the_palette() {
        let (rules, _, mut player) = setup();
        assert_eq!(
            rules.creative_take(&mut player, 0, "fire_striker"),
            Err(IntentError::CreativeOnly)
        );
        player.realm = Realm::Creative;
        assert_eq!(
            rules.creative_take(&mut player, 0, "no_such_item"),
            Err(IntentError::UnknownItem)
        );
        let id = rules.creative_take(&mut player, 2, "stone").unwrap();
        assert_eq!(
            player.inventory.get(2).map(|s| (s.item, s.count)),
            Some((id, 64))
        );
        let striker = rules.creative_take(&mut player, 3, "fire_striker").unwrap();
        assert_eq!(player.inventory.get(3).unwrap().item, striker);
        assert_eq!(player.inventory.get(3).unwrap().durability, Some(64));
        assert!(rules.creative_take(&mut player, 99, "stone").is_err());
    }

    #[test]
    fn ripe_crops_drop_wheat_and_seeds() {
        let (rules, mut world, mut player) = setup();
        let c = rules.content();
        let crop = c.block("wheat_crop").unwrap();
        world.blocks.insert([2, 1, 0], crop.id | (7 << 24));
        world.blocks.insert([3, 1, 0], crop.id);
        let wheat = c.item("wheat").unwrap().id;
        let seeds = c.item("wheat_seeds").unwrap().id;
        let ripe = rules.finish_mining(&mut player, &world, HERE, [2, 1, 0], 0, &mut always(0.0));
        // Hardness 0 still needs a session: start then finish.
        assert_eq!(ripe, Err(IntentError::NoSession));
        rules
            .start_mining(&mut player, &world, HERE, [2, 1, 0], 0)
            .unwrap();
        let ripe = rules
            .finish_mining(&mut player, &world, HERE, [2, 1, 0], 0, &mut always(0.0))
            .unwrap();
        assert!(ripe.drops.iter().any(|(i, _)| *i == wheat));
        rules
            .start_mining(&mut player, &world, HERE, [3, 1, 0], 0)
            .unwrap();
        let green = rules
            .finish_mining(&mut player, &world, HERE, [3, 1, 0], 0, &mut always(0.0))
            .unwrap();
        assert_eq!(green.drops, vec![(seeds, 1)]);
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
