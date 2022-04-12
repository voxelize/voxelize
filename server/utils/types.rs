#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use std::collections::HashMap;

pub type TypeMap = HashMap<String, u32>;

/// Serializable struct representing a UV coordinate
#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BlockFaces {
    All,
    Top,
    Side,
    Bottom,
    Px,
    Py,
    Pz,
    Nx,
    Ny,
    Nz,
    Diagonal,
}

/// Serializable struct representing block data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    /// Name of the block.
    pub name: String,

    /// Whether or not the block is rotatable.
    pub rotatable: bool,

    /// Whether or not can the block rotate on the y-axis relative to it's overall rotation.
    pub y_rotatable: bool,

    /// Is the block a block?
    pub is_block: bool,

    /// Is the block empty space?
    pub is_empty: bool,

    /// Is the block a fluid?
    pub is_fluid: bool,

    /// Does the block emit light?
    pub is_light: bool,

    /// Is the block a type of plant?
    pub is_plant: bool,

    /// Is the block a solid?
    pub is_solid: bool,

    /// Is the block transparent and see-through?
    pub is_transparent: bool,

    /// Red-light level of the block.
    pub red_light_level: u32,

    /// Green-light level of the block.
    pub green_light_level: u32,

    /// Blue-light level of the block.
    pub blue_light_level: u32,

    /// Can plants grow on this block?
    pub is_plantable: bool,

    /// Do faces of this transparent block need to be rendered?
    pub transparent_standalone: bool,

    /// The faces of the block that has texture, divided into three four categories, sorted in
    /// descending priority:
    ///
    /// Diagonal faces: `Diagonal`
    /// Six faces: `Px`, `Py`, `Pz`, `Nx`, `Ny`, `Nz`
    /// Three faces: `Top`, `Side`, `Bottom`
    /// All faces: `All`
    pub faces: Vec<BlockFaces>,
}
