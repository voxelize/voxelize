//! Container windows and slot clicks, with the semantics players expect
//! from block-building games:
//!
//! - left click picks up / puts down / merges / swaps a whole stack,
//! - right click picks up half / puts down one,
//! - shift click quick-moves between the container and the inventory,
//! - double click gathers matching items onto the cursor,
//! - a number key swaps a slot with a hotbar slot,
//! - dragging spreads the cursor evenly (left) or one each (right),
//! - the crafting result is taken whole (once, or as often as possible
//!   with shift), consuming one item per grid slot.
//!
//! A window is a flat list of slots: the container part first, then the
//! 36 inventory slots (hotbar 0..9 then main 9..36). Every operation
//! conserves items; anything that cannot be stored is returned to the
//! caller to be dropped in the world, never deleted.

use platform_content::{match_recipe, Content, CraftingGrid};
use serde::{Deserialize, Serialize};

use super::inventory::{Stack, HOTBAR_SIZE, INVENTORY_SIZE};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotRule {
    /// Holds anything.
    Any,
    /// The crafting result: take only, computed from the grid.
    CraftResult,
    /// Take only (furnace output).
    TakeOnly,
    /// Only fuels (furnace fuel).
    Fuel,
    /// Only armor items.
    Armor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowKind {
    Player,
    Workbench,
    Furnace,
    Chest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum Click {
    Left,
    Right,
    Shift,
    Double,
    /// Swap with hotbar slot `key` (0..9).
    Hotbar {
        key: usize,
    },
    /// Drop one (or the whole stack) from the slot into the world.
    Drop {
        all: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowError {
    BadSlot,
    NotAllowed,
}

impl WindowError {
    pub fn code(&self) -> &'static str {
        match self {
            WindowError::BadSlot => "bad_slot",
            WindowError::NotAllowed => "not_allowed",
        }
    }
}

/// The slots of one open window, assembled from the player and the block.
#[derive(Debug, Clone, PartialEq)]
pub struct Window {
    pub kind: WindowKind,
    pub slots: Vec<Option<Stack>>,
    pub rules: Vec<SlotRule>,
    /// First slot of the crafting grid and its side length.
    pub grid: Option<(usize, usize)>,
    /// First of the 36 inventory slots.
    pub inventory_start: usize,
    /// Items crafted by the last click: `(item, count)`.
    pub crafted: Vec<(u32, u32)>,
    /// The station a furnace-like window runs (`furnace`, `smelter`, …).
    pub station: String,
}

fn stack_limit(content: &Content, item: u32) -> u32 {
    content
        .item_by_id(item)
        .map(|i| i.stack_size)
        .unwrap_or(1)
        .max(1)
}

fn stackable(a: &Stack, b: &Stack) -> bool {
    a.item == b.item && a.durability.is_none() && b.durability.is_none()
}

impl Window {
    /// Build a window from its container slots and the inventory.
    pub fn new(
        kind: WindowKind,
        container: Vec<Option<Stack>>,
        inventory: &[Option<Stack>],
    ) -> Self {
        let rules: Vec<SlotRule> = match kind {
            WindowKind::Player => {
                let mut r = vec![SlotRule::CraftResult];
                r.extend([SlotRule::Any; 4]);
                r.extend([SlotRule::Armor; 4]);
                r.push(SlotRule::Any); // offhand
                r
            }
            WindowKind::Workbench => {
                let mut r = vec![SlotRule::CraftResult];
                r.extend([SlotRule::Any; 9]);
                r
            }
            WindowKind::Furnace => vec![SlotRule::Any, SlotRule::Fuel, SlotRule::TakeOnly],
            WindowKind::Chest => vec![SlotRule::Any; container.len()],
        };
        assert_eq!(rules.len(), container.len(), "container layout of {kind:?}");
        let grid = match kind {
            WindowKind::Player => Some((1, 2)),
            WindowKind::Workbench => Some((1, 3)),
            _ => None,
        };
        let inventory_start = container.len();
        let mut slots = container;
        slots.extend(inventory.iter().cloned());
        slots.resize(inventory_start + INVENTORY_SIZE, None);
        let mut rules = rules;
        rules.extend([SlotRule::Any; INVENTORY_SIZE]);
        Self {
            kind,
            slots,
            rules,
            grid,
            inventory_start,
            crafted: Vec::new(),
            station: "furnace".to_owned(),
        }
    }

    pub fn container(&self) -> &[Option<Stack>] {
        &self.slots[..self.inventory_start]
    }

    pub fn inventory(&self) -> &[Option<Stack>] {
        &self.slots[self.inventory_start..]
    }

    fn accepts(&self, content: &Content, slot: usize, stack: &Stack) -> bool {
        match self.rules[slot] {
            SlotRule::Any => true,
            SlotRule::CraftResult | SlotRule::TakeOnly => false,
            SlotRule::Fuel => content
                .item_by_id(stack.item)
                .is_some_and(|i| content.fuel_ticks(&i.key).is_some()),
            // Armor slots run head, chest, legs, feet; each takes its piece.
            SlotRule::Armor => {
                let first = self
                    .rules
                    .iter()
                    .position(|r| *r == SlotRule::Armor)
                    .unwrap_or(slot);
                content
                    .item_by_id(stack.item)
                    .and_then(|i| i.armor)
                    .is_some_and(|a| a.slot.index() == slot - first)
            }
        }
    }

    /// Recompute the crafting result from the grid.
    pub fn refresh_result(&mut self, content: &Content) {
        if self.grid.is_none() {
            return;
        }
        let grid = self.crafting_grid(content);
        self.slots[0] = match_recipe(content, &grid).and_then(|m| {
            content.item(&m.result.item).map(|item| Stack {
                item: item.id,
                count: m.result.count,
                durability: item.durability,
            })
        });
    }

    fn crafting_grid(&self, content: &Content) -> CraftingGrid {
        let (start, size) = self.grid.expect("window has a grid");
        let mut grid = CraftingGrid::new(size);
        for y in 0..size {
            for x in 0..size {
                let key = self.slots[start + y * size + x]
                    .as_ref()
                    .and_then(|s| content.item_by_id(s.item))
                    .map(|i| i.key.clone());
                grid.set(x, y, key);
            }
        }
        grid
    }

    /// Merge `stack` into the given slots: onto matching stacks first, then
    /// into empty ones. Returns what did not fit.
    fn move_into(
        &mut self,
        content: &Content,
        mut stack: Stack,
        targets: &[usize],
    ) -> Option<Stack> {
        let limit = stack_limit(content, stack.item);
        for &t in targets {
            if let Some(existing) = self.slots[t].as_mut() {
                if stackable(existing, &stack) && existing.count < limit {
                    let moved = (limit - existing.count).min(stack.count);
                    existing.count += moved;
                    stack.count -= moved;
                    if stack.count == 0 {
                        return None;
                    }
                }
            }
        }
        for &t in targets {
            if self.slots[t].is_none() && self.accepts(content, t, &stack) {
                let moved = limit.min(stack.count);
                self.slots[t] = Some(Stack {
                    count: moved,
                    ..stack.clone()
                });
                stack.count -= moved;
                if stack.count == 0 {
                    return None;
                }
            }
        }
        Some(stack)
    }

    fn inventory_targets(&self, hotbar_last: bool) -> Vec<usize> {
        let s = self.inventory_start;
        let hotbar = s..s + HOTBAR_SIZE;
        let main = s + HOTBAR_SIZE..s + INVENTORY_SIZE;
        if hotbar_last {
            main.chain(hotbar).collect()
        } else {
            hotbar.chain(main).collect()
        }
    }

    fn shift_targets(&self, content: &Content, slot: usize, stack: &Stack) -> Vec<usize> {
        let s = self.inventory_start;
        if slot < s {
            return self.inventory_targets(true);
        }
        let in_hotbar = slot < s + HOTBAR_SIZE;
        let swap_halves = || -> Vec<usize> {
            if in_hotbar {
                (s + HOTBAR_SIZE..s + INVENTORY_SIZE).collect()
            } else {
                (s..s + HOTBAR_SIZE).collect()
            }
        };
        match self.kind {
            WindowKind::Chest => (0..s).collect(),
            WindowKind::Furnace => {
                let item = content.item_by_id(stack.item);
                let is_fuel = item.is_some_and(|i| content.fuel_ticks(&i.key).is_some());
                let smeltable = item.is_some_and(|i| {
                    content
                        .processing()
                        .iter()
                        .any(|r| r.station == self.station && r.input.item == i.key)
                });
                match (smeltable, is_fuel) {
                    (true, _) => vec![0],
                    (false, true) => vec![1],
                    _ => swap_halves(),
                }
            }
            WindowKind::Player => {
                let armor = content.item_by_id(stack.item).and_then(|i| i.armor);
                if let Some(armor) = armor {
                    let mut t = vec![5 + armor.slot.index()];
                    t.extend(swap_halves());
                    t
                } else {
                    swap_halves()
                }
            }
            WindowKind::Workbench => swap_halves(),
        }
    }

    /// Take the crafting result onto the cursor (or, with `shift`, craft as
    /// many times as possible into the inventory). Returns how many times
    /// it crafted.
    fn take_result(&mut self, content: &Content, cursor: &mut Option<Stack>, shift: bool) -> u32 {
        let (start, size) = self.grid.expect("result slot implies a grid");
        let mut crafted = 0;
        loop {
            self.refresh_result(content);
            let Some(result) = self.slots[0].clone() else {
                break;
            };
            if shift {
                // Craft only when the whole result fits in the inventory.
                let mut trial = self.clone();
                let targets = trial.inventory_targets(true);
                if trial.move_into(content, result.clone(), &targets).is_some() {
                    break;
                }
                self.slots = trial.slots;
            } else {
                match cursor {
                    None => *cursor = Some(result.clone()),
                    Some(held)
                        if stackable(held, &result)
                            && held.count + result.count <= stack_limit(content, held.item) =>
                    {
                        held.count += result.count
                    }
                    Some(_) => break,
                }
            }
            for i in start..start + size * size {
                if let Some(stack) = self.slots[i].as_mut() {
                    stack.count -= 1;
                    if stack.count == 0 {
                        self.slots[i] = None;
                    }
                }
            }
            crafted += 1;
            self.crafted.push((result.item, result.count));
            if !shift || crafted >= 64 {
                break;
            }
        }
        self.refresh_result(content);
        crafted
    }

    /// Apply a click. Returns stacks to drop into the world.
    pub fn click(
        &mut self,
        content: &Content,
        cursor: &mut Option<Stack>,
        slot: usize,
        click: Click,
    ) -> Result<Vec<Stack>, WindowError> {
        if slot >= self.slots.len() {
            return Err(WindowError::BadSlot);
        }
        let mut dropped = Vec::new();
        let rule = self.rules[slot];

        if rule == SlotRule::CraftResult {
            match click {
                Click::Left | Click::Right | Click::Double => {
                    self.take_result(content, cursor, false);
                }
                Click::Shift => {
                    self.take_result(content, cursor, true);
                }
                Click::Hotbar { .. } => return Err(WindowError::NotAllowed),
                Click::Drop { .. } => {
                    let mut held = None;
                    if self.take_result(content, &mut held, false) > 0 {
                        dropped.extend(held);
                    }
                }
            }
            return Ok(dropped);
        }

        match click {
            Click::Left => match (cursor.take(), self.slots[slot].take()) {
                (None, slot_stack) => *cursor = slot_stack,
                (Some(held), None) => {
                    if self.accepts(content, slot, &held) {
                        let limit = stack_limit(content, held.item);
                        if held.count > limit {
                            self.slots[slot] = Some(Stack {
                                count: limit,
                                ..held.clone()
                            });
                            *cursor = Some(Stack {
                                count: held.count - limit,
                                ..held
                            });
                        } else {
                            self.slots[slot] = Some(held);
                        }
                    } else {
                        *cursor = Some(held);
                    }
                }
                (Some(mut held), Some(mut there)) => {
                    if stackable(&held, &there) && rule != SlotRule::TakeOnly {
                        let limit = stack_limit(content, there.item);
                        let moved = limit.saturating_sub(there.count).min(held.count);
                        there.count += moved;
                        held.count -= moved;
                        self.slots[slot] = Some(there);
                        *cursor = (held.count > 0).then_some(held);
                    } else if stackable(&held, &there) {
                        // Output slot: take as much as the cursor can hold.
                        let limit = stack_limit(content, there.item);
                        let moved = limit.saturating_sub(held.count).min(there.count);
                        held.count += moved;
                        there.count -= moved;
                        self.slots[slot] = (there.count > 0).then_some(there);
                        *cursor = Some(held);
                    } else if self.accepts(content, slot, &held) {
                        self.slots[slot] = Some(held);
                        *cursor = Some(there);
                    } else {
                        self.slots[slot] = Some(there);
                        *cursor = Some(held);
                    }
                }
            },
            Click::Right => match (cursor.take(), self.slots[slot].take()) {
                (None, None) => {}
                (None, Some(mut there)) => {
                    let half = there.count.div_ceil(2);
                    there.count -= half;
                    *cursor = Some(Stack {
                        count: half,
                        ..there.clone()
                    });
                    self.slots[slot] = (there.count > 0).then_some(there);
                }
                (Some(mut held), None) => {
                    if self.accepts(content, slot, &held) {
                        self.slots[slot] = Some(Stack {
                            count: 1,
                            ..held.clone()
                        });
                        held.count -= 1;
                    }
                    *cursor = (held.count > 0).then_some(held);
                }
                (Some(mut held), Some(mut there)) => {
                    if stackable(&held, &there)
                        && rule != SlotRule::TakeOnly
                        && there.count < stack_limit(content, there.item)
                    {
                        there.count += 1;
                        held.count -= 1;
                        self.slots[slot] = Some(there);
                        *cursor = (held.count > 0).then_some(held);
                    } else if !stackable(&held, &there) && self.accepts(content, slot, &held) {
                        self.slots[slot] = Some(held);
                        *cursor = Some(there);
                    } else {
                        self.slots[slot] = Some(there);
                        *cursor = Some(held);
                    }
                }
            },
            Click::Shift => {
                if let Some(stack) = self.slots[slot].take() {
                    let targets = self.shift_targets(content, slot, &stack);
                    self.slots[slot] = self.move_into(content, stack, &targets);
                }
            }
            Click::Double => {
                if let Some(held) = cursor.as_mut() {
                    let limit = stack_limit(content, held.item);
                    // Gather from the container first, then the inventory;
                    // never from the crafting result.
                    for i in 0..self.slots.len() {
                        if held.count >= limit || self.rules[i] == SlotRule::CraftResult {
                            continue;
                        }
                        if let Some(there) = self.slots[i].as_mut() {
                            if stackable(held, there) {
                                let moved = (limit - held.count).min(there.count);
                                held.count += moved;
                                there.count -= moved;
                                if there.count == 0 {
                                    self.slots[i] = None;
                                }
                            }
                        }
                    }
                }
            }
            Click::Hotbar { key } => {
                if key >= HOTBAR_SIZE {
                    return Err(WindowError::BadSlot);
                }
                let hotbar = self.inventory_start + key;
                if hotbar != slot {
                    let a = self.slots[slot].clone();
                    let b = self.slots[hotbar].clone();
                    let a_ok = a.as_ref().is_none_or(|s| self.accepts(content, hotbar, s));
                    let b_ok = b.as_ref().is_none_or(|s| self.accepts(content, slot, s));
                    if !(a_ok && b_ok) {
                        return Err(WindowError::NotAllowed);
                    }
                    self.slots.swap(slot, hotbar);
                }
            }
            Click::Drop { all } => {
                if let Some(mut there) = self.slots[slot].take() {
                    let n = if all { there.count } else { 1 };
                    there.count -= n;
                    dropped.push(Stack {
                        count: n,
                        ..there.clone()
                    });
                    self.slots[slot] = (there.count > 0).then_some(there);
                }
            }
        }
        self.refresh_result(content);
        Ok(dropped)
    }

    /// Spread the cursor over `slots`: evenly (`one_each == false`) or one
    /// item per slot. Slots that cannot take the item are skipped.
    pub fn drag(
        &mut self,
        content: &Content,
        cursor: &mut Option<Stack>,
        slots: &[usize],
        one_each: bool,
    ) -> Result<(), WindowError> {
        let Some(mut held) = cursor.take() else {
            return Ok(());
        };
        let mut unique: Vec<usize> = Vec::new();
        for &s in slots {
            if s >= self.slots.len() {
                *cursor = Some(held);
                return Err(WindowError::BadSlot);
            }
            let fits = self.accepts(content, s, &held)
                && self.slots[s].as_ref().is_none_or(|t| stackable(t, &held));
            if fits && !unique.contains(&s) {
                unique.push(s);
            }
        }
        if unique.is_empty() {
            *cursor = Some(held);
            return Ok(());
        }
        let per = if one_each {
            1
        } else {
            (held.count / unique.len() as u32).max(1)
        };
        let limit = stack_limit(content, held.item);
        for s in unique {
            if held.count == 0 {
                break;
            }
            let current = self.slots[s].as_ref().map_or(0, |t| t.count);
            let moved = per.min(held.count).min(limit.saturating_sub(current));
            if moved == 0 {
                continue;
            }
            self.slots[s] = Some(Stack {
                count: current + moved,
                ..held.clone()
            });
            held.count -= moved;
        }
        *cursor = (held.count > 0).then_some(held);
        self.refresh_result(content);
        Ok(())
    }

    /// Recipe book: move one recipe's worth of ingredients (or as many sets
    /// as possible) from the inventory into the grid. The grid is emptied
    /// into the inventory first. Returns how many sets were placed.
    pub fn fill_recipe(
        &mut self,
        content: &Content,
        recipe_key: &str,
        max: bool,
    ) -> Result<u32, WindowError> {
        let (start, size) = self.grid.ok_or(WindowError::NotAllowed)?;
        let recipe = content.recipe(recipe_key).ok_or(WindowError::NotAllowed)?;
        let layout = recipe_layout(recipe, size).ok_or(WindowError::NotAllowed)?;

        // Return the grid to the inventory (cannot fail to fit: it came from there
        // or the caller drops what remains).
        let targets = self.inventory_targets(false);
        for i in start..start + size * size {
            if let Some(stack) = self.slots[i].take() {
                self.slots[i] = self.move_into(content, stack, &targets);
            }
        }

        let ids: Vec<Option<u32>> = layout
            .iter()
            .map(|k| k.as_ref().and_then(|k| content.item(k)).map(|i| i.id))
            .collect();
        let mut sets = 0;
        let rounds = if max { 64 } else { 1 };
        'outer: for _ in 0..rounds {
            // Check the inventory holds one more set.
            let mut need: Vec<(u32, u32)> = Vec::new();
            for id in ids.iter().flatten() {
                match need.iter_mut().find(|(i, _)| i == id) {
                    Some(e) => e.1 += 1,
                    None => need.push((*id, 1)),
                }
            }
            for &(id, n) in &need {
                let have: u32 = self
                    .inventory()
                    .iter()
                    .flatten()
                    .filter(|s| s.item == id)
                    .map(|s| s.count)
                    .sum();
                if have < n {
                    break 'outer;
                }
            }
            for (cell, id) in ids.iter().enumerate() {
                let Some(id) = id else { continue };
                let slot = start + cell;
                let limit = stack_limit(content, *id);
                if self.slots[slot].as_ref().is_some_and(|s| s.count >= limit) {
                    break 'outer;
                }
                // Take one matching item from the inventory (last slots first).
                let from = (self.inventory_start..self.slots.len())
                    .rev()
                    .find(|&i| self.slots[i].as_ref().is_some_and(|s| s.item == *id))
                    .expect("counted above");
                let taken = {
                    let s = self.slots[from].as_mut().expect("found");
                    s.count -= 1;
                    let t = Stack {
                        count: 1,
                        ..s.clone()
                    };
                    if s.count == 0 {
                        self.slots[from] = None;
                    }
                    t
                };
                match self.slots[slot].as_mut() {
                    Some(s) => s.count += 1,
                    None => self.slots[slot] = Some(taken),
                }
            }
            sets += 1;
        }
        self.refresh_result(content);
        Ok(sets)
    }

    /// Empty the crafting grid (and the result) when the window closes:
    /// grid items go back to the inventory; what does not fit is returned.
    pub fn close(&mut self, content: &Content, cursor: &mut Option<Stack>) -> Vec<Stack> {
        let mut dropped = Vec::new();
        let targets = self.inventory_targets(false);
        if let Some((start, size)) = self.grid {
            for i in start..start + size * size {
                if let Some(stack) = self.slots[i].take() {
                    dropped.extend(self.move_into(content, stack, &targets));
                }
            }
            self.slots[0] = None;
        }
        if let Some(held) = cursor.take() {
            dropped.extend(self.move_into(content, held, &targets));
        }
        dropped
    }
}

/// A recipe's ingredient keys laid out on a `size` x `size` grid, or `None`
/// when it does not fit.
pub fn recipe_layout(
    recipe: &platform_content::RecipeDef,
    size: usize,
) -> Option<Vec<Option<String>>> {
    let mut cells = vec![None; size * size];
    match recipe {
        platform_content::RecipeDef::Shaped {
            pattern, symbols, ..
        } => {
            if pattern.len() > size || pattern.iter().any(|r| r.chars().count() > size) {
                return None;
            }
            for (y, row) in pattern.iter().enumerate() {
                for (x, c) in row.chars().enumerate() {
                    if c != ' ' {
                        cells[y * size + x] = Some(symbols.get(&c)?.clone());
                    }
                }
            }
        }
        platform_content::RecipeDef::Shapeless { ingredients, .. } => {
            if ingredients.len() > size * size {
                return None;
            }
            for (i, item) in ingredients.iter().enumerate() {
                cells[i] = Some(item.clone());
            }
        }
    }
    Some(cells)
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

    fn total(w: &Window, cursor: &Option<Stack>, item: u32) -> u32 {
        w.slots
            .iter()
            .skip(1) // the result slot is virtual
            .chain(std::iter::once(cursor))
            .flatten()
            .filter(|s| s.item == item)
            .map(|s| s.count)
            .sum()
    }

    fn player_window(_c: &Content, inv: Vec<(usize, Option<Stack>)>) -> Window {
        let mut inventory = vec![None; INVENTORY_SIZE];
        for (i, s) in inv {
            inventory[i] = s;
        }
        Window::new(WindowKind::Player, vec![None; 10], &inventory)
    }

    #[test]
    fn left_and_right_clicks_pick_place_split_and_merge() {
        let c = content();
        let dirt = c.item("dirt").unwrap().id;
        let mut w = player_window(&c, vec![(0, st(&c, "dirt", 10)), (1, st(&c, "dirt", 60))]);
        let base = w.inventory_start;
        let mut cursor = None;
        w.click(&c, &mut cursor, base, Click::Right).unwrap(); // pick half: 5
        assert_eq!(cursor.as_ref().unwrap().count, 5);
        w.click(&c, &mut cursor, base + 2, Click::Right).unwrap(); // place one
        assert_eq!(w.slots[base + 2].as_ref().unwrap().count, 1);
        w.click(&c, &mut cursor, base + 1, Click::Left).unwrap(); // merge to 64
        assert_eq!(w.slots[base + 1].as_ref().unwrap().count, 64);
        assert_eq!(total(&w, &cursor, dirt), 70);
    }

    #[test]
    fn crafting_in_the_2x2_grid_takes_the_result_and_consumes_inputs() {
        let c = content();
        let mut w = player_window(&c, vec![(0, st(&c, "oak_log", 3))]);
        let base = w.inventory_start;
        let mut cursor = None;
        w.click(&c, &mut cursor, base, Click::Left).unwrap(); // pick up logs
        w.click(&c, &mut cursor, 1, Click::Left).unwrap(); // into grid
        assert_eq!(w.slots[0], st(&c, "planks", 4), "result shows planks");
        w.click(&c, &mut cursor, 0, Click::Left).unwrap();
        assert_eq!(cursor, st(&c, "planks", 4));
        assert_eq!(w.slots[1].as_ref().unwrap().count, 2);
        w.click(&c, &mut cursor, 0, Click::Left).unwrap(); // stacks onto cursor
        assert_eq!(cursor.as_ref().unwrap().count, 8);
    }

    #[test]
    fn shift_crafting_makes_as_many_as_possible() {
        let c = content();
        let mut w = player_window(&c, vec![]);
        w.slots[1] = st(&c, "oak_log", 5);
        let mut cursor = None;
        w.click(&c, &mut cursor, 0, Click::Shift).unwrap();
        let planks = c.item("planks").unwrap().id;
        assert_eq!(total(&w, &cursor, planks), 20);
        assert!(w.slots[1].is_none());
        assert!(w.slots[0].is_none());
    }

    #[test]
    fn shift_click_moves_between_hotbar_and_main_and_into_containers() {
        let c = content();
        let mut w = player_window(&c, vec![(0, st(&c, "dirt", 5))]);
        let base = w.inventory_start;
        let mut cursor = None;
        w.click(&c, &mut cursor, base, Click::Shift).unwrap();
        assert!(w.slots[base].is_none());
        assert_eq!(w.slots[base + 9], st(&c, "dirt", 5));

        let mut inv = vec![None; INVENTORY_SIZE];
        inv[0] = st(&c, "raw_iron", 3);
        inv[1] = st(&c, "coal", 2);
        inv[2] = st(&c, "dirt", 1);
        let mut f = Window::new(WindowKind::Furnace, vec![None; 3], &inv);
        for s in 0..3 {
            f.click(&c, &mut cursor, f.inventory_start + s, Click::Shift)
                .unwrap();
        }
        assert_eq!(f.slots[0], st(&c, "raw_iron", 3));
        assert_eq!(f.slots[1], st(&c, "coal", 2));
        assert!(f.slots[2].is_none(), "nothing may be put in the output");
        assert_eq!(f.slots[f.inventory_start + 9], st(&c, "dirt", 1));
    }

    #[test]
    fn slot_rules_are_enforced() {
        let c = content();
        let mut inv = vec![None; INVENTORY_SIZE];
        inv[0] = st(&c, "dirt", 4);
        let mut f = Window::new(
            WindowKind::Furnace,
            vec![None, None, st(&c, "iron_ingot", 2)],
            &inv,
        );
        let mut cursor = None;
        f.click(&c, &mut cursor, f.inventory_start, Click::Left)
            .unwrap();
        f.click(&c, &mut cursor, 1, Click::Left).unwrap(); // dirt is not fuel
        assert!(f.slots[1].is_none());
        f.click(&c, &mut cursor, 2, Click::Left).unwrap(); // cannot place into output
        assert_eq!(f.slots[2], st(&c, "iron_ingot", 2));
        assert_eq!(cursor, st(&c, "dirt", 4));
        // armor slots refuse non-armor, and each takes only its own piece
        let mut p = player_window(&c, vec![]);
        p.click(&c, &mut cursor, 5, Click::Left).unwrap();
        assert!(p.slots[5].is_none());
        let mut boots = st(&c, "iron_boots", 1);
        p.click(&c, &mut boots, 5, Click::Left).unwrap();
        assert!(p.slots[5].is_none(), "boots are no helmet");
        p.click(&c, &mut boots, 8, Click::Left).unwrap();
        assert_eq!(
            p.slots[8].as_ref().map(|s| s.item),
            Some(c.item("iron_boots").unwrap().id)
        );
    }

    #[test]
    fn double_click_gathers_and_drag_spreads() {
        let c = content();
        let dirt = c.item("dirt").unwrap().id;
        let mut w = player_window(
            &c,
            vec![
                (0, st(&c, "dirt", 10)),
                (5, st(&c, "dirt", 7)),
                (9, st(&c, "dirt", 3)),
            ],
        );
        let base = w.inventory_start;
        let mut cursor = None;
        w.click(&c, &mut cursor, base, Click::Left).unwrap();
        w.click(&c, &mut cursor, base, Click::Double).unwrap();
        assert_eq!(cursor.as_ref().unwrap().count, 20);
        w.drag(&c, &mut cursor, &[base + 1, base + 2, base + 3], false)
            .unwrap();
        assert_eq!(w.slots[base + 1].as_ref().unwrap().count, 6);
        assert_eq!(cursor.as_ref().unwrap().count, 2);
        w.drag(&c, &mut cursor, &[base + 4, base + 6], true)
            .unwrap();
        assert!(cursor.is_none());
        assert_eq!(total(&w, &cursor, dirt), 20);
    }

    #[test]
    fn number_keys_swap_with_the_hotbar_and_drop_returns_stacks() {
        let c = content();
        let mut w = player_window(&c, vec![(12, st(&c, "sand", 8))]);
        let base = w.inventory_start;
        let mut cursor = None;
        w.click(&c, &mut cursor, base + 12, Click::Hotbar { key: 2 })
            .unwrap();
        assert_eq!(w.slots[base + 2], st(&c, "sand", 8));
        let dropped = w
            .click(&c, &mut cursor, base + 2, Click::Drop { all: false })
            .unwrap();
        assert_eq!(dropped, vec![st(&c, "sand", 1).unwrap()]);
        let dropped = w
            .click(&c, &mut cursor, base + 2, Click::Drop { all: true })
            .unwrap();
        assert_eq!(dropped[0].count, 7);
    }

    #[test]
    fn recipe_book_fills_the_grid_from_the_inventory() {
        let c = content();
        let mut inv = vec![None; INVENTORY_SIZE];
        inv[0] = st(&c, "planks", 7);
        inv[1] = st(&c, "stick", 4);
        let mut w = Window::new(WindowKind::Workbench, vec![None; 10], &inv);
        assert_eq!(w.fill_recipe(&c, "wooden_pickaxe", false), Ok(1));
        assert_eq!(w.slots[0], st(&c, "wooden_pickaxe", 1));
        assert_eq!(w.fill_recipe(&c, "wooden_pickaxe", true), Ok(2));
        let mut cursor = None;
        w.click(&c, &mut cursor, 0, Click::Shift).unwrap();
        let pick = c.item("wooden_pickaxe").unwrap().id;
        assert_eq!(
            w.inventory()
                .iter()
                .flatten()
                .filter(|s| s.item == pick)
                .count(),
            2
        );
        // 3x3 recipes do not fit the 2x2 player grid
        let mut p = player_window(&c, vec![(0, st(&c, "planks", 8))]);
        assert_eq!(
            p.fill_recipe(&c, "chest", false),
            Err(WindowError::NotAllowed)
        );
    }

    #[test]
    fn closing_returns_the_grid_and_cursor_and_reports_overflow() {
        let c = content();
        let full: Vec<Option<Stack>> = (0..INVENTORY_SIZE).map(|_| st(&c, "sand", 64)).collect();
        let mut w = Window::new(WindowKind::Player, vec![None; 10], &full);
        w.slots[2] = st(&c, "oak_log", 1);
        let mut cursor = st(&c, "dirt", 3);
        let dropped = w.close(&c, &mut cursor);
        assert_eq!(dropped.len(), 2, "nothing fits a full inventory");
        assert!(cursor.is_none());
        assert!(w.slots[2].is_none());
    }
}
