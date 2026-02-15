use hashbrown::{hash_map::RawEntryMut, HashMap};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum SlotContent {
    #[serde(rename = "empty")]
    Empty,
    #[serde(rename = "block")]
    Block { id: u32, count: u32 },
    #[serde(rename = "item")]
    Item {
        id: u32,
        count: u32,
        #[serde(default)]
        #[serde(skip_serializing_if = "HashMap::is_empty")]
        data: HashMap<String, Value>,
    },
}

impl Default for SlotContent {
    fn default() -> Self {
        SlotContent::Empty
    }
}

impl SlotContent {
    pub fn empty() -> Self {
        SlotContent::Empty
    }

    pub fn block(id: u32, count: u32) -> Self {
        SlotContent::Block { id, count }
    }

    pub fn item(id: u32, count: u32) -> Self {
        SlotContent::Item {
            id,
            count,
            data: HashMap::new(),
        }
    }

    pub fn item_with_data(id: u32, count: u32, data: HashMap<String, Value>) -> Self {
        SlotContent::Item { id, count, data }
    }

    pub fn is_empty(&self) -> bool {
        matches!(self, SlotContent::Empty)
    }

    pub fn is_block(&self) -> bool {
        matches!(self, SlotContent::Block { .. })
    }

    pub fn is_item(&self) -> bool {
        matches!(self, SlotContent::Item { .. })
    }

    pub fn count(&self) -> u32 {
        match self {
            SlotContent::Empty => 0,
            SlotContent::Block { count, .. } => *count,
            SlotContent::Item { count, .. } => *count,
        }
    }

    pub fn set_count(&mut self, new_count: u32) {
        match self {
            SlotContent::Empty => {}
            SlotContent::Block { count, .. } => *count = new_count,
            SlotContent::Item { count, .. } => *count = new_count,
        }
    }

    pub fn id(&self) -> Option<u32> {
        match self {
            SlotContent::Empty => None,
            SlotContent::Block { id, .. } => Some(*id),
            SlotContent::Item { id, .. } => Some(*id),
        }
    }

    pub fn get_data<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        match self {
            SlotContent::Item { data, .. } => data
                .get(key)
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            _ => None,
        }
    }

    pub fn set_data<T: Serialize>(&mut self, key: &str, value: T) -> bool {
        match self {
            SlotContent::Item { data, .. } => {
                if let Ok(json_value) = serde_json::to_value(value) {
                    match data.raw_entry_mut().from_key(key) {
                        RawEntryMut::Occupied(mut entry) => {
                            if entry.get() != &json_value {
                                *entry.get_mut() = json_value;
                            }
                        }
                        RawEntryMut::Vacant(entry) => {
                            entry.insert(key.to_owned(), json_value);
                        }
                    }
                    true
                } else {
                    false
                }
            }
            _ => false,
        }
    }

    pub fn remove_data(&mut self, key: &str) -> Option<Value> {
        match self {
            SlotContent::Item { data, .. } => data.remove(key),
            _ => None,
        }
    }

    pub fn has_data(&self, key: &str) -> bool {
        match self {
            SlotContent::Item { data, .. } => data.contains_key(key),
            _ => false,
        }
    }

    pub fn can_stack_with(&self, other: &SlotContent, max_stack: u32) -> bool {
        if max_stack <= 1 {
            return false;
        }
        match (self, other) {
            (SlotContent::Empty, _) | (_, SlotContent::Empty) => false,
            (SlotContent::Block { id: id_a, .. }, SlotContent::Block { id: id_b, .. }) => {
                id_a == id_b
            }
            (
                SlotContent::Item {
                    id: id_a,
                    data: data_a,
                    ..
                },
                SlotContent::Item {
                    id: id_b,
                    data: data_b,
                    ..
                },
            ) => {
                if id_a != id_b {
                    return false;
                }
                data_a.is_empty() && data_b.is_empty()
            }
            _ => false,
        }
    }

    pub fn slots_equal(&self, other: &SlotContent) -> bool {
        self == other
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum HeldObject {
    None,
    Block(u32),
    Item(u32),
}

const MAX_ENCODED_HELD_OBJECT_ID: u32 = i32::MAX as u32;

#[inline]
fn clamp_held_object_id(id: u32) -> u32 {
    id.min(MAX_ENCODED_HELD_OBJECT_ID)
}

impl Default for HeldObject {
    fn default() -> Self {
        HeldObject::None
    }
}

impl HeldObject {
    pub fn encode(self) -> i32 {
        match self {
            HeldObject::None => 0,
            HeldObject::Block(id) => clamp_held_object_id(id) as i32,
            HeldObject::Item(id) => -(clamp_held_object_id(id) as i32),
        }
    }

    pub fn decode(raw: i32) -> Self {
        if raw == 0 {
            return HeldObject::None;
        }
        if raw > 0 {
            return HeldObject::Block(raw as u32);
        }
        HeldObject::Item(raw.saturating_abs() as u32)
    }

    pub fn from_slot(slot: &SlotContent) -> Self {
        match slot {
            SlotContent::Empty => HeldObject::None,
            SlotContent::Block { id, .. } => HeldObject::Block(*id),
            SlotContent::Item { id, .. } => HeldObject::Item(*id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slot_content_data() {
        let mut slot = SlotContent::item(1, 1);

        slot.set_data("durability", 100u32);
        assert_eq!(slot.get_data::<u32>("durability"), Some(100));

        slot.set_data("customName", "Excalibur".to_string());
        assert_eq!(
            slot.get_data::<String>("customName"),
            Some("Excalibur".to_string())
        );

        assert!(slot.has_data("durability"));
        assert!(!slot.has_data("nonexistent"));

        slot.remove_data("durability");
        assert!(!slot.has_data("durability"));
    }

    #[test]
    fn test_slot_content_serialization() {
        let mut slot = SlotContent::item(1, 5);
        slot.set_data("durability", 50u32);

        let json = serde_json::to_string(&slot).unwrap();
        let deserialized: SlotContent = serde_json::from_str(&json).unwrap();

        assert_eq!(slot, deserialized);
        assert_eq!(deserialized.get_data::<u32>("durability"), Some(50));
    }

    #[test]
    fn test_empty_data_not_serialized() {
        let slot = SlotContent::item(1, 1);
        let json = serde_json::to_string(&slot).unwrap();

        assert!(!json.contains("data"));
    }

    #[test]
    fn test_can_stack_with() {
        let block_a = SlotContent::block(1, 10);
        let block_b = SlotContent::block(1, 5);
        let block_c = SlotContent::block(2, 5);

        assert!(block_a.can_stack_with(&block_b, 64));
        assert!(!block_a.can_stack_with(&block_c, 64));
        assert!(!block_a.can_stack_with(&block_b, 1));

        let item_a = SlotContent::item(1, 10);
        let item_b = SlotContent::item(1, 5);
        let item_c = SlotContent::item(2, 5);

        assert!(item_a.can_stack_with(&item_b, 64));
        assert!(!item_a.can_stack_with(&item_c, 64));
        assert!(!item_a.can_stack_with(&item_b, 1));

        let mut item_with_data = SlotContent::item(1, 1);
        item_with_data.set_data("durability", 100u32);

        assert!(!item_a.can_stack_with(&item_with_data, 64));
        assert!(!item_with_data.can_stack_with(&item_a, 64));

        assert!(!SlotContent::Empty.can_stack_with(&block_a, 64));
        assert!(!block_a.can_stack_with(&SlotContent::Empty, 64));
    }

    #[test]
    fn test_slots_equal() {
        let block_a = SlotContent::block(1, 10);
        let block_b = SlotContent::block(1, 10);
        let block_c = SlotContent::block(1, 5);

        assert!(block_a.slots_equal(&block_b));
        assert!(!block_a.slots_equal(&block_c));

        let item_a = SlotContent::item(1, 10);
        let item_b = SlotContent::item(1, 10);

        assert!(item_a.slots_equal(&item_b));

        let mut item_with_data = SlotContent::item(1, 10);
        item_with_data.set_data("durability", 100u32);

        assert!(!item_a.slots_equal(&item_with_data));
    }

    #[test]
    fn test_held_object_encode_clamps_large_ids() {
        assert_eq!(HeldObject::Block(u32::MAX).encode(), i32::MAX);
        assert_eq!(HeldObject::Item(u32::MAX).encode(), -i32::MAX);
    }

    #[test]
    fn test_held_object_decode_handles_i32_min_without_overflow() {
        assert_eq!(
            HeldObject::decode(i32::MIN),
            HeldObject::Item(i32::MAX as u32)
        );
    }

    #[test]
    fn test_held_object_roundtrip_preserves_representable_ids() {
        let block = HeldObject::Block(42);
        let item = HeldObject::Item(42);
        assert_eq!(HeldObject::decode(block.encode()), block);
        assert_eq!(HeldObject::decode(item.encode()), item);
    }
}
