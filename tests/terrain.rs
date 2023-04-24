#[cfg(test)]
mod tests {
    use voxelize::{NoiseOptions, TerrainLayer};

    #[test]
    fn terrain_layer_remap() {
        let mut layer = TerrainLayer::new("Test", &NoiseOptions::default()).add_bias_points(&[
            [-1.0, 3.5],
            [0.0, 3.0],
            [0.4, 5.0],
            [1.0, 8.5],
        ]);

        layer.normalize();

        assert_eq!(layer.sample_bias(1.0), 1.0);
        assert_eq!(layer.sample_bias(0.0), -1.0);
        assert_eq!(
            layer.sample_bias(0.4),
            -1.0 + 2.0 * (5.0 - 3.0) / (8.5 - 3.0)
        );
    }
}
