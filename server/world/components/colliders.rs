use serde::{Deserialize, Serialize};
use specs::{Component, DenseVecStorage};

use crate::AABB;

/// Solid boxes an entity presents to players, relative to its position: a
/// wall, a platform, a post. `EntitiesMetaSystem` replicates them under the
/// `colliders` metadata key as `[minX, minY, minZ, maxX, maxY, maxZ]`
/// arrays, and a client's `Entities` given a physics engine adds them to it,
/// so players stop at them as they stop at blocks.
#[derive(Debug, Default, Clone, Component, Serialize, Deserialize)]
#[storage(DenseVecStorage)]
pub struct CollidersComp(pub Vec<[f32; 6]>);

impl CollidersComp {
    /// Colliders from boxes relative to the entity's position.
    pub fn new(aabbs: &[AABB]) -> Self {
        Self(
            aabbs
                .iter()
                .map(|aabb| {
                    [
                        aabb.min_x, aabb.min_y, aabb.min_z, aabb.max_x, aabb.max_y, aabb.max_z,
                    ]
                })
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn colliders_replicate_as_boxes_relative_to_the_position() {
        let colliders = CollidersComp::new(&[
            AABB::new().scale_x(2.0).scale_y(3.0).scale_z(1.0).build(),
            AABB::new()
                .offset_x(-0.5)
                .scale_x(0.5)
                .scale_y(1.0)
                .scale_z(0.5)
                .build(),
        ]);

        assert_eq!(
            serde_json::to_value(&colliders).unwrap(),
            json!([
                [0.0, 0.0, 0.0, 2.0, 3.0, 1.0],
                [-0.5, 0.0, 0.0, 0.0, 1.0, 0.5]
            ])
        );
    }
}
