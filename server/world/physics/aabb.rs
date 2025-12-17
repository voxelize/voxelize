pub use voxelize_core::{AABBBuilder, AABB};

use crate::BlockFace;

pub trait AABBServerExt {
    fn from_faces(faces: &[BlockFace]) -> AABB;
}

impl AABBServerExt for AABB {
    fn from_faces(faces: &[BlockFace]) -> AABB {
        let mut min_x = std::f32::MAX;
        let mut min_y = std::f32::MAX;
        let mut min_z = std::f32::MAX;
        let mut max_x = std::f32::MIN;
        let mut max_y = std::f32::MIN;
        let mut max_z = std::f32::MIN;

        faces.iter().for_each(|face| {
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

        AABB::create(min_x, min_y, min_z, max_x, max_y, max_z)
    }
}
