use std::{f32, fmt};

use log::info;
use serde::{Deserialize, Serialize};

use crate::AABB;

/// Base class to extract voxel data from a single u32
///
/// Bit lineup as such (from right to left):
/// - `1 - 16 bits`: ID (0x0000FFFF)
/// - `17 - 20 bit`: rotation (0x000F0000)
/// - `21 - 24 bit`: y rotation (0x00F00000)
/// - `25 - 32 bit`: stage (0x0F000000)

pub const PY_ROTATION: u32 = 0;
pub const NY_ROTATION: u32 = 1;
pub const PX_ROTATION: u32 = 2;
pub const NX_ROTATION: u32 = 3;
pub const PZ_ROTATION: u32 = 4;
pub const NZ_ROTATION: u32 = 5;

pub const Y_000_ROTATION: u32 = 0;
pub const Y_045_ROTATION: u32 = 1;
pub const Y_090_ROTATION: u32 = 2;
pub const Y_135_ROTATION: u32 = 3;
pub const Y_180_ROTATION: u32 = 4;
pub const Y_225_ROTATION: u32 = 5;
pub const Y_270_ROTATION: u32 = 6;
pub const Y_315_ROTATION: u32 = 7;

pub const ROTATION_MASK: u32 = 0xFFF0FFFF;
pub const Y_ROTATION_MASK: u32 = 0xFF0FFFFF;
pub const STAGE_MASK: u32 = 0xF0FFFFFF;

/// Block rotation enumeration. There are 6 possible rotations: `(px, nx, py, ny, pz, nz)`. Default rotation is PY.
#[derive(PartialEq, Eq, Debug)]
pub enum BlockRotation {
    PX(u32),
    NX(u32),
    PY(u32),
    NY(u32),
    PZ(u32),
    NZ(u32),
}

const PI_2: f32 = f32::consts::PI / 2.0;

impl BlockRotation {
    /// Encode a set of rotations into a `BlockRotation` instance.
    pub fn encode(value: u32, y_rotation: u32) -> Self {
        let y_rotation = match y_rotation {
            Y_000_ROTATION => 0,
            Y_045_ROTATION => 45,
            Y_090_ROTATION => 90,
            Y_135_ROTATION => 135,
            Y_180_ROTATION => 180,
            Y_225_ROTATION => 225,
            Y_270_ROTATION => 270,
            Y_315_ROTATION => 315,
            _ => panic!("Unable to decode y-rotation: unknown rotation."),
        };

        match value {
            PX_ROTATION => BlockRotation::PX(y_rotation),
            NX_ROTATION => BlockRotation::NX(y_rotation),
            PY_ROTATION => BlockRotation::PY(y_rotation),
            NY_ROTATION => BlockRotation::NY(y_rotation),
            PZ_ROTATION => BlockRotation::PZ(y_rotation),
            NZ_ROTATION => BlockRotation::NZ(y_rotation),
            _ => panic!("Unknown rotation: {}", value),
        }
    }

    /// Decode a set of rotations from a `BlockRotation` instance.
    pub fn decode(rotation: &Self) -> (u32, u32) {
        let convert_y_rot = |val: u32| match val {
            0 => Y_000_ROTATION,
            45 => Y_045_ROTATION,
            90 => Y_090_ROTATION,
            135 => Y_135_ROTATION,
            180 => Y_180_ROTATION,
            225 => Y_225_ROTATION,
            270 => Y_270_ROTATION,
            315 => Y_315_ROTATION,
            _ => panic!("Unable to encode y-rotation: unknown y-rotation."),
        };

        match rotation {
            BlockRotation::PX(rot) => (PX_ROTATION, convert_y_rot(*rot)),
            BlockRotation::NX(rot) => (NX_ROTATION, convert_y_rot(*rot)),
            BlockRotation::PY(rot) => (PY_ROTATION, convert_y_rot(*rot)),
            BlockRotation::NY(rot) => (NY_ROTATION, convert_y_rot(*rot)),
            BlockRotation::PZ(rot) => (PZ_ROTATION, convert_y_rot(*rot)),
            BlockRotation::NZ(rot) => (NZ_ROTATION, convert_y_rot(*rot)),
        }
    }

    /// Rotate a 3D position with this block rotation.
    pub fn rotate(&self, node: &mut [f32; 3], translate: bool) {
        match self {
            BlockRotation::PX(rot) => {
                if *rot != 0 {
                    self.rotate_y(node, *rot as f32);
                }

                self.rotate_z(node, -PI_2);

                if translate {
                    node[1] += 1.0;
                }
            }
            BlockRotation::NX(rot) => {
                if *rot != 0 {
                    self.rotate_y(node, *rot as f32);
                }

                self.rotate_z(node, PI_2);

                if translate {
                    node[0] += 1.0;
                }
            }
            BlockRotation::PY(rot) => {
                if *rot != 0 {
                    self.rotate_y(node, *rot as f32);
                }
            }
            BlockRotation::NY(rot) => {
                if *rot != 0 {
                    self.rotate_y(node, *rot as f32);
                }

                self.rotate_x(node, PI_2 * 2.0);

                if translate {
                    node[1] += 1.0;
                    node[2] += 1.0;
                }
            }
            BlockRotation::PZ(rot) => {
                if *rot != 0 {
                    self.rotate_y(node, *rot as f32);
                }

                self.rotate_x(node, PI_2);

                if translate {
                    node[1] += 1.0;
                }
            }
            BlockRotation::NZ(rot) => {
                if *rot != 0 {
                    self.rotate_y(node, *rot as f32);
                }

                self.rotate_x(node, -PI_2);

                if translate {
                    node[2] += 1.0;
                }
            }
        }
    }

    /// Rotate the inverse of this block rotation on a 3D position.
    pub fn rotate_inv(&self, node: &mut [f32; 3], translate: bool) {
        match self {
            BlockRotation::PX(rot) => BlockRotation::NX(*rot).rotate(node, translate),
            BlockRotation::NX(rot) => BlockRotation::PX(*rot).rotate(node, translate),
            BlockRotation::PY(rot) => BlockRotation::NY(*rot).rotate(node, translate),
            BlockRotation::NY(rot) => BlockRotation::PY(*rot).rotate(node, translate),
            BlockRotation::PZ(rot) => BlockRotation::NZ(*rot).rotate(node, translate),
            BlockRotation::NZ(rot) => BlockRotation::PZ(*rot).rotate(node, translate),
        }
    }

    // Learned from
    // https://www.khanacademy.org/computer-programming/cube-rotated-around-x-y-and-z/4930679668473856

    /// Rotate a node on the x-axis.
    fn rotate_x(&self, node: &mut [f32; 3], theta: f32) {
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();

        let y = node[1];
        let z = node[2];

        node[1] = y * cos_theta - z * sin_theta;
        node[2] = z * cos_theta + y * sin_theta;
    }

    /// Rotate a node on the y-axis.
    fn rotate_y(&self, node: &mut [f32; 3], theta: f32) {
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();

        let x = node[0];
        let z = node[2];

        node[0] = x * cos_theta + z * sin_theta;
        node[2] = z * cos_theta - x * sin_theta;
    }

    /// Rotate a node on the z-axis.
    fn rotate_z(&self, node: &mut [f32; 3], theta: f32) {
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();

        let x = node[0];
        let y = node[1];

        node[0] = x * cos_theta - y * sin_theta;
        node[1] = y * cos_theta + x * sin_theta;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CornerData {
    pub pos: [f32; 3],
    pub uv: [f32; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BlockFace {
    pub name: String,
    pub dir: [i32; 3],
    pub corners: [CornerData; 4],
}

impl BlockFace {
    pub fn six_faces() -> Vec<BlockFace> {
        vec![
            BlockFace {
                name: "nx".to_owned(),
                dir: [-1, 0, 0],
                corners: [
                    CornerData {
                        pos: [0.0, 1.0, 0.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 0.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 1.0, 1.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 1.0],
                        uv: [1.0, 0.0],
                    },
                ],
            },
            BlockFace {
                name: "px".to_owned(),
                dir: [1, 0, 0],
                corners: [
                    CornerData {
                        pos: [1.0, 1.0, 1.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [1.0, 0.0, 1.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 0.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [1.0, 0.0, 0.0],
                        uv: [1.0, 0.0],
                    },
                ],
            },
            BlockFace {
                name: "ny".to_owned(),
                dir: [0, -1, 0],
                corners: [
                    CornerData {
                        pos: [1.0, 0.0, 1.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 1.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 0.0, 0.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 0.0],
                        uv: [0.0, 1.0],
                    },
                ],
            },
            BlockFace {
                name: "py".to_owned(),
                dir: [0, 1, 0],
                corners: [
                    CornerData {
                        pos: [0.0, 1.0, 1.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 1.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 1.0, 0.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 0.0],
                        uv: [0.0, 0.0],
                    },
                ],
            },
            BlockFace {
                name: "nz".to_owned(),
                dir: [0, 0, -1],
                corners: [
                    CornerData {
                        pos: [1.0, 0.0, 0.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 0.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 0.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 1.0, 0.0],
                        uv: [1.0, 1.0],
                    },
                ],
            },
            BlockFace {
                name: "pz".to_owned(),
                dir: [0, 0, 1],
                corners: [
                    CornerData {
                        pos: [0.0, 0.0, 1.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 0.0, 1.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 1.0, 1.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 1.0],
                        uv: [1.0, 1.0],
                    },
                ],
            },
        ]
    }

    pub fn bottom_slab_faces() -> Vec<BlockFace> {
        [
            BlockFace {
                name: "nx".to_owned(),
                dir: [-1, 0, 0],
                corners: [
                    CornerData {
                        pos: [0.0, 0.5, 0.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 0.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 0.5, 1.0],
                        uv: [1.0, 0.5],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 1.0],
                        uv: [1.0, 0.0],
                    },
                ],
            },
            BlockFace {
                name: "px".to_owned(),
                dir: [1, 0, 0],
                corners: [
                    CornerData {
                        pos: [1.0, 0.5, 1.0],
                        uv: [0.0, 0.5],
                    },
                    CornerData {
                        pos: [1.0, 0.0, 1.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 0.5, 0.0],
                        uv: [1.0, 0.5],
                    },
                    CornerData {
                        pos: [1.0, 0.0, 0.0],
                        uv: [1.0, 0.0],
                    },
                ],
            },
            BlockFace {
                name: "ny".to_owned(),
                dir: [0, -1, 0],
                corners: [
                    CornerData {
                        pos: [1.0, 0.0, 1.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 1.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 0.0, 0.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 0.0],
                        uv: [0.0, 1.0],
                    },
                ],
            },
            BlockFace {
                name: "py".to_owned(),
                dir: [0, 1, 0],
                corners: [
                    CornerData {
                        pos: [0.0, 0.5, 1.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [1.0, 0.5, 1.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 0.5, 0.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 0.5, 0.0],
                        uv: [0.0, 0.0],
                    },
                ],
            },
            BlockFace {
                name: "nz".to_owned(),
                dir: [0, 0, -1],
                corners: [
                    CornerData {
                        pos: [1.0, 0.0, 0.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 0.0, 0.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 0.5, 0.0],
                        uv: [0.0, 0.5],
                    },
                    CornerData {
                        pos: [0.0, 0.5, 0.0],
                        uv: [1.0, 0.5],
                    },
                ],
            },
            BlockFace {
                name: "pz".to_owned(),
                dir: [0, 0, 1],
                corners: [
                    CornerData {
                        pos: [0.0, 0.0, 1.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 0.0, 1.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 0.5, 1.0],
                        uv: [0.0, 0.5],
                    },
                    CornerData {
                        pos: [1.0, 0.5, 1.0],
                        uv: [1.0, 0.5],
                    },
                ],
            },
        ]
        .to_vec()
    }

    pub fn top_slab_faces() -> Vec<BlockFace> {
        [
            BlockFace {
                name: "nx".to_owned(),
                dir: [-1, 0, 0],
                corners: [
                    CornerData {
                        pos: [0.0, 1.0, 0.0],
                        uv: [0.0, 0.5],
                    },
                    CornerData {
                        pos: [0.0, 0.5, 0.0],
                        uv: [0.0, 0.5],
                    },
                    CornerData {
                        pos: [0.0, 1.0, 1.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 0.5, 1.0],
                        uv: [1.0, 0.5],
                    },
                ],
            },
            BlockFace {
                name: "px".to_owned(),
                dir: [1, 0, 0],
                corners: [
                    CornerData {
                        pos: [1.0, 1.0, 1.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [1.0, 0.5, 1.0],
                        uv: [0.0, 0.5],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 0.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [1.0, 0.5, 0.0],
                        uv: [1.0, 0.5],
                    },
                ],
            },
            BlockFace {
                name: "ny".to_owned(),
                dir: [0, -1, 0],
                corners: [
                    CornerData {
                        pos: [1.0, 0.5, 1.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [0.0, 0.5, 1.0],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 0.5, 0.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 0.5, 0.0],
                        uv: [0.0, 1.0],
                    },
                ],
            },
            BlockFace {
                name: "py".to_owned(),
                dir: [0, 1, 0],
                corners: [
                    CornerData {
                        pos: [0.0, 1.0, 1.0],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 1.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 1.0, 0.0],
                        uv: [1.0, 0.0],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 0.0],
                        uv: [0.0, 0.0],
                    },
                ],
            },
            BlockFace {
                name: "nz".to_owned(),
                dir: [0, 0, -1],
                corners: [
                    CornerData {
                        pos: [1.0, 0.5, 0.0],
                        uv: [0.0, 0.5],
                    },
                    CornerData {
                        pos: [0.0, 0.5, 0.0],
                        uv: [1.0, 0.5],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 0.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [0.0, 1.0, 0.0],
                        uv: [1.0, 1.0],
                    },
                ],
            },
            BlockFace {
                name: "pz".to_owned(),
                dir: [0, 0, 1],
                corners: [
                    CornerData {
                        pos: [0.0, 0.5, 1.0],
                        uv: [0.0, 0.5],
                    },
                    CornerData {
                        pos: [1.0, 0.5, 1.0],
                        uv: [1.0, 0.5],
                    },
                    CornerData {
                        pos: [0.0, 1.0, 1.0],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [1.0, 1.0, 1.0],
                        uv: [1.0, 1.0],
                    },
                ],
            },
        ]
        .to_vec()
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

    /// Is the block opaque?
    pub is_opaque: bool,

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

    /// The faces that this block has to render.
    pub faces: Vec<BlockFace>,

    /// Bounding boxes of this block.
    pub aabbs: Vec<AABB>,

    /// Is the block overall see-through? Opacity equals 0.1 or something?
    pub is_see_through: bool,

    /// Is the block transparent looking from the positive x-axis.
    pub is_px_transparent: bool,

    /// Is the block transparent looking from the negative x-axis.
    pub is_nx_transparent: bool,

    /// Is the block transparent looking from the positive y-axis.
    pub is_py_transparent: bool,

    /// Is the block transparent looking from the negative y-axis.
    pub is_ny_transparent: bool,

    /// Is the block transparent looking from the positive z-axis.
    pub is_pz_transparent: bool,

    /// Is the block transparent looking from the negative z-axis.
    pub is_nz_transparent: bool,
}

impl Block {
    pub fn new(name: &str) -> BlockBuilder {
        BlockBuilder::new(name)
    }
}

#[derive(Default)]
pub struct BlockBuilder {
    id: u32,
    name: String,
    rotatable: bool,
    y_rotatable: bool,
    is_block: bool,
    is_empty: bool,
    is_fluid: bool,
    is_light: bool,
    is_plant: bool,
    is_opaque: bool,
    red_light_level: u32,
    green_light_level: u32,
    blue_light_level: u32,
    is_plantable: bool,
    transparent_standalone: bool,
    faces: Vec<BlockFace>,
    aabbs: Vec<AABB>,
    is_see_through: bool,
    is_px_transparent: bool,
    is_py_transparent: bool,
    is_pz_transparent: bool,
    is_nx_transparent: bool,
    is_ny_transparent: bool,
    is_nz_transparent: bool,
}

impl BlockBuilder {
    /// Create a block builder with default values.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            is_block: true,
            is_opaque: true,
            faces: BlockFace::six_faces(),
            aabbs: vec![AABB::new(0.0, 0.0, 0.0, 1.0, 1.0, 1.0)],
            ..Default::default()
        }
    }

    /// Configure the ID of the block. Default would be the next available ID.
    pub fn id(mut self, id: u32) -> Self {
        if id == 0 {
            panic!("ID=0 is already Air!");
        }

        self.id = id;
        self
    }

    /// Configure whether or not this block is rotatable. Default is false.
    pub fn rotatable(mut self, rotatable: bool) -> Self {
        self.rotatable = rotatable;
        self
    }

    /// Configure whether or not this block is rotatable on the y-axis. Default is false.
    pub fn y_rotatable(mut self, y_rotatable: bool) -> Self {
        self.y_rotatable = y_rotatable;
        self
    }

    /// Configure whether or not this is a block. Default is true.
    pub fn is_block(mut self, is_block: bool) -> Self {
        self.is_block = is_block;
        self
    }

    /// Configure whether or not this is empty. Default is false.
    pub fn is_empty(mut self, is_empty: bool) -> Self {
        self.is_empty = is_empty;
        self
    }

    /// Configure whether or not this is a fluid. Default is false.
    pub fn is_fluid(mut self, is_fluid: bool) -> Self {
        self.is_fluid = is_fluid;
        self
    }

    /// Configure whether or not this block emits light. Default is false.
    pub fn is_light(mut self, is_light: bool) -> Self {
        self.is_light = is_light;
        self
    }

    /// Configure whether or not this block is a plant. Default is false.
    pub fn is_plant(mut self, is_plant: bool) -> Self {
        self.is_plant = is_plant;
        self
    }

    /// Configure the red light level of this block. Default is 0.
    pub fn red_light_level(mut self, red_light_level: u32) -> Self {
        self.red_light_level = red_light_level;
        self
    }

    /// Configure the green light level of this block. Default is 0.
    pub fn green_light_level(mut self, green_light_level: u32) -> Self {
        self.green_light_level = green_light_level;
        self
    }

    /// Configure the blue light level of this block. Default is 0.
    pub fn blue_light_level(mut self, blue_light_level: u32) -> Self {
        self.blue_light_level = blue_light_level;
        self
    }

    /// Configure whether or can plants grow on this block. Default is false.
    pub fn is_plantable(mut self, is_plantable: bool) -> Self {
        self.is_plantable = is_plantable;
        self
    }

    /// Configure whether or not should transparent faces be rendered individually. Default is false.
    pub fn transparent_standalone(mut self, transparent_standalone: bool) -> Self {
        self.transparent_standalone = transparent_standalone;
        self
    }

    /// Configure the faces that the block has. Default is `vec![]`.
    pub fn faces(mut self, faces: &[BlockFace]) -> Self {
        self.faces = faces.to_vec();
        self
    }

    /// Configure the bounding boxes that the block has. Default is `vec![]`.
    pub fn aabbs(mut self, aabbs: &[AABB]) -> Self {
        aabbs.iter().for_each(|aabb| {
            if aabb.min_x < 0.0
                || aabb.min_x > 1.0
                || aabb.min_y < 0.0
                || aabb.min_y > 1.0
                || aabb.min_z < 0.0
                || aabb.min_z > 1.0
                || aabb.max_x < 0.0
                || aabb.max_x > 1.0
                || aabb.max_y < 0.0
                || aabb.max_y > 1.0
                || aabb.max_z < 0.0
                || aabb.max_z > 1.0
            {
                panic!("Please keep AABB coordinates between 0,0,0 and 1,1,1.");
            }
        });
        self.aabbs = aabbs.to_vec();
        self
    }

    /// Is this block a see-through block? Should it be sorted to the transparent meshes?
    pub fn is_see_through(mut self, is_see_through: bool) -> Self {
        self.is_see_through = is_see_through;
        self
    }

    /// Configure whether or not this block is transparent on the x-axis. Default is false.
    pub fn is_x_transparent(mut self, is_x_transparent: bool) -> Self {
        self.is_px_transparent = is_x_transparent;
        self.is_nx_transparent = is_x_transparent;
        self
    }

    /// Configure whether or not this block is transparent on the y-axis. Default is false.
    pub fn is_y_transparent(mut self, is_y_transparent: bool) -> Self {
        self.is_py_transparent = is_y_transparent;
        self.is_ny_transparent = is_y_transparent;
        self
    }

    /// Configure whether or not this block is transparent on the z-axis. Default is false.
    pub fn is_z_transparent(mut self, is_z_transparent: bool) -> Self {
        self.is_pz_transparent = is_z_transparent;
        self.is_nz_transparent = is_z_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the positive x-axis. Default is false.
    pub fn is_px_transparent(mut self, is_px_transparent: bool) -> Self {
        self.is_px_transparent = is_px_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the positive y-axis. Default is false.    
    pub fn is_py_transparent(mut self, is_py_transparent: bool) -> Self {
        self.is_py_transparent = is_py_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the positive z-axis. Default is false.
    pub fn is_pz_transparent(mut self, is_pz_transparent: bool) -> Self {
        self.is_pz_transparent = is_pz_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the negative x-axis. Default is false.
    pub fn is_nx_transparent(mut self, is_nx_transparent: bool) -> Self {
        self.is_nx_transparent = is_nx_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the negative y-axis. Default is false.    
    pub fn is_ny_transparent(mut self, is_ny_transparent: bool) -> Self {
        self.is_ny_transparent = is_ny_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the negative z-axis. Default is false.
    pub fn is_nz_transparent(mut self, is_nz_transparent: bool) -> Self {
        self.is_nz_transparent = is_nz_transparent;
        self
    }

    /// Construct a block instance, ready to be added into the registry.
    pub fn build(self) -> Block {
        let mut sum_volume = 0.0;
        let mut area = 0.0;

        self.aabbs.iter().for_each(|aabb| {
            let aabb_area = aabb.width() * aabb.depth();
            area = if area > aabb_area { area } else { aabb_area };
            sum_volume += aabb.width() * aabb.height() * aabb.depth();
        });

        let is_full_block = (sum_volume - 1.0).abs() < f32::EPSILON;
        let is_sun_blocking = area >= 1.0;

        Block {
            id: self.id,
            name: self.name,
            rotatable: self.rotatable,
            y_rotatable: self.y_rotatable,
            is_block: self.is_block,
            is_empty: self.is_empty,
            is_fluid: self.is_fluid,
            is_light: self.is_light,
            is_plant: self.is_plant,
            is_opaque: !self.is_px_transparent
                && !self.is_py_transparent
                && !self.is_pz_transparent
                && !self.is_nx_transparent
                && !self.is_ny_transparent
                && !self.is_nz_transparent,
            red_light_level: self.red_light_level,
            green_light_level: self.green_light_level,
            blue_light_level: self.blue_light_level,
            is_plantable: self.is_plantable,
            transparent_standalone: self.transparent_standalone,
            faces: self.faces,
            aabbs: self.aabbs,
            is_see_through: self.is_see_through,
            is_px_transparent: self.is_px_transparent,
            is_py_transparent: self.is_py_transparent,
            is_pz_transparent: self.is_pz_transparent,
            is_nx_transparent: self.is_nx_transparent,
            is_ny_transparent: self.is_ny_transparent,
            is_nz_transparent: self.is_nz_transparent,
        }
    }
}
