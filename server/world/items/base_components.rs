use serde::{Deserialize, Serialize};

use super::component::ItemComponentName;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StackableComp {
    #[serde(rename = "maxStack")]
    pub max_stack: u32,
}

impl StackableComp {
    pub fn new(max_stack: u32) -> Self {
        Self { max_stack }
    }

    pub fn single() -> Self {
        Self { max_stack: 1 }
    }

    pub fn stack_64() -> Self {
        Self { max_stack: 64 }
    }
}

impl Default for StackableComp {
    fn default() -> Self {
        Self { max_stack: 1 }
    }
}

impl ItemComponentName for StackableComp {
    const COMPONENT_NAME: &'static str = "stackable";
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DurableComp {
    #[serde(rename = "maxDurability")]
    pub max_durability: u32,
}

impl DurableComp {
    pub fn new(max_durability: u32) -> Self {
        Self { max_durability }
    }
}

impl ItemComponentName for DurableComp {
    const COMPONENT_NAME: &'static str = "durable";
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DisplayComp {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl DisplayComp {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: None,
        }
    }

    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }
}

impl ItemComponentName for DisplayComp {
    const COMPONENT_NAME: &'static str = "display";
}
