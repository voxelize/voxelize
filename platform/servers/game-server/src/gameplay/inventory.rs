//! Server-owned player inventory.
//!
//! Slots 0..9 are the hotbar, 9..36 the main inventory. Every operation
//! conserves items: nothing here creates or destroys an item except
//! [`Inventory::add`] (called with items the server has decided to grant)
//! and the consuming operations (placing, crafting, tool wear), which the
//! caller performs only after validating the intent.

use platform_content::Content;
use serde::{Deserialize, Serialize};

pub const HOTBAR_SIZE: usize = 9;
pub const INVENTORY_SIZE: usize = 36;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stack {
    /// Content item id.
    pub item: u32,
    pub count: u32,
    /// Remaining uses for items with durability.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub durability: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InventoryError {
    BadSlot,
    EmptySlot,
    BadCount,
}

impl InventoryError {
    pub fn code(&self) -> &'static str {
        match self {
            InventoryError::BadSlot => "bad_slot",
            InventoryError::EmptySlot => "slot_empty",
            InventoryError::BadCount => "bad_count",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Inventory {
    pub slots: Vec<Option<Stack>>,
    pub selected: usize,
}

impl Default for Inventory {
    fn default() -> Self {
        Self {
            slots: vec![None; INVENTORY_SIZE],
            selected: 0,
        }
    }
}

fn max_stack(content: &Content, item: u32) -> u32 {
    content
        .item_by_id(item)
        .map(|i| i.stack_size)
        .unwrap_or(1)
        .max(1)
}

fn fresh_durability(content: &Content, item: u32) -> Option<u32> {
    content.item_by_id(item).and_then(|i| i.durability)
}

impl Inventory {
    /// Repair a loaded inventory to the current shape: fixed size, valid
    /// selection, no empty or unknown stacks. Returns how many stacks were
    /// dropped because their item no longer exists (logged by the caller).
    pub fn normalize(&mut self, content: &Content) -> usize {
        self.slots.resize(INVENTORY_SIZE, None);
        if self.selected >= HOTBAR_SIZE {
            self.selected = 0;
        }
        let mut dropped = 0;
        for slot in self.slots.iter_mut() {
            if let Some(stack) = slot {
                if stack.count == 0 || content.item_by_id(stack.item).is_none() {
                    dropped += usize::from(stack.count > 0);
                    *slot = None;
                }
            }
        }
        dropped
    }

    pub fn get(&self, slot: usize) -> Option<&Stack> {
        self.slots.get(slot).and_then(|s| s.as_ref())
    }

    pub fn selected_stack(&self) -> Option<&Stack> {
        self.get(self.selected)
    }

    pub fn select(&mut self, slot: usize) -> Result<(), InventoryError> {
        if slot >= HOTBAR_SIZE {
            return Err(InventoryError::BadSlot);
        }
        self.selected = slot;
        Ok(())
    }

    pub fn count_of(&self, item: u32) -> u32 {
        self.slots
            .iter()
            .flatten()
            .filter(|s| s.item == item)
            .map(|s| s.count)
            .sum()
    }

    /// Add items: first topping up existing stacks (hotbar first), then
    /// filling empty slots. Returns the count that did not fit.
    pub fn add(&mut self, content: &Content, item: u32, mut count: u32) -> u32 {
        let max = max_stack(content, item);
        let durability = fresh_durability(content, item);
        if durability.is_none() {
            for stack in self.slots.iter_mut().flatten() {
                if count == 0 {
                    break;
                }
                if stack.item == item && stack.count < max {
                    let moved = (max - stack.count).min(count);
                    stack.count += moved;
                    count -= moved;
                }
            }
        }
        for slot in self.slots.iter_mut() {
            if count == 0 {
                break;
            }
            if slot.is_none() {
                let moved = max.min(count);
                *slot = Some(Stack {
                    item,
                    count: moved,
                    durability,
                });
                count -= moved;
            }
        }
        count
    }

    /// Remove one item from a slot.
    pub fn take_one(&mut self, slot: usize) -> Result<Stack, InventoryError> {
        let entry = self.slots.get_mut(slot).ok_or(InventoryError::BadSlot)?;
        let stack = entry.as_mut().ok_or(InventoryError::EmptySlot)?;
        let taken = Stack {
            item: stack.item,
            count: 1,
            durability: stack.durability,
        };
        stack.count -= 1;
        if stack.count == 0 {
            *entry = None;
        }
        Ok(taken)
    }

    /// Remove `count` of `item` from anywhere. Either all are removed or none.
    pub fn remove(&mut self, item: u32, count: u32) -> bool {
        if self.count_of(item) < count {
            return false;
        }
        let mut left = count;
        for slot in self.slots.iter_mut().rev() {
            if left == 0 {
                break;
            }
            if let Some(stack) = slot {
                if stack.item == item {
                    let taken = stack.count.min(left);
                    stack.count -= taken;
                    left -= taken;
                    if stack.count == 0 {
                        *slot = None;
                    }
                }
            }
        }
        true
    }

    /// Move up to `count` items (all when `None`) from one slot to another:
    /// into an empty slot, onto a matching stack up to its limit, or swap
    /// when the target holds something else and the whole stack moves.
    pub fn move_items(
        &mut self,
        content: &Content,
        from: usize,
        to: usize,
        count: Option<u32>,
    ) -> Result<(), InventoryError> {
        if from >= self.slots.len() || to >= self.slots.len() {
            return Err(InventoryError::BadSlot);
        }
        if from == to {
            return Ok(());
        }
        let source = self.slots[from].clone().ok_or(InventoryError::EmptySlot)?;
        let amount = count.unwrap_or(source.count);
        if amount == 0 || amount > source.count {
            return Err(InventoryError::BadCount);
        }
        let max = max_stack(content, source.item);
        match self.slots[to].clone() {
            None => {
                self.slots[to] = Some(Stack {
                    count: amount,
                    ..source.clone()
                });
                self.reduce(from, amount);
            }
            Some(target)
                if target.item == source.item
                    && target.durability.is_none()
                    && source.durability.is_none() =>
            {
                let moved = amount.min(max.saturating_sub(target.count));
                if let Some(t) = self.slots[to].as_mut() {
                    t.count += moved;
                }
                self.reduce(from, moved);
            }
            Some(_) if amount == source.count => self.slots.swap(from, to),
            Some(_) => return Err(InventoryError::BadCount),
        }
        Ok(())
    }

    /// Wear the selected tool by one use; it breaks at zero. Returns whether
    /// it broke.
    pub fn wear_selected(&mut self) -> bool {
        let selected = self.selected;
        let Some(stack) = self.slots.get_mut(selected).and_then(|s| s.as_mut()) else {
            return false;
        };
        let Some(durability) = stack.durability.as_mut() else {
            return false;
        };
        *durability = durability.saturating_sub(1);
        if *durability == 0 {
            self.slots[selected] = None;
            return true;
        }
        false
    }

    fn reduce(&mut self, slot: usize, amount: u32) {
        if let Some(stack) = self.slots[slot].as_mut() {
            stack.count -= amount;
            if stack.count == 0 {
                self.slots[slot] = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content() -> Content {
        Content::load(platform_content::default_pack_dir()).unwrap()
    }

    fn id(content: &Content, key: &str) -> u32 {
        content.item(key).unwrap().id
    }

    #[test]
    fn add_merges_then_fills_and_reports_overflow() {
        let c = content();
        let dirt = id(&c, "dirt");
        let mut inv = Inventory::default();
        assert_eq!(inv.add(&c, dirt, 100), 0);
        assert_eq!(inv.get(0).unwrap().count, 64);
        assert_eq!(inv.get(1).unwrap().count, 36);
        assert_eq!(inv.add(&c, dirt, 64 * 36), 100);
        assert_eq!(inv.count_of(dirt), 64 * 36);
    }

    #[test]
    fn tools_never_stack_and_wear_out() {
        let c = content();
        let pick = id(&c, "wooden_pickaxe");
        let mut inv = Inventory::default();
        assert_eq!(inv.add(&c, pick, 2), 0);
        assert_eq!(inv.get(0).unwrap().count, 1);
        assert_eq!(inv.get(1).unwrap().count, 1);
        for _ in 0..59 {
            assert!(!inv.wear_selected());
        }
        assert!(inv.wear_selected());
        assert!(inv.get(0).is_none());
    }

    #[test]
    fn moves_conserve_items() {
        let c = content();
        let (dirt, sand) = (id(&c, "dirt"), id(&c, "sand"));
        let mut inv = Inventory::default();
        inv.add(&c, dirt, 40);
        inv.slots[1] = Some(Stack {
            item: sand,
            count: 5,
            durability: None,
        });
        inv.slots[2] = Some(Stack {
            item: dirt,
            count: 30,
            durability: None,
        });

        // split half onto an empty slot
        inv.move_items(&c, 0, 10, Some(20)).unwrap();
        // merge onto a matching stack, capped at 64
        inv.move_items(&c, 2, 10, None).unwrap();
        assert_eq!(inv.get(10).unwrap().count, 50);
        // swap different items when moving a whole stack
        inv.move_items(&c, 1, 0, None).unwrap();
        assert_eq!(inv.get(0).unwrap().item, sand);
        assert_eq!(inv.count_of(dirt), 70);
        assert_eq!(inv.count_of(sand), 5);
        // partial move onto a different item is refused
        assert_eq!(
            inv.move_items(&c, 10, 0, Some(1)),
            Err(InventoryError::BadCount)
        );
        assert_eq!(
            inv.move_items(&c, 99, 0, None),
            Err(InventoryError::BadSlot)
        );
    }

    #[test]
    fn remove_is_all_or_nothing() {
        let c = content();
        let dirt = id(&c, "dirt");
        let mut inv = Inventory::default();
        inv.add(&c, dirt, 10);
        assert!(!inv.remove(dirt, 11));
        assert_eq!(inv.count_of(dirt), 10);
        assert!(inv.remove(dirt, 10));
        assert_eq!(inv.count_of(dirt), 0);
    }

    #[test]
    fn normalize_repairs_loaded_state() {
        let c = content();
        let mut inv = Inventory {
            slots: vec![Some(Stack {
                item: 999_999,
                count: 3,
                durability: None,
            })],
            selected: 40,
        };
        assert_eq!(inv.normalize(&c), 1);
        assert_eq!(inv.slots.len(), INVENTORY_SIZE);
        assert_eq!(inv.selected, 0);
        assert!(inv.get(0).is_none());
    }
}
