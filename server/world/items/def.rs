use hashbrown::HashMap;
use serde_json::Value;
use std::any::TypeId;

use super::component::ItemComponent;

#[derive(Clone)]
pub struct ItemDef {
    pub id: u32,
    pub name: String,
    components: HashMap<TypeId, Box<dyn ItemComponent>>,
}

impl ItemDef {
    pub fn new(id: u32, name: impl Into<String>) -> Self {
        Self {
            id,
            name: name.into(),
            components: HashMap::new(),
        }
    }

    pub fn get<T: ItemComponent + 'static>(&self) -> Option<&T> {
        self.components
            .get(&TypeId::of::<T>())
            .and_then(|c| c.as_any().downcast_ref::<T>())
    }

    pub fn get_mut<T: ItemComponent + 'static>(&mut self) -> Option<&mut T> {
        self.components
            .get_mut(&TypeId::of::<T>())
            .and_then(|c| c.as_any_mut().downcast_mut::<T>())
    }

    pub fn has<T: ItemComponent + 'static>(&self) -> bool {
        self.components.contains_key(&TypeId::of::<T>())
    }

    pub fn insert<T: ItemComponent + 'static>(&mut self, component: T) {
        self.components
            .insert(TypeId::of::<T>(), Box::new(component));
    }

    pub fn to_client_json(&self) -> Value {
        let mut components_map: HashMap<String, Value> =
            HashMap::with_capacity(self.components.len());

        for component in self.components.values() {
            let name = component.component_name();
            let value = component.to_json();
            components_map.insert(name.to_string(), value);
        }

        serde_json::json!({
            "id": self.id,
            "name": self.name,
            "components": components_map
        })
    }
}

impl std::fmt::Debug for ItemDef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ItemDef")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("component_count", &self.components.len())
            .finish()
    }
}

pub struct ItemDefBuilder {
    def: ItemDef,
}

impl ItemDefBuilder {
    pub fn new(id: u32, name: impl Into<String>) -> Self {
        Self {
            def: ItemDef::new(id, name),
        }
    }

    pub fn with<T: ItemComponent + 'static>(mut self, component: T) -> Self {
        self.def.insert(component);
        self
    }

    pub fn build(self) -> ItemDef {
        self.def
    }
}
