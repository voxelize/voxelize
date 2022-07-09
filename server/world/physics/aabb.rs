use serde::{Deserialize, Serialize};

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
