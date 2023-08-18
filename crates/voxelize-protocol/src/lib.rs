mod builders;
mod utils;

use builders::{
    ActionDataBuilder, ChunkDataBuilder, EntityDataBuilder, EventDataBuilder, GeometryDataBuilder,
    MeshDataBuilder, MethodDataBuilder, PacketBuilder,
};

pub mod protocols {
    include!(concat!(env!("OUT_DIR"), "/protocol.rs"));
}

pub use protocols::{
    Action as ActionData, Chunk as ChunkData, Entity as EntityData, Event as EventData,
    Geometry as GeometryData, Mesh as MeshData, Message, Method as MethodData, Packet,
};

pub use utils::{decode_message, encode_message, serialize_into_struct};

/// The type of packet this is.
pub type PacketType = protocols::packet::Type;

/// What type of entity operation this is. It could be
/// create, update, and delete.
pub type EntityOperation = protocols::entity::Operation;

impl Message {
    pub fn new(packets: Vec<Packet>) -> Self {
        Self { packets }
    }

    pub fn from_packet(packet: Packet) -> Self {
        Self::new(vec![packet])
    }
}

impl Packet {
    pub fn new(r#type: PacketType) -> PacketBuilder {
        PacketBuilder {
            r#type,
            ..Default::default()
        }
    }

    pub fn get_type(&self) -> PacketType {
        PacketType::from_i32(self.r#type)
            .expect("Failed to convert packet type from i32 to PacketType")
    }

    pub fn from_type(r#type: PacketType) -> PacketBuilder {
        Packet::new(r#type)
    }
}

impl GeometryData {
    pub fn new(block_id: u32) -> GeometryDataBuilder {
        GeometryDataBuilder {
            block_id,
            ..Default::default()
        }
    }
}

impl MeshData {
    pub fn new(level: i32) -> MeshDataBuilder {
        MeshDataBuilder {
            level,
            ..Default::default()
        }
    }
}

impl ChunkData {
    pub fn new(x: i32, z: i32) -> ChunkDataBuilder {
        ChunkDataBuilder {
            x,
            z,
            ..Default::default()
        }
    }
}

impl MethodData {
    pub fn new(name: &str) -> MethodDataBuilder {
        MethodDataBuilder {
            name: name.to_owned(),
            ..Default::default()
        }
    }
}

impl ActionData {
    pub fn new(name: &str) -> ActionDataBuilder {
        ActionDataBuilder {
            name: name.to_owned(),
            ..Default::default()
        }
    }
}

impl EntityData {
    pub fn new(operation: EntityOperation) -> EntityDataBuilder {
        EntityDataBuilder {
            operation,
            ..Default::default()
        }
    }

    pub fn get_operation(&self) -> EntityOperation {
        EntityOperation::from_i32(self.operation)
            .expect("Failed to convert entity operation from i32 to EntityOperation")
    }
}

impl EventData {
    pub fn new(name: &str) -> EventDataBuilder {
        EventDataBuilder {
            name: name.to_owned(),
            ..Default::default()
        }
    }
}
