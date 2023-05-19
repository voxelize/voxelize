use prost_wkt_types::Struct;
use serde::Serialize;

use crate::{utils::serialize_into_struct, Method};

#[derive(Default)]
pub struct MethodBuilder {
    pub name: String,
    pub payload: Option<Struct>,
}

impl MethodBuilder {
    pub fn name(mut self, name: &str) -> Self {
        self.name = name.to_owned();
        self
    }

    pub fn payload<T: Serialize>(mut self, payload: T) -> Self {
        self.payload = Some(serialize_into_struct(payload));
        self
    }

    pub fn build(self) -> Method {
        Method {
            name: self.name,
            payload: self.payload,
        }
    }
}
