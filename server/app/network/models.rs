use std::io::Cursor;

use actix::prelude::Message as ActixMessage;
use prost::{DecodeError, Message as ProstMesssage};

use crate::libs::{ndarray::Ndarray, vec::Vec3};

/// Load in the protobuf protocol
pub mod messages {
    include!(concat!(env!("OUT_DIR"), "/protocol.rs"));
}

pub use messages::Message;

impl ActixMessage for Message {
    type Result = ();
}

pub type MessageType = messages::message::Type;

pub struct Protocol {
    data: Message,
}

impl Protocol {
    pub fn new() -> ProtocolBuilder {
        ProtocolBuilder::default()
    }

    pub fn encoded(&self) -> Vec<u8> {
        Protocol::encode(&self.data)
    }

    pub fn encode(message: &Message) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.reserve(message.encoded_len());
        message.encode(&mut buf).unwrap();
        buf
    }

    pub fn decode(buf: &[u8]) -> Result<Message, DecodeError> {
        Message::decode(&mut Cursor::new(buf))
    }
}

#[derive(Debug, Clone)]
pub struct Geometry {
    pub positions: Vec<f32>,
    pub indices: Vec<i32>,
    pub uvs: Vec<f32>,
    pub aos: Vec<i32>,
    pub lights: Vec<i32>,
}

#[derive(Debug, Clone)]
pub struct Mesh {
    pub sub_chunk: i32,
    pub opaque: Option<Geometry>,
    pub transparent: Option<Geometry>,
}

#[derive(Debug, Clone)]
pub struct Chunk {
    pub x: i32,
    pub z: i32,
    pub id: String,
    pub mesh: Option<Mesh>,
    pub voxels: Option<Ndarray<u32>>,
    pub lights: Option<Ndarray<u32>>,
    pub height_map: Option<Ndarray<u32>>,
}

#[derive(Debug, Clone)]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub position: Option<Vec3<f32>>,
    pub direction: Option<Vec3<f32>>,
}

#[derive(Debug, Clone)]
pub struct Entity {
    pub id: String,
    pub r#type: String,
    pub data: String,
    pub position: Option<Vec3<f32>>,
    pub target: Option<Vec3<f32>>,
    pub heading: Option<Vec3<f32>>,
}

#[derive(Default)]
pub struct ProtocolBuilder {
    pub r#type: MessageType,

    pub json: Option<String>,
    pub text: Option<String>,
    pub peer: Option<Peer>,

    pub peers: Option<Vec<String>>,
    pub entities: Option<Vec<Entity>>,
    pub chunks: Option<Vec<Chunk>>,
}

fn vec3_to_vector3(vec3: &Option<Vec3<f32>>) -> Option<messages::Vector3> {
    if let Some(vec3) = vec3 {
        Some(messages::Vector3 {
            x: vec3.0,
            y: vec3.1,
            z: vec3.2,
        })
    } else {
        None
    }
}

impl ProtocolBuilder {
    pub fn r#type(mut self, r#type: MessageType) -> Self {
        self.r#type = r#type;
        self
    }

    pub fn json(mut self, json: &str) -> Self {
        self.json = Some(json.to_owned());
        self
    }

    pub fn text(mut self, text: &str) -> Self {
        self.text = Some(text.to_owned());
        self
    }

    pub fn peer(mut self, peer: Peer) -> Self {
        self.peer = Some(peer);
        self
    }

    pub fn peers(mut self, peers: &[String]) -> Self {
        self.peers = Some(peers.to_vec());
        self
    }

    pub fn entities(mut self, entities: &[Entity]) -> Self {
        self.entities = Some(entities.to_vec());
        self
    }

    pub fn chunks(mut self, chunks: &[Chunk]) -> Self {
        self.chunks = Some(chunks.to_vec());
        self
    }

    pub fn build(self) -> Protocol {
        let mut message = messages::Message {
            r#type: self.r#type as i32,
            ..Default::default()
        };

        message.json = self.json.unwrap_or_default();
        message.text = self.text.unwrap_or_default();
        message.peers = self.peers.unwrap_or_default();

        if let Some(peer) = self.peer {
            let Peer {
                id,
                name,
                direction,
                position,
            } = peer;

            message.peer = Some(messages::Peer {
                id,
                name,
                direction: vec3_to_vector3(&direction),
                position: vec3_to_vector3(&position),
            });
        }

        if let Some(entities) = self.entities {
            message.entities = entities
                .into_iter()
                .map(|entity| messages::Entity {
                    id: entity.id,
                    r#type: entity.r#type,
                    data: entity.data,
                    position: vec3_to_vector3(&entity.position),
                    target: vec3_to_vector3(&entity.target),
                    heading: vec3_to_vector3(&entity.heading),
                })
                .collect();
        }

        if let Some(chunks) = self.chunks {
            message.chunks = chunks
                .into_iter()
                .map(|chunk| messages::Chunk {
                    id: chunk.id,
                    mesh: if let Some(mesh) = chunk.mesh {
                        let opaque = mesh.opaque.as_ref();
                        let transparent = mesh.transparent.as_ref();

                        Some(messages::Mesh {
                            opaque: opaque.map(|opaque| messages::Geometry {
                                aos: opaque.aos.to_owned(),
                                indices: opaque.indices.to_owned(),
                                positions: opaque.positions.to_owned(),
                                lights: opaque.lights.to_owned(),
                                uvs: opaque.uvs.to_owned(),
                            }),
                            transparent: transparent.map(|transparent| messages::Geometry {
                                aos: transparent.aos.to_owned(),
                                indices: transparent.indices.to_owned(),
                                positions: transparent.positions.to_owned(),
                                lights: transparent.lights.to_owned(),
                                uvs: transparent.uvs.to_owned(),
                            }),
                        })
                    } else {
                        None
                    },
                    lights: chunk.lights.unwrap_or_default().data,
                    voxels: chunk.voxels.unwrap_or_default().data,
                    height_map: chunk.height_map.unwrap_or_default().data,
                    x: chunk.x,
                    z: chunk.z,
                })
                .collect();
        }

        Protocol { data: message }
    }
}
