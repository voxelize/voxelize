#[cfg(test)]
mod tests {
    use voxelize::{BlockRotation, BlockUtils};

    #[test]
    fn id_insertion() {
        let mut voxel = 100230120;
        let id = 13;

        voxel = BlockUtils::insert_id(voxel, id);
        assert_eq!(BlockUtils::extract_id(voxel), id);

        // Exceeded maximum
        voxel = BlockUtils::insert_id(voxel, 65537);
        assert_eq!(BlockUtils::extract_id(voxel), 1);
    }

    #[test]
    fn rotation_insertion() {
        // let mut voxel = 0;
        let id = 13;

        // TODO: add rotation tests.

        // voxel = BlockUtils::insert_id(voxel, id);
        // assert_eq!(BlockUtils::extract_rotation(voxel), BlockRotation::PY(0.0));

        // voxel = BlockUtils::insert_rotation(voxel, &BlockRotation::NX(0.0));
        // assert_eq!(BlockUtils::extract_rotation(voxel), BlockRotation::NX(0.0));

        // voxel = BlockUtils::insert_rotation(voxel, &BlockRotation::PZ(90.0));
        // assert_eq!(BlockUtils::extract_rotation(voxel), BlockRotation::PZ(90.0));

        // assert_eq!(BlockUtils::extract_id(voxel), id);
    }

    #[test]
    fn rotation_correctness() {
        let rotation = BlockRotation::PX(0.0);

        let compare = |a: [f32; 3], b: [f32; 3]| {
            assert!((a[0] - b[0]).abs() < f32::EPSILON);
            assert!((a[1] - b[1]).abs() < f32::EPSILON);
            assert!((a[2] - b[2]).abs() < f32::EPSILON);
        };

        // default rotation at PY
        let mut point = [0.0, 1.0, 0.0];
        rotation.rotate_node(&mut point, false, false);
        compare(point, [1.0, 0.0, 0.0]);

        point = [0.0, 0.0, 1.0];
        rotation.rotate_node(&mut point, false, false);
        compare(point, [0.0, 0.0, 1.0]);
    }

    #[test]
    fn stage() {
        let mut voxel = 0;
        let id = 13;

        voxel = BlockUtils::insert_id(voxel, id);

        assert_eq!(BlockUtils::extract_stage(voxel), 0);

        for stage in 0..16 {
            voxel = BlockUtils::insert_stage(voxel, stage);
            assert_eq!(BlockUtils::extract_stage(voxel), stage);
        }

        assert_eq!(BlockUtils::extract_id(voxel), id);
    }
}
