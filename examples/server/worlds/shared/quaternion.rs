use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Default, Clone, Serialize, Deserialize)]
pub struct Quaternion(pub f32, pub f32, pub f32, pub f32);
