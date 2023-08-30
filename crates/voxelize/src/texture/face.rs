use serde::{Deserialize, Serialize};

use crate::{CornerData, UV};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    pub name: String,
    pub independent: bool,
    pub dir: [i32; 3],
    pub corners: [CornerData; 4],
    pub range: UV,
}

pub struct FaceBuilder {
    name: Option<String>,
    independent: Option<bool>,
    dir: Option<[i32; 3]>,
    corners: Option<[CornerData; 4]>,
    range: Option<UV>,
}

impl FaceBuilder {
    pub fn new() -> FaceBuilder {
        FaceBuilder {
            name: None,
            independent: None,
            dir: None,
            corners: None,
            range: None,
        }
    }

    pub fn name(mut self, name: String) -> Self {
        self.name = Some(name);
        self
    }

    pub fn independent(mut self, independent: bool) -> Self {
        self.independent = Some(independent);
        self
    }

    pub fn dir(mut self, dir: [i32; 3]) -> Self {
        self.dir = Some(dir);
        self
    }

    pub fn corners(mut self, corners: [CornerData; 4]) -> Self {
        self.corners = Some(corners);
        self
    }

    pub fn build(self) -> Face {
        Face {
            name: self.name.unwrap(),
            independent: self.independent.unwrap_or(false),
            dir: self.dir.unwrap(),
            corners: self.corners.unwrap(),
            range: self.range.unwrap_or(UV::default()),
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
    pub fn build(self) -> Vec<Face> {
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
            Face {
                name: make_name("px"),
                dir: [1, 0, 0],
                independent: false,
                range: UV::default(),
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
            Face {
                name: make_name("py"),
                dir: [0, 1, 0],
                independent: false,
                range: UV::default(),
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
            Face {
                name: make_name("pz"),
                dir: [0, 0, 1],
                independent: false,
                range: UV::default(),
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
            Face {
                name: make_name("nx"),
                dir: [-1, 0, 0],
                independent: false,
                range: UV::default(),
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
            Face {
                name: make_name("ny"),
                dir: [0, -1, 0],
                independent: false,
                range: UV::default(),
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
            Face {
                name: make_name("nz"),
                dir: [0, 0, -1],
                independent: false,
                range: UV::default(),
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
        ]
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
    pub fn build(self) -> Vec<Face> {
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
            Face {
                name: make_name("one"),
                dir: [0, 0, 0],
                independent: false,
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
            Face {
                name: make_name("two"),
                dir: [0, 0, 0],
                independent: false,
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
        ]
    }
}
