//! Platform game server: one persistent world on the Voxelize engine.
//!
//! Boot order: configuration -> content pack (validated) -> engine registry
//! -> world generator -> persistent world -> ticket authenticator -> serve.
//! Any failure before serving exits non-zero with the reason; the server
//! never starts half-configured.

mod auth;
mod config;
mod gameplay;
mod registry;
mod stage;

use std::sync::Arc;

use actix_cors::Cors;
use actix_web::{web, App, HttpResponse};
use log::{info, warn};
use platform_content::Content;
use platform_ticket::{Verifier, VerifierConfig};
use platform_worldgen::{Generator, WorldgenConfig};
use serde_json::json;
use voxelize::{Server, Voxelize, World, WorldConfig};

use crate::config::GameConfig;

fn fail(message: impl std::fmt::Display) -> ! {
    eprintln!("game-server: {message}");
    std::process::exit(1);
}

/// Game ticks in one day (docs/GAME_TICK.md).
const DAY_TICKS: u64 = 24_000;
/// Fraction of the day a brand-new world starts at (07:12).
const START_TIME_OF_DAY: f32 = 0.3;

fn build_world(config: &GameConfig, content: Arc<Content>) -> World {
    let save_dir = config.save_dir.join(&config.world);
    let world_config = WorldConfig::new()
        .seed(config.seed)
        .water_level(config.sea_level as usize)
        .preload(config.preload_radius > 0)
        .preload_radius(config.preload_radius)
        .saving(true)
        .save_dir(&save_dir.to_string_lossy())
        // A new world starts in the morning; afterwards the clock persists
        // with the world's stats.
        .default_time(START_TIME_OF_DAY * DAY_TICKS as f32)
        .time_per_day(DAY_TICKS)
        .build();

    let generator = Generator::new(
        &content,
        WorldgenConfig {
            seed: config.seed,
            sea_level: config.sea_level,
            max_height: world_config.max_height as i32,
            ..Default::default()
        },
    )
    .unwrap_or_else(|e| fail(e));

    let mut world = World::new(&config.world, &world_config);
    world
        .pipeline_mut()
        .add_stage(stage::WorldgenStage::new(generator));
    // The engine applies raw client voxel writes as they stand unless a game
    // guards them. Clients never write voxels directly here: every block
    // change is an intent the server validates (docs/SECURITY.md).
    world.set_raw_update_guard(refuse_raw_writes);
    gameplay::install(&mut world, content, &save_dir, config.seed);
    world
}

fn refuse_raw_writes(
    _: &mut World,
    client_id: &str,
    writes: Vec<(voxelize::Vec3<i32>, u32)>,
) -> Vec<(voxelize::Vec3<i32>, u32)> {
    static LIMIT: voxelize::LogRateLimiter = voxelize::LogRateLimiter::new();
    if let Some(suppressed) = LIMIT.allow(1000) {
        warn!(
            "refused {} raw voxel write(s) from {client_id}: clients may not write voxels directly (+{suppressed} suppressed)",
            writes.len()
        );
    }
    Vec::new()
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let config = GameConfig::from_env().unwrap_or_else(|e| fail(e));
    let content = Arc::new(Content::load(&config.content_dir).unwrap_or_else(|e| fail(e)));
    let summary = content.summary();
    let registry = registry::build_registry(&content);

    let mut builder = Server::new().port(config.port).registry(&registry);
    if let Some(secret) = &config.transport_secret {
        builder = builder.transport_secret(secret);
    }
    if config.ticket_secrets.is_empty() {
        warn!("GAME_INSECURE_DEV=1: sessions are admitted WITHOUT tickets. Never expose this process.");
    } else {
        let verifier = Verifier::new(
            config.ticket_secrets.clone(),
            VerifierConfig::for_world(config.world.clone()),
        );
        builder = builder.session_authenticator(auth::ticket_authenticator(Arc::new(verifier)));
    }
    let mut server = builder.build();
    server
        .add_world(build_world(&config, content.clone()))
        .unwrap_or_else(|e| fail(format!("cannot add world: {e:?}")));

    info!(
        "world {:?} seed {} content {:?}, saving to {}",
        config.world,
        config.seed,
        summary,
        config.save_dir.display()
    );

    let info = json!({
        "world": config.world,
        "seed": config.seed,
        "content": summary,
        "version": env!("CARGO_PKG_VERSION"),
    });
    // The client renders names, textures, mining progress and recipes from
    // the same validated pack the server enforces.
    let content_json = json!({
        "blocks": content.blocks(),
        "items": content.items(),
        "recipes": content.recipes(),
    });
    Voxelize::run_with(server, move |voxelize| {
        let info = info.clone();
        let content_json = content_json.clone();
        App::new()
            .wrap(Cors::permissive())
            .configure(voxelize.configure())
            .route(
                "/platform/info",
                web::get().to(move || {
                    let info = info.clone();
                    async move { HttpResponse::Ok().json(info) }
                }),
            )
            .route(
                "/platform/content",
                web::get().to(move || {
                    let content_json = content_json.clone();
                    async move { HttpResponse::Ok().json(content_json) }
                }),
            )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use platform_ticket::{sign, Claims, Realm};
    use voxelize::SessionAuth;

    fn content() -> Content {
        Content::load(platform_content::default_pack_dir()).unwrap()
    }

    #[test]
    fn every_content_block_registers_with_the_engine() {
        let content = content();
        let registry = registry::build_registry(&content);
        for block in content.blocks() {
            assert!(
                !registry.is_air(block.id),
                "{} registered as air",
                block.key
            );
        }
        let water = content.block("water").unwrap().id;
        assert!(registry.is_fluid(water));
    }

    #[test]
    fn authenticator_admits_a_ticket_once_and_rejects_missing_ones() {
        let secret = b"0123456789abcdef0123456789abcdef".to_vec();
        let verifier = Arc::new(Verifier::new(
            vec![secret.clone()],
            VerifierConfig::for_world("main"),
        ));
        let authenticate = auth::ticket_authenticator(verifier);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let ticket = sign(
            &Claims {
                iss: "platform-api".into(),
                aud: "game".into(),
                sub: "pl_42".into(),
                name: "Miner".into(),
                world: "main".into(),
                realm: Realm::Survival,
                roles: vec![],
                iat: now,
                exp: now + 60,
                jti: "once".into(),
            },
            &secret,
        );
        // The engine passes query parameters as its own map type; collect into it.
        let query = [(auth::TICKET_PARAM.to_owned(), ticket)]
            .into_iter()
            .collect();
        match authenticate(&query) {
            SessionAuth::Accept(identity) => {
                assert_eq!(identity.id.as_deref(), Some("pl_42"));
                assert_eq!(identity.username.as_deref(), Some("Miner"));
                assert!(identity.is_verified());
            }
            SessionAuth::Reject(reason) => panic!("rejected: {reason}"),
        }
        assert!(matches!(authenticate(&query), SessionAuth::Reject(r) if r.contains("replayed")));
        // A client-chosen id is never honoured without a ticket.
        let bare = [("client_id".to_owned(), "admin".to_owned())]
            .into_iter()
            .collect();
        assert!(matches!(authenticate(&bare), SessionAuth::Reject(_)));
    }
}
