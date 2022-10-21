use std::f32;

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
    pub fn rotate_node(&self, node: &mut [f32; 3], translate: bool) {
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

    /// Rotate an AABB.
    pub fn rotate_aabb(&self, aabb: &AABB, translate: bool) -> AABB {
        let mut min = [aabb.min_x, aabb.min_y, aabb.min_z];
        let mut max = [aabb.max_x, aabb.max_y, aabb.max_z];
        self.rotate_node(&mut min, translate);
        self.rotate_node(&mut max, translate);
        AABB {
            min_x: min[0].min(max[0]),
            min_y: min[1].min(max[1]),
            min_z: min[2].min(max[2]),
            max_x: max[0].max(min[0]),
            max_y: max[1].max(min[1]),
            max_z: max[2].max(min[2]),
        }
    }

    /// Rotate transparency, let math do the work.
    pub fn rotate_transparency(&self, [px, py, pz, nx, ny, nz]: [bool; 6]) -> [bool; 6] {
        let mut positive = [1.0, 2.0, 3.0];
        let mut negative = [4.0, 5.0, 6.0];

        self.rotate_node(&mut positive, false);
        self.rotate_node(&mut negative, false);

        let p: Vec<bool> = positive
            .into_iter()
            .map(|n| {
                if n == 1.0 {
                    px
                } else if n == 2.0 {
                    py
                } else if n == 3.0 {
                    pz
                } else if n == 4.0 {
                    nx
                } else if n == 5.0 {
                    ny
                } else {
                    nz
                }
            })
            .collect();

        let n: Vec<bool> = negative
            .into_iter()
            .map(|n| {
                if n == 1.0 {
                    px
                } else if n == 2.0 {
                    py
                } else if n == 3.0 {
                    pz
                } else if n == 4.0 {
                    nx
                } else if n == 5.0 {
                    ny
                } else {
                    nz
                }
            })
            .collect();

        [p[0], p[1], p[2], n[0], n[1], n[2]]
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
    /// Create and customize a six-faced block face data.
    pub fn six_faces() -> SixFacesBuilder {
        SixFacesBuilder::new()
    }

    /// Create and customize a diagonal-faced block face data.
    pub fn diagonal_faces() -> DiagonalFacesBuilder {
        DiagonalFacesBuilder::new()
    }
}

pub struct DiagonalFacesBuilder {
    scale_horizontal: f32,
    scale_vertical: f32,
    offset_x: f32,
    offset_y: f32,
    offset_z: f32,
    prefix: String,
    suffix: String,
    concat: String,
}

impl DiagonalFacesBuilder {
    /// Create a new diagonal faces builder.
    pub fn new() -> DiagonalFacesBuilder {
        DiagonalFacesBuilder {
            scale_horizontal: 1.0,
            scale_vertical: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            offset_z: 0.0,
            prefix: "".to_string(),
            suffix: "".to_string(),
            concat: "".to_string(),
        }
    }

    /// Set the scale of the horizontal faces.
    pub fn scale_horizontal(mut self, scale: f32) -> Self {
        self.scale_horizontal = scale;
        self
    }

    /// Set the scale of the vertical faces.
    pub fn scale_vertical(mut self, scale: f32) -> Self {
        self.scale_vertical = scale;
        self
    }

    /// Set the offset of the x-axis.
    pub fn offset_x(mut self, offset: f32) -> Self {
        self.offset_x = offset;
        self
    }

    /// Set the offset of the y-axis.
    pub fn offset_y(mut self, offset: f32) -> Self {
        self.offset_y = offset;
        self
    }

    /// Set the offset of the z-axis.
    pub fn offset_z(mut self, offset: f32) -> Self {
        self.offset_z = offset;
        self
    }

    /// Set the prefix of the faces.
    pub fn prefix(mut self, prefix: &str) -> Self {
        self.prefix = prefix.to_string();
        self
    }

    /// Set the suffix of the faces.
    pub fn suffix(mut self, suffix: &str) -> Self {
        self.suffix = suffix.to_string();
        self
    }

    /// Set the concatenation of the faces.
    pub fn concat(mut self, concat: &str) -> Self {
        self.concat = concat.to_string();
        self
    }

    /// Build the diagonal faces.
    pub fn build(self) -> Vec<BlockFace> {
        let Self {
            scale_horizontal,
            scale_vertical,
            offset_x,
            offset_y,
            offset_z,
            prefix,
            suffix,
            concat,
        } = self;

        let make_name = |side: &str| {
            let mut name = "".to_owned();
            if !prefix.is_empty() {
                name += &prefix;
            }
            if !concat.is_empty() {
                name += &concat;
            }
            name += side;
            if !concat.is_empty() {
                name += &concat;
            }
            if !suffix.is_empty() {
                name += &suffix;
            }
            name
        };

        let h_min = (1.0 - scale_horizontal) / 2.0;
        let h_max = 1.0 - h_min;

        vec![
            BlockFace {
                name: make_name("one"),
                dir: [0, 0, 0],
                corners: [
                    CornerData {
                        pos: [
                            offset_x + h_min,
                            offset_y + scale_vertical,
                            offset_z + h_min,
                        ],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [offset_x + h_min, offset_y + 0.0, offset_z + h_min],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [
                            offset_x + h_max,
                            offset_y + scale_vertical,
                            offset_z + h_max,
                        ],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [offset_x + h_max, offset_y + 0.0, offset_z + h_max],
                        uv: [1.0, 0.0],
                    },
                ],
            },
            BlockFace {
                name: make_name("two"),
                dir: [0, 0, 0],
                corners: [
                    CornerData {
                        pos: [
                            offset_x + h_max,
                            offset_y + scale_vertical,
                            offset_z + h_min,
                        ],
                        uv: [0.0, 1.0],
                    },
                    CornerData {
                        pos: [offset_x + h_max, offset_y + 0.0, offset_z + h_min],
                        uv: [0.0, 0.0],
                    },
                    CornerData {
                        pos: [
                            offset_x + h_min,
                            offset_y + scale_vertical,
                            offset_z + h_max,
                        ],
                        uv: [1.0, 1.0],
                    },
                    CornerData {
                        pos: [offset_x + h_min, offset_y + 0.0, offset_z + h_max],
                        uv: [1.0, 0.0],
                    },
                ],
            },
        ]
    }
}

pub struct SixFacesBuilder {
    scale_x: f32,
    scale_y: f32,
    scale_z: f32,
    offset_x: f32,
    offset_y: f32,
    offset_z: f32,
    uv_scale_x: f32,
    uv_scale_y: f32,
    uv_scale_z: f32,
    uv_offset_x: f32,
    uv_offset_y: f32,
    uv_offset_z: f32,
    prefix: String,
    suffix: String,
    concat: String,
}

impl SixFacesBuilder {
    /// Create a new six-faced block faces data builder.
    pub fn new() -> Self {
        Self {
            scale_x: 1.0,
            scale_y: 1.0,
            scale_z: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            offset_z: 0.0,
            uv_scale_x: 1.0,
            uv_scale_y: 1.0,
            uv_scale_z: 1.0,
            uv_offset_x: 0.0,
            uv_offset_y: 0.0,
            uv_offset_z: 0.0,
            prefix: "".to_owned(),
            suffix: "".to_owned(),
            concat: "".to_owned(),
        }
    }

    /// Configure the x scale of this six faces.
    pub fn scale_x(mut self, scale_x: f32) -> Self {
        self.scale_x = scale_x;
        self
    }

    /// Configure the y scale of this six faces.
    pub fn scale_y(mut self, scale_y: f32) -> Self {
        self.scale_y = scale_y;
        self
    }

    /// Configure the z scale of this six faces.
    pub fn scale_z(mut self, scale_z: f32) -> Self {
        self.scale_z = scale_z;
        self
    }

    /// Configure the x offset of this six faces.
    pub fn offset_x(mut self, offset_x: f32) -> Self {
        self.offset_x = offset_x;
        self
    }

    /// Configure the y offset of this six faces.
    pub fn offset_y(mut self, offset_y: f32) -> Self {
        self.offset_y = offset_y;
        self
    }

    /// Configure the z offset of this six faces.
    pub fn offset_z(mut self, offset_z: f32) -> Self {
        self.offset_z = offset_z;
        self
    }

    /// Configure the UV x scale of this six faces.
    pub fn uv_scale_x(mut self, uv_scale_x: f32) -> Self {
        self.uv_scale_x = uv_scale_x;
        self
    }

    /// Configure the UV y scale of this six faces.
    pub fn uv_scale_y(mut self, uv_scale_y: f32) -> Self {
        self.uv_scale_y = uv_scale_y;
        self
    }

    /// Configure the UV z scale of this six faces.
    pub fn uv_scale_z(mut self, uv_scale_z: f32) -> Self {
        self.uv_scale_z = uv_scale_z;
        self
    }

    /// Configure the UV x offset of the six faces.
    pub fn uv_offset_x(mut self, uv_offset_x: f32) -> Self {
        self.uv_offset_x = uv_offset_x;
        self
    }

    /// Configure the UV y offset of the six faces.
    pub fn uv_offset_y(mut self, uv_offset_y: f32) -> Self {
        self.uv_offset_y = uv_offset_y;
        self
    }

    /// Configure the UV z offset of the six faces.
    pub fn uv_offset_z(mut self, uv_offset_z: f32) -> Self {
        self.uv_offset_z = uv_offset_z;
        self
    }

    /// Configure the prefix to be appended to each face name.
    pub fn prefix(mut self, prefix: &str) -> Self {
        self.prefix = prefix.to_owned();
        self
    }

    /// Configure the suffix to be added in front of each face name.
    pub fn suffix(mut self, suffix: &str) -> Self {
        self.suffix = suffix.to_owned();
        self
    }

    /// Configure the concat between the prefix, face name, and suffix.
    pub fn concat(mut self, concat: &str) -> Self {
        self.concat = concat.to_owned();
        self
    }

    /// Create the six faces of a block.
    pub fn build(self) -> Vec<BlockFace> {
        let Self {
            offset_x,
            offset_y,
            offset_z,
            uv_offset_x,
            uv_offset_y,
            uv_offset_z,
            scale_x,
            scale_y,
            scale_z,
            uv_scale_x,
            uv_scale_y,
            uv_scale_z,
            prefix,
            suffix,
            concat,
        } = self;

        let make_name = |side: &str| {
            let mut name = "".to_owned();
            if !prefix.is_empty() {
                name += &prefix;
            }
            if !concat.is_empty() {
                name += &concat;
            }
            name += side;
            if !concat.is_empty() {
                name += &concat;
            }
            if !suffix.is_empty() {
                name += &suffix;
            }
            name
        };

        vec![
            BlockFace {
                name: make_name("nx"),
                dir: [-1, 0, 0],
                corners: [
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: [uv_offset_z, 1.0 * uv_scale_y + uv_offset_y],
                    },
                    CornerData {
                        pos: [offset_x, offset_y, offset_z],
                        uv: [uv_offset_z, uv_offset_y],
                    },
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, 1.0 * scale_z + offset_z],
                        uv: [
                            uv_offset_z + 1.0 * uv_scale_z,
                            uv_offset_y + 1.0 * uv_scale_y,
                        ],
                    },
                    CornerData {
                        pos: [offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: [uv_offset_z + 1.0 * uv_scale_z, uv_offset_y],
                    },
                ],
            },
            BlockFace {
                name: make_name("px"),
                dir: [1, 0, 0],
                corners: [
                    CornerData {
                        pos: [
                            1.0 * scale_x + offset_x,
                            1.0 * scale_y + offset_y,
                            1.0 * scale_z + offset_z,
                        ],
                        uv: [uv_offset_z, 1.0 * uv_scale_y + uv_offset_y],
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: [uv_offset_z, uv_offset_y],
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: [
                            uv_offset_z + 1.0 * uv_scale_z,
                            uv_offset_y + 1.0 * uv_scale_y,
                        ],
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, offset_z],
                        uv: [uv_offset_z + 1.0 * uv_scale_z, uv_offset_y],
                    },
                ],
            },
            BlockFace {
                name: make_name("ny"),
                dir: [0, -1, 0],
                corners: [
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: [uv_offset_x + 1.0 * uv_scale_x, uv_offset_z],
                    },
                    CornerData {
                        pos: [offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: [uv_offset_x, uv_offset_z],
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, offset_z],
                        uv: [
                            uv_offset_x + 1.0 * uv_scale_x,
                            uv_offset_z + 1.0 * uv_scale_z,
                        ],
                    },
                    CornerData {
                        pos: [offset_x, offset_y, offset_z],
                        uv: [uv_offset_x, uv_offset_z + 1.0 * uv_scale_z],
                    },
                ],
            },
            BlockFace {
                name: make_name("py"),
                dir: [0, 1, 0],
                corners: [
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, 1.0 * scale_z + offset_z],
                        uv: [
                            uv_offset_x + 1.0 * uv_scale_x,
                            uv_offset_z + 1.0 * uv_scale_z,
                        ],
                    },
                    CornerData {
                        pos: [
                            1.0 * scale_x + offset_x,
                            1.0 * scale_y + offset_y,
                            1.0 * scale_z + offset_z,
                        ],
                        uv: [uv_offset_x, uv_offset_z + 1.0 * uv_scale_z],
                    },
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: [uv_offset_x + 1.0 * uv_scale_x, uv_offset_z],
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: [uv_offset_x, uv_offset_z],
                    },
                ],
            },
            BlockFace {
                name: make_name("nz"),
                dir: [0, 0, -1],
                corners: [
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, offset_z],
                        uv: [uv_offset_x, uv_offset_y],
                    },
                    CornerData {
                        pos: [offset_x, offset_y, offset_z],
                        uv: [uv_offset_x + 1.0 * uv_scale_x, uv_offset_y],
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: [uv_offset_x, uv_offset_y + 1.0 * uv_scale_y],
                    },
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: [
                            uv_offset_x + 1.0 * uv_scale_x,
                            uv_offset_y + 1.0 * uv_scale_y,
                        ],
                    },
                ],
            },
            BlockFace {
                name: make_name("pz"),
                dir: [0, 0, 1],
                corners: [
                    CornerData {
                        pos: [offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: [uv_offset_x, uv_offset_y],
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: [uv_offset_x + 1.0 * uv_scale_x, uv_offset_y],
                    },
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, 1.0 * scale_z + offset_z],
                        uv: [uv_offset_x, uv_offset_y + 1.0 * uv_scale_y],
                    },
                    CornerData {
                        pos: [
                            1.0 * scale_x + offset_x,
                            1.0 * scale_y + offset_y,
                            1.0 * scale_z + offset_z,
                        ],
                        uv: [
                            uv_offset_x + 1.0 * uv_scale_x,
                            uv_offset_y + 1.0 * uv_scale_y,
                        ],
                    },
                ],
            },
        ]
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

    /// Can this block be passed through?
    pub is_passable: bool,

    /// Is the block opaque?
    pub is_opaque: bool,

    /// Red-light level of the block.
    pub red_light_level: u32,

    /// Green-light level of the block.
    pub green_light_level: u32,

    /// Blue-light level of the block.
    pub blue_light_level: u32,

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

    pub fn get_rotated_transparency(&self, rotation: &BlockRotation) -> [bool; 6] {
        rotation.rotate_transparency([
            self.is_px_transparent,
            self.is_py_transparent,
            self.is_pz_transparent,
            self.is_nx_transparent,
            self.is_ny_transparent,
            self.is_nz_transparent,
        ])
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
    is_passable: bool,
    red_light_level: u32,
    green_light_level: u32,
    blue_light_level: u32,
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
            faces: BlockFace::six_faces().build(),
            aabbs: vec![AABB::new().build()],
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

    /// Configure whether or not this block can be passed through. Default is false.
    pub fn is_passable(mut self, is_plant: bool) -> Self {
        self.is_passable = is_plant;
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

    /// Configure the torch level (RGB) of this block. Default is 0.
    pub fn torch_light_level(mut self, light_level: u32) -> Self {
        self.red_light_level = light_level;
        self.green_light_level = light_level;
        self.blue_light_level = light_level;
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
        self.aabbs = aabbs.to_vec();
        self
    }

    /// Is this block a see-through block? Should it be sorted to the transparent meshes?
    pub fn is_see_through(mut self, is_see_through: bool) -> Self {
        self.is_see_through = is_see_through;
        self
    }

    /// Configure whether or not this block is transparent on all x,y,z axis.
    pub fn is_transparent(mut self, is_transparent: bool) -> Self {
        self.is_px_transparent = is_transparent;
        self.is_py_transparent = is_transparent;
        self.is_pz_transparent = is_transparent;
        self.is_nx_transparent = is_transparent;
        self.is_ny_transparent = is_transparent;
        self.is_nz_transparent = is_transparent;
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
        Block {
            id: self.id,
            name: self.name,
            rotatable: self.rotatable,
            y_rotatable: self.y_rotatable,
            is_block: self.is_block,
            is_empty: self.is_empty,
            is_fluid: self.is_fluid,
            is_light: self.is_light,
            is_passable: self.is_passable,
            is_opaque: !self.is_px_transparent
                && !self.is_py_transparent
                && !self.is_pz_transparent
                && !self.is_nx_transparent
                && !self.is_ny_transparent
                && !self.is_nz_transparent,
            red_light_level: self.red_light_level,
            green_light_level: self.green_light_level,
            blue_light_level: self.blue_light_level,
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
