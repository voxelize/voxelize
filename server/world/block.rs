use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
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

impl fmt::Display for BlockFaces {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

/// Serializable struct representing block data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    /// ID of the block.
    pub id: u32,

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

impl Block {
    pub fn new(name: &str) -> BlockBuilder {
        BlockBuilder {
            id: 0,
            name: name.to_owned(),
            ..Default::default()
        }
    }
}

#[derive(Default)]
pub struct BlockBuilder {
    id: u32,
    name: String,
    rotatable: Option<bool>,
    y_rotatable: Option<bool>,
    is_block: Option<bool>,
    is_empty: Option<bool>,
    is_fluid: Option<bool>,
    is_light: Option<bool>,
    is_plant: Option<bool>,
    is_solid: Option<bool>,
    is_transparent: Option<bool>,
    red_light_level: Option<u32>,
    green_light_level: Option<u32>,
    blue_light_level: Option<u32>,
    is_plantable: Option<bool>,
    transparent_standalone: Option<bool>,
    faces: Option<Vec<BlockFaces>>,
}

impl BlockBuilder {
    /// Configure whether or not this block is rotatable. Default is false.
    pub fn rotatable(mut self, rotatable: bool) -> Self {
        self.rotatable = Some(rotatable);
        self
    }

    /// Configure whether or not this block is rotatable on the y-axis. Default is false.
    pub fn y_rotatable(mut self, y_rotatable: bool) -> Self {
        self.y_rotatable = Some(y_rotatable);
        self
    }

    /// Configure whether or not this is a block. Default is true.
    pub fn is_block(mut self, is_block: bool) -> Self {
        self.is_block = Some(is_block);
        self
    }

    /// Configure whether or not this is empty. Default is false.
    pub fn is_empty(mut self, is_empty: bool) -> Self {
        self.is_empty = Some(is_empty);
        self
    }

    /// Configure whether or not this is a fluid. Default is false.
    pub fn is_fluid(mut self, is_fluid: bool) -> Self {
        self.is_fluid = Some(is_fluid);
        self
    }

    /// Configure whether or not this block emits light. Default is false.
    pub fn is_light(mut self, is_light: bool) -> Self {
        self.is_light = Some(is_light);
        self
    }

    /// Configure whether or not this block is a plant. Default is false.
    pub fn is_plant(mut self, is_plant: bool) -> Self {
        self.is_plant = Some(is_plant);
        self
    }

    /// Configure whether or not this block is a solid. Default is true.
    pub fn is_solid(mut self, is_solid: bool) -> Self {
        self.is_solid = Some(is_solid);
        self
    }

    /// Configure whether or not this block is transparent. Default is false.
    pub fn is_transparent(mut self, is_transparent: bool) -> Self {
        self.is_transparent = Some(is_transparent);
        self
    }

    /// Configure the red light level of this block. Default is 0.
    pub fn red_light_level(mut self, red_light_level: u32) -> Self {
        self.red_light_level = Some(red_light_level);
        self
    }

    /// Configure the green light level of this block. Default is 0.
    pub fn green_light_level(mut self, green_light_level: u32) -> Self {
        self.green_light_level = Some(green_light_level);
        self
    }

    /// Configure the blue light level of this block. Default is 0.
    pub fn blue_light_level(mut self, blue_light_level: u32) -> Self {
        self.blue_light_level = Some(blue_light_level);
        self
    }

    /// Configure whether or can plants grow on this block. Default is false.
    pub fn is_plantable(mut self, is_plantable: bool) -> Self {
        self.is_plantable = Some(is_plantable);
        self
    }

    /// Configure whether or not should transparent faces be rendered individually. Default is false.
    pub fn transparent_standalone(mut self, transparent_standalone: bool) -> Self {
        self.transparent_standalone = Some(transparent_standalone);
        self
    }

    /// Configure the faces that the block has. Default is `vec![]`.
    pub fn faces(mut self, faces: &[BlockFaces]) -> Self {
        self.faces = Some(faces.to_vec());
        self
    }

    /// Construct a block instance, ready to be added into the registry.
    pub fn build(self) -> Block {
        Block {
            id: self.id,
            name: self.name,
            rotatable: self.rotatable.unwrap_or_else(|| false),
            y_rotatable: self.y_rotatable.unwrap_or_else(|| false),
            is_block: self.is_block.unwrap_or_else(|| true),
            is_empty: self.is_empty.unwrap_or_else(|| false),
            is_fluid: self.is_fluid.unwrap_or_else(|| false),
            is_light: self.is_light.unwrap_or_else(|| false),
            is_plant: self.is_plant.unwrap_or_else(|| false),
            is_solid: self.is_solid.unwrap_or_else(|| true),
            is_transparent: self.is_transparent.unwrap_or_else(|| false),
            red_light_level: self.red_light_level.unwrap_or_else(|| 0),
            green_light_level: self.green_light_level.unwrap_or_else(|| 0),
            blue_light_level: self.blue_light_level.unwrap_or_else(|| 0),
            is_plantable: self.is_plantable.unwrap_or_else(|| false),
            transparent_standalone: self.transparent_standalone.unwrap_or_else(|| false),
            faces: self.faces.unwrap_or_else(|| vec![BlockFaces::All]),
        }
    }
}
