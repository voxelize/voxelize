use hashbrown::HashMap;
use serde_json::Value;

use super::def::{ItemDef, ItemDefBuilder};

#[derive(Default, Clone)]
pub struct ItemRegistry {
    items_by_id: HashMap<u32, ItemDef>,
    items_by_name: HashMap<String, u32>,
}

impl ItemRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register<F>(&mut self, name: &str, builder_fn: F) -> &mut Self
    where
        F: FnOnce(ItemDefBuilder) -> ItemDefBuilder,
    {
        let lower_name = name.to_lowercase();

        if self.items_by_name.contains_key(&lower_name) {
            panic!("Duplicated item name: {}", name);
        }

        let id = self.next_id();
        let builder = ItemDefBuilder::new(id, name);
        let def = builder_fn(builder).build();

        if def.id != id {
            panic!(
                "Item '{}' has mismatched ID: expected {}, got {}",
                name, id, def.id
            );
        }

        self.items_by_name.insert(lower_name, id);
        self.items_by_id.insert(id, def);
        self
    }

    pub fn register_with_id<F>(&mut self, id: u32, name: &str, builder_fn: F) -> &mut Self
    where
        F: FnOnce(ItemDefBuilder) -> ItemDefBuilder,
    {
        let lower_name = name.to_lowercase();

        if self.items_by_id.contains_key(&id) {
            panic!("Duplicated item id: {}", id);
        }
        if self.items_by_name.contains_key(&lower_name) {
            panic!("Duplicated item name: {}", name);
        }

        let builder = ItemDefBuilder::new(id, name);
        let def = builder_fn(builder).build();

        self.items_by_name.insert(lower_name, id);
        self.items_by_id.insert(id, def);
        self
    }

    pub fn get_by_id(&self, id: u32) -> Option<&ItemDef> {
        self.items_by_id.get(&id)
    }

    pub fn get_by_name(&self, name: &str) -> Option<&ItemDef> {
        let lower_name = name.to_lowercase();
        self.items_by_name
            .get(&lower_name)
            .and_then(|id| self.items_by_id.get(id))
    }

    pub fn get_id_by_name(&self, name: &str) -> Option<u32> {
        let lower_name = name.to_lowercase();
        self.items_by_name.get(&lower_name).copied()
    }

    pub fn all_ids(&self) -> Vec<u32> {
        let mut ids = Vec::with_capacity(self.items_by_id.len());
        ids.extend(self.items_by_id.keys().copied());
        ids
    }

    pub fn all_items(&self) -> impl Iterator<Item = &ItemDef> {
        self.items_by_id.values()
    }

    pub fn count(&self) -> usize {
        self.items_by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items_by_id.is_empty()
    }

    pub fn to_client_json(&self) -> Value {
        let mut items = Vec::with_capacity(self.items_by_id.len());
        for def in self.items_by_id.values() {
            items.push(def.to_client_json());
        }
        serde_json::json!(items)
    }

    fn next_id(&self) -> u32 {
        self.items_by_id.keys().max().map_or(1, |max| max + 1)
    }
}

impl std::fmt::Debug for ItemRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ItemRegistry")
            .field("count", &self.count())
            .field("items", &self.items_by_id.keys().collect::<Vec<_>>())
            .finish()
    }
}
