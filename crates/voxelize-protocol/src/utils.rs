use libflate::zlib::Encoder;
use prost::Message as ProstMesssage;
use prost_wkt_types::Struct;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Cursor, Write};

use crate::protocols::Message;

pub fn serialize_into_struct<T: Serialize>(data: T) -> Result<Struct, serde_json::Error> {
    serde_json::from_value(json!(data))
}

pub fn deserialize_from_struct<T: for<'de> Deserialize<'de>>(
    data: &Struct,
) -> Result<T, serde_json::Error> {
    let value = serde_json::to_value(data).expect("failed to convert struct to value");
    match value {
        Value::Object(map) => {
            let mut new_map = serde_json::Map::new();
            for (k, v) in map {
                new_map.insert(k.to_string(), fix_sub_fields(v)?);
            }
            serde_json::from_value(Value::Object(new_map))
        }
        Value::Array(arr) => {
            let mut new_arr = Vec::new();
            for v in arr {
                new_arr.push(fix_sub_fields(v)?);
            }
            serde_json::from_value(Value::Array(new_arr))
        }
        Value::Number(num) => {
            if num.is_f64() {
                let int_val = num.as_f64().unwrap() as i64;
                serde_json::from_value(Value::Number(serde_json::Number::from(int_val)))
            } else {
                serde_json::from_value(Value::Number(
                    serde_json::Number::from_f64(num.as_f64().unwrap()).unwrap(),
                ))
            }
        }
        _ => serde_json::from_value(value),
    }
}

fn fix_sub_fields(value: Value) -> Result<Value, serde_json::Error> {
    match value {
        Value::Object(map) => {
            let mut new_map = serde_json::Map::new();
            for (k, v) in map {
                new_map.insert(k.to_string(), fix_sub_fields(v)?);
            }
            Ok(Value::Object(new_map))
        }
        Value::Array(arr) => {
            let mut new_arr = Vec::new();
            for v in arr {
                new_arr.push(fix_sub_fields(v)?);
            }
            Ok(Value::Array(new_arr))
        }
        Value::Number(num) => {
            if num.is_f64() {
                let int_val = num.as_f64().unwrap() as i64;
                Ok(Value::Number(serde_json::Number::from(int_val)))
            } else {
                Ok(Value::Number(
                    serde_json::Number::from_f64(num.as_f64().unwrap()).unwrap(),
                ))
            }
        }
        _ => Ok(value),
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
