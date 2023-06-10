use prost_wkt_types::Struct;
use serde::Serialize;

pub fn serialize_into_struct<T: Serialize>(data: T) -> Struct {
    serde_json::from_value(serde_json::to_value(data).expect("failed to serialize metainfo"))
        .expect("failed to convert metainfo to struct")
}
