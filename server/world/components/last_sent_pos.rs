use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};

use crate::Vec3;

/// Remembers the last authoritative position sent to the client so we can
/// calculate divergence and decide whether to send a correction packet.
#[derive(Clone, Debug, Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct LastSentPos(pub Vec3<f32>);