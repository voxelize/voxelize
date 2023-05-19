mod builders;
mod utils;

use builders::{
    ChunkBuilder, EntityBuilder, EventBuilder, GeometryBuilder, MeshBuilder, PacketBuilder,
};

pub mod protocols {
    include!(concat!(env!("OUT_DIR"), "/protocol.rs"));
}

pub use protocols::{Chunk, Entity, Event, Geometry, Mesh, Message, Method, Packet};

/// The type of packet this is.
pub type PacketType = protocols::packet::Type;

/// What type of entity operation this is. It could be
/// create, update, and delete.
pub type EntityOperation = protocols::entity::Operation;

impl Message {
    pub fn new(packets: Vec<Packet>) -> Self {
        Self { packets }
    }
}

impl Packet {
    pub fn new(r#type: PacketType) -> PacketBuilder {
        PacketBuilder {
            r#type,
            ..Default::default()
        }
    }
}

impl Geometry {
    pub fn new(block_id: u32) -> GeometryBuilder {
        GeometryBuilder {
            block_id,
            ..Default::default()
        }
    }
}

impl Mesh {
    pub fn new(level: i32) -> MeshBuilder {
        MeshBuilder {
            level,
            ..Default::default()
        }
    }
}

impl Chunk {
    pub fn new(x: i32, z: i32) -> ChunkBuilder {
        ChunkBuilder {
            x,
            z,
            ..Default::default()
        }
    }
}

impl Entity {
    pub fn new(operation: EntityOperation) -> EntityBuilder {
        EntityBuilder {
            operation,
            ..Default::default()
        }
    }
}

impl Event {
    pub fn new(name: &str) -> EventBuilder {
        EventBuilder {
            name: name.to_owned(),
            ..Default::default()
        }
    }
}
