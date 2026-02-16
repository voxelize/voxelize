use log::{error, info};
use registry::setup_registry;
use voxelize::{Server, Voxelize, WorldConfig};
use worlds::{flat::setup_flat_world, terrain::setup_terrain_world, test::setup_test_world};

mod registry;
mod worlds;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let registry = setup_registry();

    let mut server = Server::new()
        .port(4000)
        .secret("test")
        // .serve("./examples/client/dist")
        .registry(&registry)
        .build();

    server
        .add_world(setup_test_world())
        .map_err(|error| std::io::Error::other(format!("Could not create test world: {error}")))?;

    server
        .add_world(setup_terrain_world())
        .map_err(|error| {
            std::io::Error::other(format!("Could not create terrain world: {error}"))
        })?;

    server
        .add_world(setup_flat_world(&registry))
        .map_err(|error| std::io::Error::other(format!("Could not create flat world: {error}")))?;

    server.set_action_handle("create_world", |value, server| {
        info!("World creating...");
        let name: String = match serde_json::from_value(value) {
            Ok(name) => name,
            Err(error) => {
                error!("Invalid world creation payload: {}", error);
                return;
            }
        };
        let config = WorldConfig::default();
        let world = voxelize::World::new(&name, &config);
        if let Err(error) = server.add_world(world) {
            error!("Could not create world '{}': {}", name, error);
        }
    });

    Voxelize::run(server).await
}
