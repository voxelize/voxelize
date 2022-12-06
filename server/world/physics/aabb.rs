use serde::{Deserialize, Serialize};

use crate::BlockFace;

/// Axis-aligned Bounding Box.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AABB {
    /// Minimum x-coordinate of this AABB.
    pub min_x: f32,
    /// Minimum y-coordinate of this AABB.
    pub min_y: f32,
    /// Minimum z-coordinate of this AABB.
    pub min_z: f32,
    /// Maximum x-coordinate of this AABB.
    pub max_x: f32,
    /// Maximum y-coordinate of this AABB.
    pub max_y: f32,
    /// Maximum z-coordinate of this AABB.
    pub max_z: f32,
}

impl AABB {
    /// Create a new axis-aligned bounding box.
    pub fn new() -> AABBBuilder {
        AABBBuilder::new()
    }

    pub fn from_faces(faces: &[BlockFace]) -> AABB {
        let mut min_x = std::f32::MAX;
        let mut min_y = std::f32::MAX;
        let mut min_z = std::f32::MAX;
        let mut max_x = std::f32::MIN;
        let mut max_y = std::f32::MIN;
        let mut max_z = std::f32::MIN;

        faces.into_iter().for_each(|face| {
            face.corners.iter().for_each(|corner| {
                let [px, py, pz] = corner.pos;
                if px < min_x {
                    min_x = px;
                }
                if py < min_y {
                    min_y = py;
                }
                if pz < min_z {
                    min_z = pz;
                }
                if px > max_x {
                    max_x = px;
                }
                if py > max_y {
                    max_y = py;
                }
                if pz > max_z {
                    max_z = pz;
                }
            })
        });

        AABB {
            min_x,
            min_y,
            min_z,
            max_x,
            max_y,
            max_z,
        }
    }

    /// Return an empty AABB.
    pub fn empty() -> Self {
        Self {
            min_x: 0.0,
            min_y: 0.0,
            min_z: 0.0,
            max_x: 0.0,
            max_y: 0.0,
            max_z: 0.0,
        }
    }

    /// Calculate the union of a set of AABBs.
    pub fn union(all: &[AABB]) -> AABB {
        if all.is_empty() {
            return AABB::empty();
        }

        let mut min_x = all[0].min_x;
        let mut min_y = all[0].min_y;
        let mut min_z = all[0].min_z;
        let mut max_x = all[0].max_x;
        let mut max_y = all[0].max_y;
        let mut max_z = all[0].max_z;

        for aabb in all {
            if aabb.min_x < min_x {
                min_x = aabb.min_x;
            }
            if aabb.min_y < min_y {
                min_y = aabb.min_y;
            }
            if aabb.min_z < min_z {
                min_z = aabb.min_z;
            }
            if aabb.max_x > max_x {
                max_x = aabb.max_x;
            }
            if aabb.max_y > max_y {
                max_y = aabb.max_y;
            }
            if aabb.max_z > max_z {
                max_z = aabb.max_z;
            }
        }

        AABB {
            min_x,
            min_y,
            min_z,
            max_x,
            max_y,
            max_z,
        }
    }

    /// The width of this AABB, max_x - min_x.
    #[inline]
    pub fn width(&self) -> f32 {
        self.max_x - self.min_x
    }

    /// The height of this AABB, max_y - min_y.
    #[inline]
    pub fn height(&self) -> f32 {
        self.max_y - self.min_y
    }

    /// The depth of this AABB, max_z - min_z.
    #[inline]
    pub fn depth(&self) -> f32 {
        self.max_z - self.min_z
    }

    /// The magnitude of this AABB.
    #[inline]
    pub fn mag(&self) -> f32 {
        (self.width() * self.width() + self.height() * self.height() + self.depth() * self.depth())
            .sqrt()
    }

    /// Translate this AABB by a vector.
    pub fn translate(&mut self, dx: f32, dy: f32, dz: f32) {
        self.min_x += dx;
        self.min_y += dy;
        self.min_z += dz;
        self.max_x += dx;
        self.max_y += dy;
        self.max_z += dz;
    }

    /// Set this AABB's position (minimum coordinates) without changing its dimensions.
    pub fn set_position(&mut self, px: f32, py: f32, pz: f32) {
        self.max_x = px + self.width();
        self.max_y = py + self.height();
        self.max_z = pz + self.depth();
        self.min_x = px;
        self.min_y = py;
        self.min_z = pz;
    }

    /// Copy the contents of another AABB to self.
    pub fn copy(&mut self, other: &AABB) {
        self.min_x = other.min_x;
        self.min_y = other.min_y;
        self.min_z = other.min_z;
        self.max_x = other.max_x;
        self.max_y = other.max_y;
        self.max_z = other.max_z;
    }

    /// Get the intersection of this AABB with another AABB.
    pub fn intersection(&self, other: &AABB) -> AABB {
        AABB {
            min_x: self.min_x.max(other.min_x),
            min_y: self.min_y.max(other.min_y),
            min_z: self.min_z.max(other.min_z),
            max_x: self.max_x.min(other.max_x),
            max_y: self.max_y.min(other.max_y),
            max_z: self.max_z.min(other.max_z),
        }
    }

    /// Check if this AABB touches the other AABB.
    pub fn touches(&self, other: &AABB) -> bool {
        let intersection = self.intersection(other);

        intersection.width() == 0.0 || intersection.height() == 0.0 || intersection.depth() == 0.0
    }

    /// Check if this AABB intersects the other AABB.
    pub fn intersects(&self, other: &AABB) -> bool {
        if other.min_x >= self.max_x {
            return false;
        }
        if other.min_y >= self.max_y {
            return false;
        }
        if other.min_z >= self.max_z {
            return false;
        }
        if other.max_x <= self.min_x {
            return false;
        }
        if other.max_y <= self.min_y {
            return false;
        }
        if other.max_z <= self.min_z {
            return false;
        }
        true
    }
}

pub struct AABBBuilder {
    scale_x: f32,
    scale_y: f32,
    scale_z: f32,
    offset_x: f32,
    offset_y: f32,
    offset_z: f32,
}

impl AABBBuilder {
    /// Instantiate a new AABB builder to build a custom AABB from a 1x1x1 cube.
    pub fn new() -> Self {
        Self {
            scale_x: 1.0,
            scale_y: 1.0,
            scale_z: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            offset_z: 0.0,
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

    /// Build an AABB instance out of this builder.
    pub fn build(self) -> AABB {
        AABB {
            min_x: self.offset_x,
            min_y: self.offset_y,
            min_z: self.offset_z,
            max_x: self.offset_x + self.scale_x,
            max_y: self.offset_y + self.scale_y,
            max_z: self.offset_z + self.scale_z,
        }
    }
}
