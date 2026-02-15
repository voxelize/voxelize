use std::borrow::Cow;

use hashbrown::{hash_map::Entry, HashMap};
use serde_json::Value;

use super::def::{ItemDef, ItemDefBuilder};

#[derive(Default, Clone)]
pub struct ItemRegistry {
    items_by_id: HashMap<u32, ItemDef>,
    items_by_name: HashMap<String, u32>,
    next_auto_id: u32,
}

impl ItemRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    fn normalized_name<'a>(name: &'a str) -> Cow<'a, str> {
        let mut has_non_ascii = false;
        for &byte in name.as_bytes() {
            if byte.is_ascii_uppercase() {
                return Cow::Owned(name.to_lowercase());
            }
            if !byte.is_ascii() {
                has_non_ascii = true;
            }
        }
        if !has_non_ascii {
            Cow::Borrowed(name)
        } else {
            for ch in name.chars() {
                if ch.is_uppercase() {
                    return Cow::Owned(name.to_lowercase());
                }
            }
            Cow::Borrowed(name)
        }
    }

    pub fn register<F>(&mut self, name: &str, builder_fn: F) -> &mut Self
    where
        F: FnOnce(ItemDefBuilder) -> ItemDefBuilder,
    {
        let lower_name = Self::normalized_name(name).into_owned();
        let id = self.next_id();
        let builder = ItemDefBuilder::new(id, name);
        let def = builder_fn(builder).build();

        if def.id != id {
            panic!(
                "Item '{}' has mismatched ID: expected {}, got {}",
                name, id, def.id
            );
        }

        let name_entry = match self.items_by_name.entry(lower_name) {
            Entry::Occupied(_) => panic!("Duplicated item name: {}", name),
            Entry::Vacant(entry) => entry,
        };
        name_entry.insert(id);
        self.items_by_id.insert(id, def);
        self
    }

    pub fn register_with_id<F>(&mut self, id: u32, name: &str, builder_fn: F) -> &mut Self
    where
        F: FnOnce(ItemDefBuilder) -> ItemDefBuilder,
    {
        let lower_name = Self::normalized_name(name).into_owned();

        if self.items_by_id.contains_key(&id) {
            panic!("Duplicated item id: {}", id);
        }
        let name_entry = match self.items_by_name.entry(lower_name) {
            Entry::Occupied(_) => panic!("Duplicated item name: {}", name),
            Entry::Vacant(entry) => entry,
        };

        let builder = ItemDefBuilder::new(id, name);
        let def = builder_fn(builder).build();

        name_entry.insert(id);
        self.items_by_id.insert(id, def);
        self.next_auto_id = self.next_auto_id.max(id.saturating_add(1));
        self
    }

    pub fn get_by_id(&self, id: u32) -> Option<&ItemDef> {
        self.items_by_id.get(&id)
    }

    pub fn get_by_name(&self, name: &str) -> Option<&ItemDef> {
        let lower_name = Self::normalized_name(name);
        self.items_by_name
            .get(lower_name.as_ref())
            .and_then(|id| self.items_by_id.get(id))
    }

    pub fn get_id_by_name(&self, name: &str) -> Option<u32> {
        let lower_name = Self::normalized_name(name);
        self.items_by_name.get(lower_name.as_ref()).copied()
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

    fn next_id(&mut self) -> u32 {
        if self.next_auto_id == 0 {
            self.next_auto_id = self
                .items_by_id
                .keys()
                .max()
                .map_or(1, |max| max.saturating_add(1));
        }

        while self.items_by_id.contains_key(&self.next_auto_id) {
            self.next_auto_id = self.next_auto_id.saturating_add(1);
        }

        let id = self.next_auto_id;
        self.next_auto_id = self.next_auto_id.saturating_add(1);
        id
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

#[cfg(test)]
mod tests {
    use super::ItemRegistry;

    #[test]
    fn register_assigns_sequential_auto_ids() {
        let mut registry = ItemRegistry::new();
        registry.register("wood", |builder| builder);
        registry.register("stone", |builder| builder);

        assert_eq!(registry.get_id_by_name("wood"), Some(1));
        assert_eq!(registry.get_id_by_name("stone"), Some(2));
    }

    #[test]
    fn register_skips_explicitly_reserved_ids() {
        let mut registry = ItemRegistry::new();
        registry.register("wood", |builder| builder);
        registry.register_with_id(10, "gem", |builder| builder);
        registry.register("stone", |builder| builder);

        assert_eq!(registry.get_id_by_name("wood"), Some(1));
        assert_eq!(registry.get_id_by_name("gem"), Some(10));
        assert_eq!(registry.get_id_by_name("stone"), Some(11));
    }
}
