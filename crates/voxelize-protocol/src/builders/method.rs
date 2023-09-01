use prost_wkt_types::Struct;
use serde::Serialize;

use crate::{utils::serialize_into_struct, MethodData};

#[derive(Default)]
pub struct MethodDataBuilder {
    pub name: String,
    pub payload: Option<Struct>,
}

impl MethodDataBuilder {
    pub fn name(mut self, name: &str) -> Self {
        self.name = name.to_owned();
        self
    }

    pub fn payload<T: Serialize>(mut self, payload: T) -> Self {
        self.payload = Some(serialize_into_struct(payload).expect("Failed to serialize payload"));
        self
    }

    pub fn build(self) -> MethodData {
        MethodData {
            name: self.name,
            payload: self.payload,
        }
    }
}
