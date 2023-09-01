use prost_wkt_types::Struct;
use serde::Serialize;

use crate::{utils::serialize_into_struct, EventData};

#[derive(Default)]
pub struct EventDataBuilder {
    pub name: String,
    pub payload: Option<Struct>,
}

impl EventDataBuilder {
    pub fn name(mut self, name: String) -> Self {
        self.name = name;
        self
    }

    pub fn payload<T: Serialize>(mut self, payload: T) -> Self {
        self.payload = Some(serialize_into_struct(payload).expect("Failed to serialize payload"));
        self
    }

    pub fn build(self) -> EventData {
        EventData {
            name: self.name,
            payload: self.payload,
        }
    }
}
