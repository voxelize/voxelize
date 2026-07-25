use std::ops::{Deref, DerefMut};

use serde::{Deserialize, Serialize};

use crate::UV;

use super::{
    BlockRotation, CornerData, NX_ROTATION, NY_ROTATION, NZ_ROTATION, PX_ROTATION, PY_ROTATION,
    PZ_ROTATION,
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
                voxelize_mesher::CornerData {
                    pos: self.corners[0].pos,
                    uv: self.corners[0].uv,
                },
                voxelize_mesher::CornerData {
                    pos: self.corners[1].pos,
                    uv: self.corners[1].uv,
                },
                voxelize_mesher::CornerData {
                    pos: self.corners[2].pos,
                    uv: self.corners[2].uv,
                },
                voxelize_mesher::CornerData {
                    pos: self.corners[3].pos,
                    uv: self.corners[3].uv,
                },
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
