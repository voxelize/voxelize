//! The demo's worlds served to `@voxelize/viewer`: their own stage lists,
//! captured from the same setup functions the demo server runs.
//!
//!   cargo build --profile release-dev --example viewer-backend
//!   target/release-dev/examples/viewer-backend <launch.json>
//!
//! The viewer starts it itself (`packages/viewer/demo/config.ts`); the
//! launch file names the world (`terrain` or `flat`) beside the backend's
//! settings.
#[path = "../server/registry.rs"]
mod registry;
#[path = "../server/worlds/mod.rs"]
mod worlds;

use voxelize::viewer::{capture_world, read_launch, serve_viewer_stdio, PipelineSource};

fn main() -> Result<(), String> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: viewer-backend <launch.json>")?;
    let (launch, host) = read_launch(std::path::Path::new(&path))?;
    let world = host["world"].as_str().unwrap_or("terrain").to_owned();
    let registry = registry::setup_registry();
    let captured = capture_world(&registry, &world, |server| {
        let built = match world.as_str() {
            "flat" => worlds::flat::setup_flat_world(&registry),
            _ => worlds::terrain::setup_terrain_world(),
        };
        server
            .add_world(built)
            .expect("the demo world was added once");
    })?;
    let source = PipelineSource::new(captured).with_info(serde_json::json!({
        "kind": "generated",
        "world": world,
        "spawn": [0, 60, 0],
    }));
    serve_viewer_stdio(source, launch)
}
