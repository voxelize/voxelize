use prost_wkt_types::Struct;
use serde::Serialize;

use crate::{utils::serialize_into_struct, ActionData};

#[derive(Default)]
pub struct ActionDataBuilder {
    pub name: String,
    pub payload: Option<Struct>,
}

impl ActionDataBuilder {
    pub fn name(mut self, name: &str) -> Self {
        self.name = name.to_owned();
        self
    }

    pub fn payload<T: Serialize>(mut self, payload: T) -> Self {
        self.payload = Some(serialize_into_struct(payload).expect("Failed to serialize payload"));
        self
    }

    pub fn build(self) -> ActionData {
        ActionData {
            name: self.name,
            payload: self.payload,
        }
    }
}
