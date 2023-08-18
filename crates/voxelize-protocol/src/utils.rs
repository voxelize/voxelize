use libflate::zlib::Encoder;
use prost::Message as ProstMesssage;
use prost_wkt_types::Struct;
use serde::Serialize;
use std::io::{Cursor, Write};

use crate::protocols::Message;

pub fn serialize_into_struct<T: Serialize>(data: T) -> Struct {
    serde_json::from_value(serde_json::to_value(data).expect("failed to serialize metainfo"))
        .expect("failed to convert metainfo to struct")
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
