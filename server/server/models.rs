use std::io::{Cursor, Write};

use actix::Message as ActixMessage;
use libflate::zlib::Encoder;
use prost::Message as ProstMesssage;

use crate::libs::Ndarray;

/// Protocol buffers generated by `prost.rs`.
pub mod protocols {
    include!(concat!(env!("OUT_DIR"), "/protocol.rs"));
}

pub use protocols::Message;

pub type MessageType = protocols::message::Type;
pub type EntityOperation = protocols::entity::Operation;

impl ActixMessage for Message {
    type Result = ();
}

impl Message {
    /// Create a new protobuf message with the idiomatic Builder pattern.
    pub fn new(r#type: &MessageType) -> MessageBuilder {
        MessageBuilder {
            r#type: r#type.to_owned(),
            ..Default::default()
        }
    }
}

/// Encode message into protocol buffers.
pub fn encode_message(message: &Message) -> Vec<u8> {
    let mut buf = Vec::new();

    buf.reserve(message.encoded_len());
    message.encode(&mut buf).unwrap();

    if buf.len() > 1024 {
        let mut encoder = Encoder::new(Vec::new()).unwrap();
        encoder.write_all(buf.as_slice()).unwrap();
        buf = encoder.finish().into_result().unwrap();
    }

    buf
}

/// Decode protocol buffers into a message struct.
pub fn decode_message(buf: &[u8]) -> Result<Message, prost::DecodeError> {
    Message::decode(&mut Cursor::new(buf))
}

/// Protocol buffer compatible geometry data structure.
#[derive(Debug, Clone, Default)]
pub struct GeometryProtocol {
    pub voxel: u32,
    pub at: Vec<i32>,
    pub face_name: Option<String>,
    pub positions: Vec<f32>,
    pub indices: Vec<i32>,
    pub uvs: Vec<f32>,
    pub lights: Vec<i32>,
}

/// Protocol buffer compatible mesh data structure.
#[derive(Debug, Clone, Default)]
pub struct MeshProtocol {
    pub level: i32,
    pub geometries: Vec<GeometryProtocol>,
}

/// Protocol buffer compatible chunk data structure.
#[derive(Debug, Clone, Default)]
pub struct ChunkProtocol {
    pub x: i32,
    pub z: i32,
    pub id: String,
    pub meshes: Vec<MeshProtocol>,
    pub voxels: Option<Ndarray<u32>>,
    pub lights: Option<Ndarray<u32>>,
}

/// Protocol buffer compatible peer data structure.
#[derive(Debug, Clone, Default)]
pub struct PeerProtocol {
    pub id: String,
    pub username: String,
    pub metadata: String,
}

/// Protobuf buffer compatible update data structure.
#[derive(Debug, Clone, Default)]
pub struct UpdateProtocol {
    pub vx: i32,
    pub vy: i32,
    pub vz: i32,
    pub voxel: u32,
    pub light: u32,
}

/// Protocol buffer compatible entity data structure.
#[derive(Debug, Clone, Default)]
pub struct EntityProtocol {
    pub operation: EntityOperation,
    pub id: String,
    pub r#type: String,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ChatMessageProtocol {
    pub r#type: String,
    pub sender: String,
    pub body: String,
}

#[derive(Debug, Clone, Default)]
pub struct EventProtocol {
    pub name: String,
    pub payload: String,
}

#[derive(Debug, Clone, Default)]
pub struct MethodProtocol {
    pub name: String,
    pub payload: String,
}

/// Builder for a protocol buffer message.
#[derive(Default)]
pub struct MessageBuilder {
    r#type: MessageType,

    json: Option<String>,
    text: Option<String>,
    world_name: Option<String>,

    chat: Option<ChatMessageProtocol>,
    method: Option<MethodProtocol>,

    peers: Option<Vec<PeerProtocol>>,
    entities: Option<Vec<EntityProtocol>>,
    events: Option<Vec<EventProtocol>>,
    chunks: Option<Vec<ChunkProtocol>>,
    updates: Option<Vec<UpdateProtocol>>,
}

impl MessageBuilder {
    /// Configure the json data of the protocol.
    pub fn json(mut self, json: &str) -> Self {
        self.json = Some(json.to_owned());
        self
    }

    /// Configure the text data of the protocol.
    pub fn text(mut self, text: &str) -> Self {
        self.text = Some(text.to_owned());
        self
    }

    /// Configure the world name of the protocol.
    pub fn world_name(mut self, world_name: &str) -> Self {
        self.world_name = Some(world_name.to_owned());
        self
    }

    /// Configure the peers data of the protocol.
    pub fn peers(mut self, peers: &[PeerProtocol]) -> Self {
        self.peers = Some(peers.to_vec());
        self
    }

    /// Configure the entities data of the protocol.
    pub fn entities(mut self, entities: &[EntityProtocol]) -> Self {
        self.entities = Some(entities.to_vec());
        self
    }

    /// Configure the set of events to send in this message.
    pub fn events(mut self, events: &[EventProtocol]) -> Self {
        self.events = Some(events.to_vec());
        self
    }

    /// Configure the chunks data of the protocol.
    pub fn chunks(mut self, chunks: &[ChunkProtocol]) -> Self {
        self.chunks = Some(chunks.to_vec());
        self
    }

    /// Configure the voxel update data of the protocol.
    pub fn updates(mut self, updates: &[UpdateProtocol]) -> Self {
        self.updates = Some(updates.to_vec());
        self
    }

    /// Configure the method data of the protocol.
    pub fn method(mut self, method: MethodProtocol) -> Self {
        self.method = Some(method);
        self
    }

    /// Configure the chat data of the protocol.
    pub fn chat(mut self, chat: ChatMessageProtocol) -> Self {
        self.chat = Some(chat);
        self
    }

    /// Create a protocol buffer message.
    pub fn build(self) -> Message {
        let mut message = protocols::Message {
            r#type: self.r#type as i32,
            ..Default::default()
        };

        message.json = self.json.unwrap_or_default();
        message.text = self.text.unwrap_or_default();
        message.world_name = self.world_name.unwrap_or_default();

        if let Some(peers) = self.peers {
            message.peers = peers
                .into_iter()
                .map(|peer| protocols::Peer {
                    id: peer.id,
                    username: peer.username,
                    metadata: peer.metadata,
                })
                .collect();
        }

        if let Some(entities) = self.entities {
            message.entities = entities
                .into_iter()
                .map(|entity| protocols::Entity {
                    operation: entity.operation as i32,
                    id: entity.id,
                    r#type: entity.r#type,
                    metadata: entity.metadata.unwrap_or_default(),
                })
                .collect();
        }

        if let Some(events) = self.events {
            message.events = events
                .into_iter()
                .map(|event| protocols::Event {
                    name: event.name,
                    // Convert payload from json to struct
                    payload: event.payload,
                })
                .collect()
        }

        if let Some(chunks) = self.chunks {
            message.chunks = chunks
                .into_iter()
                .map(|chunk| protocols::Chunk {
                    id: chunk.id,
                    meshes: chunk
                        .meshes
                        .into_iter()
                        .map(|mesh| protocols::Mesh {
                            level: mesh.level,
                            geometries: mesh
                                .geometries
                                .into_iter()
                                .map(|geo| protocols::Geometry {
                                    voxel: geo.voxel,
                                    at: geo.at,
                                    face_name: geo.face_name,
                                    indices: geo.indices.to_owned(),
                                    positions: geo.positions.to_owned(),
                                    lights: geo.lights.to_owned(),
                                    uvs: geo.uvs.to_owned(),
                                })
                                .collect(),
                        })
                        .collect(),
                    lights: chunk.lights.unwrap_or_default().data,
                    voxels: chunk.voxels.unwrap_or_default().data,
                    x: chunk.x,
                    z: chunk.z,
                })
                .collect();
        }

        if let Some(updates) = self.updates {
            message.updates = updates
                .into_iter()
                .map(|update| protocols::Update {
                    vx: update.vx,
                    vy: update.vy,
                    vz: update.vz,
                    light: update.light,
                    voxel: update.voxel,
                })
                .collect()
        }

        if let Some(method) = self.method {
            message.method = Some(protocols::Method {
                name: method.name,
                payload: method.payload,
            });
        }

        if let Some(chat) = self.chat {
            message.chat = Some(protocols::ChatMessage {
                body: chat.body,
                sender: chat.sender,
                r#type: chat.r#type,
            });
        }

        message
    }
}
