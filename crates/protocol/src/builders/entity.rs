use prost_wkt_types::Struct;
use serde::Serialize;

use crate::{utils::serialize_into_struct, EntityData, EntityOperation};

#[derive(Default)]
pub struct EntityDataBuilder {
    pub operation: EntityOperation,

    pub id: String,
    pub r#type: String,

    pub metainfo: Option<Struct>,
}

impl EntityDataBuilder {
    pub fn operation(mut self, operation: EntityOperation) -> Self {
        self.operation = operation;
        self
    }

    pub fn id(mut self, id: String) -> Self {
        self.id = id;
        self
    }

    pub fn r#type(mut self, r#type: String) -> Self {
        self.r#type = r#type;
        self
    }

    pub fn metainfo<T: Serialize>(mut self, metainfo: T) -> Self {
        self.metainfo = Some(serialize_into_struct(metainfo));
        self
    }

    pub fn build(self) -> EntityData {
        EntityData {
            operation: self.operation as i32,
            id: self.id,
            r#type: self.r#type,
            metainfo: self.metainfo,
        }
    }
}
