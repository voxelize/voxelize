use serde::{Deserialize, Serialize};

/// Serializable struct representing a UV coordinate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct UV {
    /// Starting u-coordinate.
    pub start_u: f32,

    /// Ending u-coordinate.
    pub end_u: f32,

    /// Starting v-coordinate.
    pub start_v: f32,

    /// Ending v-coordinate.
    pub end_v: f32,
}
