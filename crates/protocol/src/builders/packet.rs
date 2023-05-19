use prost_wkt_types::Struct;
use serde::Serialize;

use crate::{utils::serialize_into_struct, Chunk, Entity, Event, Method, Packet, PacketType};

#[derive(Default)]
pub struct PacketBuilder {
    pub r#type: PacketType,

    pub json: Option<Struct>,
    pub method: Option<Method>,

    pub entities: Vec<Entity>,
    pub chunks: Vec<Chunk>,
    pub events: Vec<Event>,
}

impl PacketBuilder {
    pub fn r#type(mut self, r#type: PacketType) -> Self {
        self.r#type = r#type;
        self
    }

    pub fn json<T: Serialize>(mut self, json: T) -> Self {
        self.json = Some(serialize_into_struct(json));
        self
    }

    pub fn method(mut self, method: Method) -> Self {
        self.method = Some(method);
        self
    }

    pub fn entities(mut self, entities: Vec<Entity>) -> Self {
        self.entities = entities;
        self
    }

    pub fn chunks(mut self, chunks: Vec<Chunk>) -> Self {
        self.chunks = chunks;
        self
    }

    pub fn events(mut self, events: Vec<Event>) -> Self {
        self.events = events;
        self
    }

    pub fn build(self) -> Packet {
        Packet {
            r#type: self.r#type as i32,
            json: self.json,
            method: self.method,
            entities: self.entities,
            chunks: self.chunks,
            events: self.events,
        }
    }
}
