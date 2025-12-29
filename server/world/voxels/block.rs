use std::{
    f32,
    marker::Sync,
    ops::{Deref, DerefMut},
    sync::Arc,
};

use serde::{Deserialize, Serialize};

use crate::{
    AABBBuilder, BlockUtils, FluidConfig, LightColor, LightUtils, Registry, Vec2, Vec3,
    VoxelAccess, VoxelUpdate, AABB, UV,
};

use super::fluids::create_fluid_active_fn;

pub use voxelize_core::{
    BlockRotation, CornerData, NX_ROTATION, NY_ROTATION, NZ_ROTATION, PX_ROTATION, PY_ROTATION,
    PZ_ROTATION, ROTATION_MASK, STAGE_MASK, Y_ROTATION_MASK, Y_ROT_SEGMENTS,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlockFace {
    pub name: String,
    pub independent: bool,
    pub isolated: bool,
    pub texture_group: Option<String>,
    pub dir: [i32; 3],
    pub corners: [CornerData; 4],
    pub range: UV,
}

impl BlockFace {
    pub fn new(
        name: String,
        independent: bool,
        isolated: bool,
        dir: [i32; 3],
        corners: [CornerData; 4],
    ) -> Self {
        Self {
            name,
            independent,
            isolated,
            texture_group: None,
            dir,
            corners,
            range: UV::default(),
        }
    }

    pub fn into_independent(&mut self) {
        self.independent = true;
    }

    pub fn into_isolated(&mut self) {
        self.isolated = true;
    }

    pub fn set_texture_group(&mut self, group: &str) {
        self.texture_group = Some(group.to_string());
    }

    pub fn to_mesher_face(&self) -> voxelize_mesher::BlockFace {
        voxelize_mesher::BlockFace {
            name: self.name.clone(),
            name_lower: self.name.to_lowercase(),
            independent: self.independent,
            isolated: self.isolated,
            texture_group: self.texture_group.clone(),
            dir: self.dir,
            corners: [
                voxelize_mesher::CornerData { pos: self.corners[0].pos, uv: self.corners[0].uv },
                voxelize_mesher::CornerData { pos: self.corners[1].pos, uv: self.corners[1].uv },
                voxelize_mesher::CornerData { pos: self.corners[2].pos, uv: self.corners[2].uv },
                voxelize_mesher::CornerData { pos: self.corners[3].pos, uv: self.corners[3].uv },
            ],
            range: voxelize_mesher::UV {
                start_u: self.range.start_u,
                end_u: self.range.end_u,
                start_v: self.range.start_v,
                end_v: self.range.end_v,
            },
        }
    }
}

pub const SIX_FACES_PX: usize = 0;
pub const SIX_FACES_PY: usize = 1;
pub const SIX_FACES_PZ: usize = 2;
pub const SIX_FACES_NX: usize = 3;
pub const SIX_FACES_NY: usize = 4;
pub const SIX_FACES_NZ: usize = 5;

pub struct BlockFaces {
    pub faces: Vec<BlockFace>,
}

impl BlockFaces {
    pub fn new() -> Self {
        Self { faces: vec![] }
    }

    pub fn empty() -> Self {
        Self { faces: Vec::new() }
    }

    pub fn independent_at(mut self, index: usize) -> Self {
        if index >= self.faces.len() {
            return self;
        }

        self.faces[index].into_independent();

        self
    }

    pub fn independent_at_all(mut self, indices: Vec<usize>) -> Self {
        for index in indices {
            self = self.independent_at(index);
        }

        self
    }

    pub fn isolated_at(mut self, index: usize) -> Self {
        if index >= self.faces.len() {
            return self;
        }

        self.faces[index].into_isolated();

        self
    }

    pub fn isolated_at_all(mut self, indices: Vec<usize>) -> Self {
        for index in indices {
            self = self.isolated_at(index);
        }

        self
    }

    pub fn from_faces(faces: Vec<BlockFace>) -> Self {
        Self { faces }
    }

    pub fn join(mut self, mut other: Self) -> Self {
        self.faces.append(&mut other.faces);
        self
    }

    /// Create and customize a six-faced block face data. The face orders are
    /// the following: PX, PY, PZ, NX, NY, NZ.
    pub fn six_faces() -> SixFacesBuilder {
        SixFacesBuilder::new()
    }

    /// Create and customize a diagonal-faced block face data. The face orders are
    /// the following: one, two
    pub fn diagonal_faces() -> DiagonalFacesBuilder {
        DiagonalFacesBuilder::new()
    }
}

impl Deref for BlockFaces {
    type Target = Vec<BlockFace>;

    fn deref(&self) -> &Self::Target {
        &self.faces
    }
}

impl DerefMut for BlockFaces {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.faces
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
    to_four: bool,
    texture_group: Option<String>,
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
            to_four: false,
            texture_group: None,
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

    pub fn to_four(mut self) -> Self {
        self.to_four = true;
        self
    }

    pub fn texture_group(mut self, group: &str) -> Self {
        self.texture_group = Some(group.to_string());
        self
    }

    /// Build the diagonal faces.
    pub fn build(self) -> BlockFaces {
        let Self {
            scale_horizontal,
            scale_vertical,
            offset_x,
            offset_y,
            offset_z,
            prefix,
            suffix,
            concat,
            to_four,
            texture_group,
        } = self;

        let make_name = |side: &str| {
            let mut name = "".to_owned();
            if !prefix.is_empty() {
                name += &prefix;
                if !concat.is_empty() {
                    name += &concat;
                }
            }
            name += side;
            if !suffix.is_empty() {
                if !concat.is_empty() {
                    name += &concat;
                }
                name += &suffix;
            }
            name
        };

        let h_min = (1.0 - scale_horizontal) / 2.0;
        let h_max = 1.0 - h_min;

        if to_four {
            BlockFaces::from_faces(vec![
                BlockFace {
                    name: make_name("one1"),
                    dir: [0, 0, 0],
                    independent: false,
                    isolated: false,
                    texture_group: texture_group.clone(),
                    range: UV::default(),
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
                                offset_x + (h_min + h_max) / 2.0,
                                offset_y + scale_vertical,
                                offset_z + (h_min + h_max) / 2.0,
                            ],
                            uv: [0.5, 1.0],
                        },
                        CornerData {
                            pos: [
                                offset_x + (h_min + h_max) / 2.0,
                                offset_y + 0.0,
                                offset_z + (h_min + h_max) / 2.0,
                            ],
                            uv: [0.5, 0.0],
                        },
                    ],
                },
                BlockFace {
                    name: make_name("one2"),
                    dir: [0, 0, 0],
                    independent: false,
                    isolated: false,
                    texture_group: texture_group.clone(),
                    range: UV::default(),
                    corners: [
                        CornerData {
                            pos: [
                                offset_x + (h_min + h_max) / 2.0,
                                offset_y + scale_vertical,
                                offset_z + (h_min + h_max) / 2.0,
                            ],
                            uv: [0.5, 1.0],
                        },
                        CornerData {
                            pos: [
                                offset_x + (h_min + h_max) / 2.0,
                                offset_y + 0.0,
                                offset_z + (h_min + h_max) / 2.0,
                            ],
                            uv: [0.5, 0.0],
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
                    name: make_name("two1"),
                    dir: [0, 0, 0],
                    independent: false,
                    isolated: false,
                    texture_group: texture_group.clone(),
                    range: UV::default(),
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
                                offset_x + (h_min + h_max) / 2.0,
                                offset_y + scale_vertical,
                                offset_z + (h_min + h_max) / 2.0,
                            ],
                            uv: [0.5, 1.0],
                        },
                        CornerData {
                            pos: [
                                offset_x + (h_min + h_max) / 2.0,
                                offset_y + 0.0,
                                offset_z + (h_min + h_max) / 2.0,
                            ],
                            uv: [0.5, 0.0],
                        },
                    ],
                },
                BlockFace {
                    name: make_name("two2"),
                    dir: [0, 0, 0],
                    independent: false,
                    isolated: false,
                    texture_group: texture_group.clone(),
                    range: UV::default(),
                    corners: [
                        CornerData {
                            pos: [
                                offset_x + (h_min + h_max) / 2.0,
                                offset_y + scale_vertical,
                                offset_z + (h_min + h_max) / 2.0,
                            ],
                            uv: [0.5, 1.0],
                        },
                        CornerData {
                            pos: [
                                offset_x + (h_min + h_max) / 2.0,
                                offset_y + 0.0,
                                offset_z + (h_min + h_max) / 2.0,
                            ],
                            uv: [0.5, 0.0],
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
            ])
        } else {
            BlockFaces::from_faces(vec![
                BlockFace {
                    name: make_name("one"),
                    dir: [0, 0, 0],
                    independent: false,
                    isolated: false,
                    texture_group: texture_group.clone(),
                    range: UV::default(),
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
                    independent: false,
                    isolated: false,
                    texture_group,
                    range: UV::default(),
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
            ])
        }
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
    independence: [bool; 6],
    isolation: [bool; 6],
    texture_groups: [Option<String>; 6],
    auto_uv_offset: bool,
    rotation: Option<BlockRotation>,
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
            independence: [false, false, false, false, false, false],
            isolation: [false, false, false, false, false, false],
            texture_groups: [None, None, None, None, None, None],
            auto_uv_offset: false,
            rotation: None,
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

    pub fn auto_uv_offset(mut self, auto_uv_offset: bool) -> Self {
        self.auto_uv_offset = auto_uv_offset;
        self
    }

    pub fn with_rotation(mut self, rotation: &BlockRotation) -> Self {
        self.rotation = Some(rotation.to_owned());
        self
    }

    pub fn independent_at(mut self, index: usize) -> Self {
        if index >= self.independence.len() {
            return self;
        }

        self.independence[index] = true;
        self
    }

    pub fn isolated_at(mut self, index: usize) -> Self {
        if index >= self.isolation.len() {
            return self;
        }

        self.isolation[index] = true;
        self
    }

    pub fn texture_group(mut self, group: &str) -> Self {
        let group = Some(group.to_string());
        self.texture_groups = [
            group.clone(),
            group.clone(),
            group.clone(),
            group.clone(),
            group.clone(),
            group,
        ];
        self
    }

    pub fn texture_group_at(mut self, index: usize, group: &str) -> Self {
        if index >= self.texture_groups.len() {
            return self;
        }

        self.texture_groups[index] = Some(group.to_string());
        self
    }

    /// Create the six faces of a block.
    pub fn build(self) -> BlockFaces {
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
            auto_uv_offset,
            rotation,
            independence,
            isolation,
            texture_groups,
        } = self;

        let make_name = |side: &str| {
            let mut name = "".to_owned();
            if !prefix.is_empty() {
                name += &prefix;
                if !concat.is_empty() {
                    name += &concat;
                }
            }
            name += side;
            if !suffix.is_empty() {
                if !concat.is_empty() {
                    name += &concat;
                }
                name += &suffix;
            }
            name
        };

        let uv_offset_x: f32 = if auto_uv_offset {
            offset_x
        } else {
            uv_offset_x
        };
        let uv_offset_y = if auto_uv_offset {
            offset_y
        } else {
            uv_offset_y
        };
        let uv_offset_z = if auto_uv_offset {
            offset_z
        } else {
            uv_offset_z
        };
        let uv_scale_x = if auto_uv_offset { scale_x } else { uv_scale_x };
        let uv_scale_y = if auto_uv_offset { scale_y } else { uv_scale_y };
        let uv_scale_z = if auto_uv_offset { scale_z } else { uv_scale_z };

        let is_px_independent = independence[SIX_FACES_PX];
        let is_nx_independent = independence[SIX_FACES_NX];
        let is_py_independent = independence[SIX_FACES_PY];
        let is_ny_independent = independence[SIX_FACES_NY];
        let is_pz_independent = independence[SIX_FACES_PZ];
        let is_nz_independent = independence[SIX_FACES_NZ];

        let is_px_isolated = isolation[SIX_FACES_PX];
        let is_nx_isolated = isolation[SIX_FACES_NX];
        let is_py_isolated = isolation[SIX_FACES_PY];
        let is_ny_isolated = isolation[SIX_FACES_NY];
        let is_pz_isolated = isolation[SIX_FACES_PZ];
        let is_nz_isolated = isolation[SIX_FACES_NZ];

        let [px_group, py_group, pz_group, nx_group, ny_group, nz_group] = texture_groups;

        let mut results = BlockFaces::from_faces(vec![
            BlockFace {
                name: make_name("px"),
                dir: [1, 0, 0],
                independent: is_px_independent,
                isolated: is_px_isolated,
                texture_group: px_group,
                range: UV::default(),
                corners: [
                    CornerData {
                        pos: [
                            1.0 * scale_x + offset_x,
                            1.0 * scale_y + offset_y,
                            1.0 * scale_z + offset_z,
                        ],
                        uv: if is_px_independent || is_px_isolated {
                            [0.0, 1.0]
                        } else {
                            [uv_offset_z, 1.0 * uv_scale_y + uv_offset_y]
                        },
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: if is_px_independent || is_px_isolated {
                            [0.0, 0.0]
                        } else {
                            [uv_offset_z, uv_offset_y]
                        },
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: if is_px_independent || is_px_isolated {
                            [1.0, 1.0]
                        } else {
                            [
                                uv_offset_z + 1.0 * uv_scale_z,
                                uv_offset_y + 1.0 * uv_scale_y,
                            ]
                        },
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, offset_z],
                        uv: if is_px_independent || is_px_isolated {
                            [1.0, 0.0]
                        } else {
                            [uv_offset_z + 1.0 * uv_scale_z, uv_offset_y]
                        },
                    },
                ],
            },
            BlockFace {
                name: make_name("py"),
                dir: [0, 1, 0],
                independent: is_py_independent,
                isolated: is_py_isolated,
                texture_group: py_group,
                range: UV::default(),
                corners: [
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, 1.0 * scale_z + offset_z],
                        uv: if is_py_independent || is_py_isolated {
                            [1.0, 1.0]
                        } else {
                            [
                                uv_offset_x + 1.0 * uv_scale_x,
                                uv_offset_z + 1.0 * uv_scale_z,
                            ]
                        },
                    },
                    CornerData {
                        pos: [
                            1.0 * scale_x + offset_x,
                            1.0 * scale_y + offset_y,
                            1.0 * scale_z + offset_z,
                        ],
                        uv: if is_py_independent || is_py_isolated {
                            [0.0, 1.0]
                        } else {
                            [uv_offset_x, uv_offset_z + 1.0 * uv_scale_z]
                        },
                    },
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: if is_py_independent || is_py_isolated {
                            [1.0, 0.0]
                        } else {
                            [uv_offset_x + 1.0 * uv_scale_x, uv_offset_z]
                        },
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: if is_py_independent || is_py_isolated {
                            [0.0, 0.0]
                        } else {
                            [uv_offset_x, uv_offset_z]
                        },
                    },
                ],
            },
            BlockFace {
                name: make_name("pz"),
                dir: [0, 0, 1],
                independent: is_pz_independent,
                isolated: is_pz_isolated,
                texture_group: pz_group,
                range: UV::default(),
                corners: [
                    CornerData {
                        pos: [offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: if is_pz_independent || is_pz_isolated {
                            [0.0, 0.0]
                        } else {
                            [uv_offset_x, uv_offset_y]
                        },
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: if is_pz_independent || is_pz_isolated {
                            [1.0, 0.0]
                        } else {
                            [uv_offset_x + 1.0 * uv_scale_x, uv_offset_y]
                        },
                    },
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, 1.0 * scale_z + offset_z],
                        uv: if is_pz_independent || is_pz_isolated {
                            [0.0, 1.0]
                        } else {
                            [uv_offset_x, uv_offset_y + 1.0 * uv_scale_y]
                        },
                    },
                    CornerData {
                        pos: [
                            1.0 * scale_x + offset_x,
                            1.0 * scale_y + offset_y,
                            1.0 * scale_z + offset_z,
                        ],
                        uv: if is_pz_independent || is_pz_isolated {
                            [1.0, 1.0]
                        } else {
                            [
                                uv_offset_x + 1.0 * uv_scale_x,
                                uv_offset_y + 1.0 * uv_scale_y,
                            ]
                        },
                    },
                ],
            },
            BlockFace {
                name: make_name("nx"),
                dir: [-1, 0, 0],
                independent: is_nx_independent,
                isolated: is_nx_isolated,
                texture_group: nx_group,
                range: UV::default(),
                corners: [
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: if is_nx_independent || is_nx_isolated {
                            [0.0, 1.0]
                        } else {
                            [uv_offset_z, 1.0 * uv_scale_y + uv_offset_y]
                        },
                    },
                    CornerData {
                        pos: [offset_x, offset_y, offset_z],
                        uv: if is_nx_independent || is_nx_isolated {
                            [0.0, 0.0]
                        } else {
                            [uv_offset_z, uv_offset_y]
                        },
                    },
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, 1.0 * scale_z + offset_z],
                        uv: if is_nx_independent || is_nx_isolated {
                            [1.0, 1.0]
                        } else {
                            [
                                uv_offset_z + 1.0 * uv_scale_z,
                                uv_offset_y + 1.0 * uv_scale_y,
                            ]
                        },
                    },
                    CornerData {
                        pos: [offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: if is_nx_independent || is_nx_isolated {
                            [1.0, 0.0]
                        } else {
                            [uv_offset_z + 1.0 * uv_scale_z, uv_offset_y]
                        },
                    },
                ],
            },
            BlockFace {
                name: make_name("ny"),
                dir: [0, -1, 0],
                independent: is_ny_independent,
                isolated: is_ny_isolated,
                texture_group: ny_group,
                range: UV::default(),
                corners: [
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: if is_ny_independent || is_ny_isolated {
                            [1.0, 0.0]
                        } else {
                            [uv_offset_x + 1.0 * uv_scale_x, uv_offset_z]
                        },
                    },
                    CornerData {
                        pos: [offset_x, offset_y, 1.0 * scale_z + offset_z],
                        uv: if is_ny_independent || is_ny_isolated {
                            [0.0, 0.0]
                        } else {
                            [uv_offset_x, uv_offset_z]
                        },
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, offset_z],
                        uv: if is_ny_independent || is_ny_isolated {
                            [1.0, 1.0]
                        } else {
                            [
                                uv_offset_x + 1.0 * uv_scale_x,
                                uv_offset_z + 1.0 * uv_scale_z,
                            ]
                        },
                    },
                    CornerData {
                        pos: [offset_x, offset_y, offset_z],
                        uv: if is_ny_independent || is_ny_isolated {
                            [0.0, 1.0]
                        } else {
                            [uv_offset_x, uv_offset_z + 1.0 * uv_scale_z]
                        },
                    },
                ],
            },
            BlockFace {
                name: make_name("nz"),
                dir: [0, 0, -1],
                independent: is_nz_independent,
                isolated: is_nz_isolated,
                texture_group: nz_group,
                range: UV::default(),
                corners: [
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, offset_y, offset_z],
                        uv: if is_nz_independent || is_nz_isolated {
                            [0.0, 0.0]
                        } else {
                            [uv_offset_x, uv_offset_y]
                        },
                    },
                    CornerData {
                        pos: [offset_x, offset_y, offset_z],
                        uv: if is_nz_independent || is_nz_isolated {
                            [1.0, 0.0]
                        } else {
                            [uv_offset_x + 1.0 * uv_scale_x, uv_offset_y]
                        },
                    },
                    CornerData {
                        pos: [1.0 * scale_x + offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: if is_nz_independent || is_nz_isolated {
                            [0.0, 1.0]
                        } else {
                            [uv_offset_x, uv_offset_y + 1.0 * uv_scale_y]
                        },
                    },
                    CornerData {
                        pos: [offset_x, 1.0 * scale_y + offset_y, offset_z],
                        uv: if is_nz_independent || is_nz_isolated {
                            [1.0, 1.0]
                        } else {
                            [
                                uv_offset_x + 1.0 * uv_scale_x,
                                uv_offset_y + 1.0 * uv_scale_y,
                            ]
                        },
                    },
                ],
            },
        ]);

        if let Some(rotation) = rotation {
            for face in results.iter_mut() {
                for corner in face.corners.iter_mut() {
                    rotation.rotate_node(&mut corner.pos, true, true);
                }
            }
        }

        results
    }
}

impl std::ops::Add for BlockFaces {
    type Output = Self;

    fn add(self, other: Self) -> Self::Output {
        let mut combined_faces = self.faces;
        combined_faces.extend(other.faces);
        Self {
            faces: combined_faces,
        }
    }
}

impl std::ops::Add<&Self> for BlockFaces {
    type Output = Self;

    fn add(self, other: &Self) -> Self::Output {
        let mut combined_faces = self.faces.clone();
        combined_faces.extend(other.faces.clone());
        Self {
            faces: combined_faces,
        }
    }
}

impl std::ops::AddAssign for BlockFaces {
    fn add_assign(&mut self, other: Self) {
        self.faces.extend(other.faces);
    }
}

impl std::ops::AddAssign<&Self> for BlockFaces {
    fn add_assign(&mut self, other: &Self) {
        self.faces.extend(other.faces.clone());
    }
}

#[derive(Debug, Clone)]
pub struct Neighbors {
    pub center: Vec3<i32>,
    data: [[u32; 2]; 27],
}

impl Neighbors {
    #[inline]
    fn offset_to_index(x: i32, y: i32, z: i32) -> usize {
        ((x + 1) + (y + 1) * 3 + (z + 1) * 9) as usize
    }

    pub fn populate(center: Vec3<i32>, space: &dyn VoxelAccess) -> Self {
        let mut data = [[0u32; 2]; 27];
        let Vec3(vx, vy, vz) = center;

        for x in -1..=1 {
            for y in -1..=1 {
                for z in -1..=1 {
                    let idx = Self::offset_to_index(x, y, z);
                    data[idx][0] = space.get_raw_voxel(vx + x, vy + y, vz + z);
                    data[idx][1] = space.get_raw_light(vx + x, vy + y, vz + z);
                }
            }
        }

        Self { data, center }
    }

    #[inline]
    fn get_data(&self, offset: &Vec3<i32>) -> [u32; 2] {
        let idx = Self::offset_to_index(offset.0, offset.1, offset.2);
        self.data[idx]
    }

    pub fn get_voxel(&self, offset: &Vec3<i32>) -> u32 {
        BlockUtils::extract_id(self.get_data(offset)[0])
    }

    pub fn get_rotation(&self, offset: &Vec3<i32>) -> BlockRotation {
        BlockUtils::extract_rotation(self.get_data(offset)[0])
    }

    pub fn get_stage(&self, offset: &Vec3<i32>) -> u32 {
        BlockUtils::extract_stage(self.get_data(offset)[0])
    }

    pub fn get_sunlight(&self, offset: &Vec3<i32>) -> u32 {
        LightUtils::extract_sunlight(self.get_data(offset)[1])
    }

    pub fn get_torch_light(&self, offset: &Vec3<i32>, color: &LightColor) -> u32 {
        let light = self.get_data(offset)[1];
        match *color {
            LightColor::Red => LightUtils::extract_red_light(light),
            LightColor::Green => LightUtils::extract_green_light(light),
            LightColor::Blue => LightUtils::extract_blue_light(light),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSimpleRule {
    pub offset: Vec3<i32>,
    pub id: Option<u32>,
    pub rotation: Option<BlockRotation>,
    pub stage: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BlockRule {
    #[default]
    None,
    Simple(BlockSimpleRule),
    Combination {
        logic: BlockRuleLogic,
        rules: Vec<BlockRule>,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockRuleLogic {
    And,
    Or,
    Not,
    // Extend with other logic types as needed
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlockConditionalPart {
    #[serde(default)]
    pub rule: BlockRule,
    #[serde(default)]
    pub faces: Vec<BlockFace>,
    #[serde(default)]
    pub aabbs: Vec<AABB>,
    #[serde(default)]
    pub is_transparent: [bool; 6],
    #[serde(default)]
    pub is_passable: Option<bool>,
    #[serde(default)]
    pub red_light_level: Option<u32>,
    #[serde(default)]
    pub green_light_level: Option<u32>,
    #[serde(default)]
    pub blue_light_level: Option<u32>,
    #[serde(default)]
    pub world_space: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDynamicPattern {
    pub parts: Vec<BlockConditionalPart>,
}

impl BlockDynamicPattern {
    pub fn to_mesher_pattern(&self) -> voxelize_mesher::BlockDynamicPattern {
        voxelize_mesher::BlockDynamicPattern {
            parts: self.parts.iter().map(|p| p.to_mesher_part()).collect(),
        }
    }
}

impl BlockConditionalPart {
    pub fn to_mesher_part(&self) -> voxelize_mesher::BlockConditionalPart {
        voxelize_mesher::BlockConditionalPart {
            rule: self.rule.to_mesher_rule(),
            faces: self.faces.iter().map(|f| f.to_mesher_face()).collect(),
            aabbs: self.aabbs.clone(),
            is_transparent: self.is_transparent,
            world_space: self.world_space,
        }
    }
}

impl BlockRule {
    pub fn to_mesher_rule(&self) -> voxelize_mesher::BlockRule {
        match self {
            BlockRule::None => voxelize_mesher::BlockRule::None,
            BlockRule::Simple(simple) => {
                voxelize_mesher::BlockRule::Simple(voxelize_mesher::BlockSimpleRule {
                    offset: [simple.offset.0, simple.offset.1, simple.offset.2],
                    id: simple.id,
                    rotation: simple.rotation.as_ref().map(|r| {
                        let (rot, y_rot) = BlockRotation::decode(r);
                        voxelize_mesher::BlockRotation::encode(rot, y_rot)
                    }),
                    stage: simple.stage,
                })
            }
            BlockRule::Combination { logic, rules } => voxelize_mesher::BlockRule::Combination {
                logic: match logic {
                    BlockRuleLogic::And => voxelize_mesher::BlockRuleLogic::And,
                    BlockRuleLogic::Or => voxelize_mesher::BlockRuleLogic::Or,
                    BlockRuleLogic::Not => voxelize_mesher::BlockRuleLogic::Not,
                },
                rules: rules.iter().map(|r| r.to_mesher_rule()).collect(),
            },
        }
    }
}

/// Serializable struct representing block data.
#[derive(Clone, Serialize, Deserialize)]
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

    pub y_rotatable_segments: YRotatableSegments,

    /// Is the block empty space?
    pub is_empty: bool,

    /// Is the block a fluid?
    pub is_fluid: bool,

    /// The force applied to entities in this fluid, pushing them in the flow direction.
    pub fluid_flow_force: f32,

    /// Is this block waterlogged (exists inside water)?
    pub is_waterlogged: bool,

    /// Does the block emit light?
    pub is_light: bool,

    /// Can this block be passed through?
    pub is_passable: bool,

    /// Can entities climb this block?
    pub is_climbable: bool,

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

    /// Does this block prevent fluids from rendering faces against it?
    pub occludes_fluid: bool,

    /// Is this block transparent from looking from all 6 sides?
    /// The order is: px, py, pz, nx, ny, nz.
    pub is_transparent: [bool; 6],

    /// Does light reduce when passing through this block?
    pub light_reduce: bool,

    pub is_entity: bool,

    /// Whether or not this block has dynamic aabb and face generation. This is
    /// automatically generated by the engine, and if `true`, client-side code
    /// should also have a corresponding dynamic function.
    pub is_dynamic: bool,

    pub dynamic_patterns: Option<Vec<BlockDynamicPattern>>,

    /// Dynamic aabb and face generation function. Defaults to `None`.
    #[serde(skip)]
    pub dynamic_fn: Option<
        Arc<
            dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> (Vec<BlockFace>, Vec<AABB>, [bool; 6])
                + Send
                + Sync,
        >,
    >,

    #[serde(skip)]
    pub active_updater: Option<
        Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<VoxelUpdate> + Send + Sync>,
    >,

    #[serde(skip)]
    pub active_ticker:
        Option<Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + Send + Sync>>,

    pub is_active: bool,
}

impl Block {
    pub fn new(name: &str) -> BlockBuilder {
        BlockBuilder::new(name)
    }

    pub fn has_torch_light(&self) -> bool {
        self.red_light_level > 0 || self.green_light_level > 0 || self.blue_light_level > 0
    }

    /// Check if block emits light at a specific position (considering dynamic patterns)
    pub fn is_light_at(&self, pos: &Vec3<i32>, space: &dyn VoxelAccess) -> bool {
        // Check dynamic patterns first
        if let Some(dynamic_patterns) = &self.dynamic_patterns {
            for pattern in dynamic_patterns {
                for part in &pattern.parts {
                    if Self::evaluate_rule(&part.rule, pos, space) {
                        // If this part matches and has any light levels defined, it's a light
                        if part.red_light_level.is_some()
                            || part.green_light_level.is_some()
                            || part.blue_light_level.is_some()
                        {
                            return part.red_light_level.unwrap_or(0) > 0
                                || part.green_light_level.unwrap_or(0) > 0
                                || part.blue_light_level.unwrap_or(0) > 0;
                        }
                    }
                }
            }
        }

        // Fall back to static check
        self.is_light
    }

    pub fn get_aabbs(
        &self,
        pos: &Vec3<i32>,
        space: &dyn VoxelAccess,
        registry: &Registry,
    ) -> Vec<AABB> {
        if self.is_dynamic {
            if let Some(dynamic_patterns) = &self.dynamic_patterns {
                for pattern in dynamic_patterns {
                    let (_, aabbs, __) = Block::match_dynamic_pattern(pattern, pos, space);
                    if aabbs.len() > 0 {
                        return aabbs.to_owned();
                    }
                }
                return self.aabbs.clone();
            }

            (self.dynamic_fn.as_ref().unwrap())(pos.to_owned(), space, registry).1
        } else {
            self.aabbs.clone()
        }
    }

    pub fn get_faces(
        &self,
        pos: &Vec3<i32>,
        space: &dyn VoxelAccess,
        registry: &Registry,
    ) -> Vec<BlockFace> {
        if self.is_dynamic {
            if let Some(dynamic_patterns) = &self.dynamic_patterns {
                for pattern in dynamic_patterns {
                    let (faces, _, __) = Block::match_dynamic_pattern(pattern, pos, space);
                    if faces.len() > 0 {
                        return faces.to_owned();
                    }
                }
                return self.faces.clone();
            }

            (self.dynamic_fn.as_ref().unwrap())(pos.to_owned(), space, registry).0
        } else {
            self.faces.clone()
        }
    }

    pub fn get_torch_light_level(&self, color: &LightColor) -> u32 {
        match *color {
            LightColor::Red => self.red_light_level,
            LightColor::Green => self.green_light_level,
            LightColor::Blue => self.blue_light_level,
            LightColor::Sunlight => 0,
        }
    }

    /// Get torch light level considering dynamic patterns (if any)
    pub fn get_torch_light_level_at(
        &self,
        pos: &Vec3<i32>,
        space: &dyn VoxelAccess,
        color: &LightColor,
    ) -> u32 {
        // Check if we have dynamic patterns with light levels
        if let Some(dynamic_patterns) = &self.dynamic_patterns {
            for pattern in dynamic_patterns {
                for part in &pattern.parts {
                    if Self::evaluate_rule(&part.rule, pos, space) {
                        // If this part matches and has light levels defined, use them
                        match *color {
                            LightColor::Red => {
                                if let Some(level) = part.red_light_level {
                                    return level;
                                }
                            }
                            LightColor::Green => {
                                if let Some(level) = part.green_light_level {
                                    return level;
                                }
                            }
                            LightColor::Blue => {
                                if let Some(level) = part.blue_light_level {
                                    return level;
                                }
                            }
                            LightColor::Sunlight => return 0,
                        }
                    }
                }
            }
        }

        // Fall back to static light levels
        self.get_torch_light_level(color)
    }

    pub fn get_rotated_transparency(&self, rotation: &BlockRotation) -> [bool; 6] {
        rotation.rotate_transparency(self.is_transparent)
    }

    /// Evaluate the dynamic pattern and return the combined faces and AABBs based on the rules.
    fn evaluate_dynamic_pattern(
        pattern: &BlockDynamicPattern,
        pos: &Vec3<i32>,
        space: &dyn VoxelAccess,
    ) -> (Vec<BlockFace>, Vec<AABB>, [bool; 6]) {
        let mut combined_faces = Vec::new();
        let mut combined_aabbs = Vec::new();
        let mut combined_transparency = [false; 6];

        for part in &pattern.parts {
            if Self::evaluate_rule(&part.rule, pos, space) {
                combined_faces.extend(part.faces.clone());
                combined_aabbs.extend(part.aabbs.clone());
                for (i, &is_transparent) in part.is_transparent.iter().enumerate() {
                    combined_transparency[i] = combined_transparency[i] || is_transparent;
                }
            }
        }

        (combined_faces, combined_aabbs, combined_transparency)
    }

    fn evaluate_rule(rule: &BlockRule, pos: &Vec3<i32>, space: &dyn VoxelAccess) -> bool {
        match rule {
            BlockRule::None => true,
            BlockRule::Simple(simple_rule) => {
                let vx = simple_rule.offset.0 + pos.0;
                let vy = simple_rule.offset.1 + pos.1;
                let vz = simple_rule.offset.2 + pos.2;

                let id_match = simple_rule.id.map_or(true, |rule_id| {
                    let id = space.get_voxel(vx, vy, vz);
                    id == rule_id
                });

                let rotation_match = simple_rule.rotation.as_ref().map_or(true, |rule_rotation| {
                    let rotation = space.get_voxel_rotation(vx, vy, vz);
                    rotation == *rule_rotation
                });

                let stage_match = simple_rule.stage.map_or(true, |rule_stage| {
                    let stage = space.get_voxel_stage(vx, vy, vz);
                    stage == rule_stage
                });

                id_match && rotation_match && stage_match
            }
            BlockRule::Combination { logic, rules } => {
                match logic {
                    BlockRuleLogic::And => rules
                        .iter()
                        .all(|rule| Self::evaluate_rule(rule, pos, space)),
                    BlockRuleLogic::Or => rules
                        .iter()
                        .any(|rule| Self::evaluate_rule(rule, pos, space)),
                    BlockRuleLogic::Not => !rules
                        .iter()
                        .any(|rule| Self::evaluate_rule(rule, pos, space)),
                    // Extend with other logic types as needed
                }
            }
        }
    }

    fn match_dynamic_pattern(
        pattern: &BlockDynamicPattern,
        pos: &Vec3<i32>,
        space: &dyn VoxelAccess,
    ) -> (Vec<BlockFace>, Vec<AABB>, [bool; 6]) {
        Self::evaluate_dynamic_pattern(&pattern, pos, space)
    }

    pub fn to_mesher_block(&self) -> voxelize_mesher::Block {
        voxelize_mesher::Block {
            id: self.id,
            name: self.name.clone(),
            name_lower: self.name.to_lowercase(),
            rotatable: self.rotatable,
            y_rotatable: self.y_rotatable,
            is_empty: self.is_empty,
            is_fluid: self.is_fluid,
            is_waterlogged: self.is_waterlogged,
            is_opaque: self.is_opaque,
            is_see_through: self.is_see_through,
            is_transparent: self.is_transparent,
            transparent_standalone: self.transparent_standalone,
            occludes_fluid: self.occludes_fluid,
            faces: self.faces.iter().map(|f| f.to_mesher_face()).collect(),
            aabbs: self.aabbs.clone(),
            dynamic_patterns: self.dynamic_patterns.as_ref().map(|patterns| {
                patterns.iter().map(|p| p.to_mesher_pattern()).collect()
            }),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub enum YRotatableSegments {
    All,
    Eight,
    Four,
}

impl Default for YRotatableSegments {
    fn default() -> Self {
        Self::All
    }
}

#[derive(Default)]
pub struct BlockBuilder {
    id: u32,
    name: String,
    rotatable: bool,
    y_rotatable: bool,
    y_rotatable_segments: YRotatableSegments,
    is_empty: bool,
    is_fluid: bool,
    fluid_flow_force: f32,
    is_waterlogged: bool,
    is_passable: bool,
    is_climbable: bool,
    red_light_level: u32,
    green_light_level: u32,
    blue_light_level: u32,
    transparent_standalone: bool,
    faces: Vec<BlockFace>,
    aabbs: Vec<AABB>,
    is_see_through: bool,
    occludes_fluid: bool,
    is_px_transparent: bool,
    is_py_transparent: bool,
    is_pz_transparent: bool,
    is_nx_transparent: bool,
    is_ny_transparent: bool,
    is_nz_transparent: bool,
    is_entity: bool,
    light_reduce: bool,
    dynamic_patterns: Option<Vec<BlockDynamicPattern>>,
    dynamic_fn: Option<
        Arc<
            dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> (Vec<BlockFace>, Vec<AABB>, [bool; 6])
                + 'static
                + Send
                + Sync,
        >,
    >,
    active_updater: Option<
        Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<VoxelUpdate> + Send + Sync>,
    >,
    active_ticker: Option<Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + Send + Sync>>,
}

impl BlockBuilder {
    /// Create a block builder with default values.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            faces: BlockFaces::six_faces().build().to_vec(),
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

    pub fn y_rotatable_segments(mut self, y_rotatable_segments: &YRotatableSegments) -> Self {
        self.y_rotatable_segments = y_rotatable_segments.clone();
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

    /// Configure the flow force for this fluid block. Default is 0.0.
    pub fn fluid_flow_force(mut self, fluid_flow_force: f32) -> Self {
        self.fluid_flow_force = fluid_flow_force;
        self
    }

    /// Configure whether or not this block is waterlogged (exists inside water). Default is false.
    pub fn is_waterlogged(mut self, is_waterlogged: bool) -> Self {
        self.is_waterlogged = is_waterlogged;
        self
    }

    /// Configure whether or not this block can be passed through. Default is false.
    pub fn is_passable(mut self, is_plant: bool) -> Self {
        self.is_passable = is_plant;
        self
    }

    /// Configure whether or not this block can be climbed. Default is false.
    pub fn is_climbable(mut self, is_climbable: bool) -> Self {
        self.is_climbable = is_climbable;
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

    /// Does this block prevent fluids from rendering faces against it?
    pub fn occludes_fluid(mut self, occludes_fluid: bool) -> Self {
        self.occludes_fluid = occludes_fluid;
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

    /// Configure whether light reduces through this block. Default is false.
    pub fn light_reduce(mut self, light_reduce: bool) -> Self {
        self.light_reduce = light_reduce;
        self
    }

    pub fn dynamic_patterns(mut self, patterns: &[BlockDynamicPattern]) -> Self {
        self.dynamic_patterns = Some(patterns.to_vec());
        self
    }

    /// Configure the function that is used to create dynamic AABBs and faces for this block.
    pub fn dynamic_fn<
        F: Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> (Vec<BlockFace>, Vec<AABB>, [bool; 6])
            + 'static
            + Send
            + Sync,
    >(
        mut self,
        dynamic_fn: F,
    ) -> Self {
        self.dynamic_fn = Some(Arc::new(dynamic_fn));
        self
    }

    pub fn active_fn<
        F1: Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + 'static + Send + Sync,
        F2: Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<VoxelUpdate> + 'static + Send + Sync,
    >(
        mut self,
        active_ticker: F1,
        active_updater: F2,
    ) -> Self {
        self.active_ticker = Some(Arc::new(active_ticker));
        self.active_updater = Some(Arc::new(active_updater));
        self
    }

    pub fn is_entity(mut self, is_entity: bool) -> Self {
        self.is_entity = is_entity;
        self
    }

    pub fn fluid_simulation(mut self, config: FluidConfig) -> Self {
        let fluid_id = self.id;
        let (ticker, updater) = create_fluid_active_fn(fluid_id, config);

        self.is_fluid = true;
        self.active_ticker = Some(Arc::new(move |pos, space, reg| ticker(pos, space, reg)));
        self.active_updater = Some(Arc::new(move |pos, space, reg| updater(pos, space, reg)));
        self
    }

    /// Construct a block instance, ready to be added into the registry.
    pub fn build(self) -> Block {
        Block {
            id: self.id,
            name: self.name,
            rotatable: self.rotatable,
            y_rotatable: self.y_rotatable,
            y_rotatable_segments: self.y_rotatable_segments,
            is_empty: self.is_empty,
            is_fluid: self.is_fluid,
            fluid_flow_force: self.fluid_flow_force,
            is_waterlogged: self.is_waterlogged,
            is_light: self.red_light_level > 0
                || self.green_light_level > 0
                || self.blue_light_level > 0,
            is_passable: self.is_passable,
            is_climbable: self.is_climbable,
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
            occludes_fluid: self.occludes_fluid,
            is_transparent: [
                self.is_px_transparent,
                self.is_py_transparent,
                self.is_pz_transparent,
                self.is_nx_transparent,
                self.is_ny_transparent,
                self.is_nz_transparent,
            ],
            light_reduce: self.light_reduce,
            is_dynamic: self.dynamic_fn.is_some() || self.dynamic_patterns.is_some(),
            dynamic_patterns: self.dynamic_patterns,
            dynamic_fn: self.dynamic_fn,
            is_active: self.active_updater.is_some() && self.active_ticker.is_some(),
            active_ticker: self.active_ticker,
            active_updater: self.active_updater,
            is_entity: self.is_entity,
        }
    }
}
