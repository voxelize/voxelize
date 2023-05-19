use prost_wkt_types::Struct;
use serde::Serialize;

use crate::{utils::serialize_into_struct, Event};

#[derive(Default)]
pub struct EventBuilder {
    pub name: String,
    pub payload: Option<Struct>,
}

impl EventBuilder {
    pub fn name(mut self, name: String) -> Self {
        self.name = name;
        self
    }

    pub fn payload<T: Serialize>(mut self, payload: T) -> Self {
        self.payload = Some(serialize_into_struct(payload));
        self
    }

    pub fn build(self) -> Event {
        Event {
            name: self.name,
            payload: self.payload,
        }
    }
}
