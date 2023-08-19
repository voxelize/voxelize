use std::f32;

use crate::physics::AABB;

pub const PY_ROTATION: u32 = 0;
pub const NY_ROTATION: u32 = 1;
pub const PX_ROTATION: u32 = 2;
pub const NX_ROTATION: u32 = 3;
pub const PZ_ROTATION: u32 = 4;
pub const NZ_ROTATION: u32 = 5;

pub const Y_ROT_SEGMENTS: u32 = 16;

pub const ROTATION_MASK: u32 = 0xFFF0FFFF;
pub const Y_ROTATION_MASK: u32 = 0xFF0FFFFF;
pub const STAGE_MASK: u32 = 0xF0FFFFFF;

/// Block rotation enumeration. There are 6 possible rotations: `(px, nx, py, ny, pz, nz)`. Default rotation is PY.
#[derive(Debug, PartialEq)]
pub enum BlockRotation {
    PX(f32),
    NX(f32),
    PY(f32),
    NY(f32),
    PZ(f32),
    NZ(f32),
}

impl Default for BlockRotation {
    fn default() -> Self {
        BlockRotation::PY(0.0)
    }
}

const PI: f32 = f32::consts::PI;
const PI_2: f32 = f32::consts::PI / 2.0;

impl BlockRotation {
    /// Encode a set of rotations into a `BlockRotation` instance.
    pub fn encode(value: u32, y_rotation: u32) -> Self {
        let y_rotation = y_rotation as f32 * PI * 2.0 / Y_ROT_SEGMENTS as f32;

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
        let convert_y_rot = |val: f32| {
            let val = val * Y_ROT_SEGMENTS as f32 / (PI * 2.0);
            (val.round() as u32) % Y_ROT_SEGMENTS
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
    pub fn rotate_node(&self, node: &mut [f32; 3], y_rotate: bool, translate: bool) {
        match self {
            BlockRotation::PX(_) => {
                self.rotate_z(node, -PI_2);

                if translate {
                    node[1] += 1.0;
                }
            }
            BlockRotation::NX(_) => {
                self.rotate_z(node, PI_2);

                if translate {
                    node[0] += 1.0;
                }
            }
            BlockRotation::PY(rot) => {
                if y_rotate && (*rot).abs() > f32::EPSILON {
                    node[0] -= 0.5;
                    node[2] -= 0.5;
                    self.rotate_y(node, *rot);
                    node[0] += 0.5;
                    node[2] += 0.5;
                }
            }
            BlockRotation::NY(rot) => {
                if y_rotate && (*rot).abs() > f32::EPSILON {
                    node[0] -= 0.5;
                    node[2] -= 0.5;
                    self.rotate_y(node, *rot);
                    node[0] += 0.5;
                    node[2] += 0.5;
                }

                self.rotate_x(node, PI_2 * 2.0);

                if translate {
                    node[1] += 1.0;
                    node[2] += 1.0;
                }
            }
            BlockRotation::PZ(_) => {
                self.rotate_x(node, PI_2);

                if translate {
                    node[1] += 1.0;
                }
            }
            BlockRotation::NZ(_) => {
                self.rotate_x(node, -PI_2);

                if translate {
                    node[2] += 1.0;
                }
            }
        }
    }

    /// Rotate an AABB.
    pub fn rotate_aabb(&self, aabb: &AABB, y_rotate: bool, translate: bool) -> AABB {
        let mut min = [aabb.min_x, aabb.min_y, aabb.min_z];
        let mut max = [aabb.max_x, aabb.max_y, aabb.max_z];

        let mut min_x = None;
        let mut min_z = None;
        let mut max_x = None;
        let mut max_z = None;

        if y_rotate
            && (matches!(self, BlockRotation::PY(_)) || matches!(self, BlockRotation::NY(_)))
        {
            let min1 = [aabb.min_x, aabb.min_y, aabb.min_z];
            let min2 = [aabb.min_x, aabb.min_y, aabb.max_z];
            let min3 = [aabb.max_x, aabb.min_y, aabb.min_z];
            let min4 = [aabb.max_x, aabb.min_y, aabb.max_z];

            [min1, min2, min3, min4].into_iter().for_each(|mut node| {
                self.rotate_node(&mut node, true, true);

                if min_x.is_none() || node[0] < min_x.unwrap() {
                    min_x = Some(node[0]);
                }

                if min_z.is_none() || node[2] < min_z.unwrap() {
                    min_z = Some(node[2]);
                }
            });

            let max1 = [aabb.min_x, aabb.max_y, aabb.min_z];
            let max2 = [aabb.min_x, aabb.max_y, aabb.max_z];
            let max3 = [aabb.max_x, aabb.max_y, aabb.min_z];
            let max4 = [aabb.max_x, aabb.max_y, aabb.max_z];

            [max1, max2, max3, max4].into_iter().for_each(|mut node| {
                self.rotate_node(&mut node, true, true);

                if max_x.is_none() || node[0] > max_x.unwrap() {
                    max_x = Some(node[0]);
                }

                if max_z.is_none() || node[2] > max_z.unwrap() {
                    max_z = Some(node[2]);
                }
            });
        }

        self.rotate_node(&mut min, false, translate);
        self.rotate_node(&mut max, false, translate);

        AABB {
            min_x: min_x.unwrap_or(min[0].min(max[0])),
            min_y: min[1].min(max[1]),
            min_z: min_z.unwrap_or(min[2].min(max[2])),
            max_x: max_x.unwrap_or(min[0].max(max[0])),
            max_y: max[1].max(min[1]),
            max_z: max_z.unwrap_or(min[2].max(max[2])),
        }
    }

    /// Rotate transparency, let math do the work.
    pub fn rotate_transparency(&self, [px, py, pz, nx, ny, nz]: [bool; 6]) -> [bool; 6] {
        if let BlockRotation::PY(rot) = self {
            if rot.abs() < f32::EPSILON {
                return [px, py, pz, nx, ny, nz];
            }
        }

        let mut positive = [1.0, 2.0, 3.0];
        let mut negative = [4.0, 5.0, 6.0];

        self.rotate_node(&mut positive, true, false);
        self.rotate_node(&mut negative, true, false);

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
