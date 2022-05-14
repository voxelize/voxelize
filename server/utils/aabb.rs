use serde::{Deserialize, Serialize};

/// Axis-aligned Bounding Box.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub fn new(min_x: f32, min_y: f32, min_z: f32, max_x: f32, max_y: f32, max_z: f32) -> Self {
        Self {
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
    pub fn translate(&mut self, &[dx, dy, dz]: &[f32; 3]) {
        self.min_x += dx;
        self.min_y += dy;
        self.min_z += dz;
        self.max_x += dx;
        self.max_y += dy;
        self.max_z += dz;
    }

    /// Set this AABB's position (minimum coordinates) without changing its dimensions.
    pub fn set_position(&mut self, &[px, py, pz]: &[f32; 3]) {
        self.max_x = px + self.width();
        self.max_y = py + self.height();
        self.max_z = pz + self.depth();
        self.min_x = px;
        self.min_y = py;
        self.min_z = pz;
    }
}
