use prost_wkt_types::Struct;
use serde::Serialize;

use crate::{
    utils::serialize_into_struct, ActionData, ChunkData, EntityData, EventData, MethodData, Packet,
    PacketType,
};

#[derive(Default)]
pub struct PacketBuilder {
    pub r#type: PacketType,

    pub json: Option<Struct>,
    pub text: Option<String>,
    pub method: Option<MethodData>,
    pub action: Option<ActionData>,

    pub entities: Vec<EntityData>,
    pub chunks: Vec<ChunkData>,
    pub events: Vec<EventData>,
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

    pub fn text(mut self, text: &str) -> Self {
        self.text = Some(text.to_owned());
        self
    }

    pub fn method(mut self, method: MethodData) -> Self {
        self.method = Some(method);
        self
    }

    pub fn action(mut self, action: ActionData) -> Self {
        self.action = Some(action);
        self
    }

    pub fn entities(mut self, entities: Vec<EntityData>) -> Self {
        self.entities = entities;
        self
    }

    pub fn chunks(mut self, chunks: Vec<ChunkData>) -> Self {
        self.chunks = chunks;
        self
    }

    pub fn events(mut self, events: Vec<EventData>) -> Self {
        self.events = events;
        self
    }

    pub fn build(self) -> Packet {
        Packet {
            r#type: self.r#type as i32,
            json: self.json,
            text: self.text,
            method: self.method,
            action: self.action,
            entities: self.entities,
            chunks: self.chunks,
            events: self.events,
        }
    }
}
