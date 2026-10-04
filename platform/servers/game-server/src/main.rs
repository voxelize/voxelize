//! Platform game server: one persistent world, with one engine world per
//! dimension, on the Voxelize engine.
//!
//! Boot order: configuration -> content pack (validated) -> engine registry
//! -> world generator -> persistent world -> ticket authenticator -> serve.
//! Any failure before serving exits non-zero with the reason; the server
//! never starts half-configured.

mod auth;
mod behaviors;
mod config;
mod gameplay;
mod portals;
mod registry;
mod stage;

use std::sync::Arc;

use actix_cors::Cors;
use actix_web::{web, App, HttpResponse};
use log::{info, warn};
use platform_content::{Content, Dimension};
use platform_ticket::{Verifier, VerifierConfig};
use platform_worldgen::{Generator, Sky, Underworld, WorldgenConfig};
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

/// Engine world name of a dimension: the overworld is the configured world,
/// other dimensions add their key (`main_underworld`).
fn world_name(config: &GameConfig, dimension: Dimension) -> String {
    match dimension {
        Dimension::Overworld => config.world.clone(),
        other => format!("{}_{}", config.world, other.key()),
    }
}

fn build_world(
    config: &GameConfig,
    content: Arc<Content>,
    dimensions: gameplay::Dimensions,
) -> World {
    let dimension = dimensions.current;
    let name = world_name(config, dimension);
    let save_dir = config.save_dir.join(&name);
    // Every dimension of a world shares the overworld's player records.
    let players_dir = config.save_dir.join(&config.world);
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

    let max_height = world_config.max_height as i32;
    let terrain = match dimension {
        Dimension::Overworld => stage::Terrain::Overworld(Arc::new(
            Generator::new(
                &content,
                WorldgenConfig {
                    seed: config.seed,
                    sea_level: config.sea_level,
                    max_height,
                    ..Default::default()
                },
            )
            .unwrap_or_else(|e| fail(e)),
        )),
        Dimension::Underworld => stage::Terrain::Underworld(Arc::new(
            Underworld::new(&content, config.seed, max_height).unwrap_or_else(|e| fail(e)),
        )),
        Dimension::Sky => stage::Terrain::Sky(Arc::new(
            Sky::new(&content, config.seed, max_height).unwrap_or_else(|e| fail(e)),
        )),
    };
    let biomes = terrain.clone();
    let biome_at: Arc<dyn Fn(i32, i32) -> String + Send + Sync> =
        Arc::new(move |x, z| biomes.biome_at(x, z));

    // Each world has its own behaviour context, so blocks broken by
    // behaviours drop in the world they broke in.
    let broken = Arc::new(behaviors::BrokenBlocks::default());
    {
        // Actuators do not move blocks across claim borders.
        let land = dimensions.land.clone();
        let here = dimensions.current;
        broken.set_land_of(Arc::new(move |x, z| {
            land.read().ok()?.at(here, x, z).map(|l| l.id.clone())
        }));
    }
    let behavior_ctx = Arc::new(behaviors::BehaviorContext::new(&content, broken.clone()));
    let mut registry = registry::build_registry_with(&content, &behavior_ctx);
    registry.generate();

    let mut world = World::new(&name, &world_config);
    world.ecs_mut().insert(registry);
    world
        .pipeline_mut()
        .add_stage(stage::WorldgenStage::new(terrain));
    // The engine applies raw client voxel writes as they stand unless a game
    // guards them. Clients never write voxels directly here: every block
    // change is an intent the server validates (docs/SECURITY.md).
    world.set_raw_update_guard(refuse_raw_writes);
    gameplay::install(
        &mut world,
        content,
        &save_dir,
        &players_dir,
        config.seed,
        broken,
        biome_at,
        dimensions,
    )
    .unwrap_or_else(|e| fail(e));
    world.set_dispatcher(|| {
        voxelize::default_dispatcher()
            .with(
                gameplay::SurvivalSystem::default(),
                "platform-survival",
                &["physics"],
            )
            .with(
                gameplay::WorldItemsSystem::default(),
                "platform-world-items",
                &["platform-survival"],
            )
            .with(
                gameplay::MobSystem::default(),
                "platform-mobs",
                &["platform-world-items"],
            )
            .with(
                gameplay::PlateSystem::default(),
                "platform-plates",
                &["platform-mobs"],
            )
            .with(
                gameplay::PortalSystem::default(),
                "platform-portals",
                &["platform-plates"],
            )
            .with(
                gameplay::LandNoticeSystem::default(),
                "platform-land-notices",
                &["platform-portals"],
            )
            .with(
                gameplay::MarketSystem::default(),
                "platform-market",
                &["platform-land-notices"],
            )
            .with(
                gameplay::TradeSystem::default(),
                "platform-trades",
                &["platform-market"],
            )
            .with(
                gameplay::SiegeSystem::default(),
                "platform-sieges",
                &["platform-trades"],
            )
            .with(
                gameplay::CombatSystem::default(),
                "platform-combat",
                &["platform-sieges"],
            )
            .with(
                gameplay::WeatherSystem::default(),
                "platform-weather",
                &["platform-combat"],
            )
            .with(
                gameplay::GaugeSystem::default(),
                "platform-gauges",
                &["platform-weather"],
            )
            .with(
                gameplay::ProgressSystem,
                "platform-progress",
                &["platform-gauges"],
            )
            .with(
                gameplay::PayoutSystem::default(),
                "platform-payouts",
                &["platform-progress"],
            )
    });
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
    // The server's default registry; every world installs its own with
    // the same blocks (build_world).
    let registry = registry::build_registry_with(
        &content,
        &Arc::new(behaviors::BehaviorContext::new(
            &content,
            Arc::new(behaviors::BrokenBlocks::default()),
        )),
    );

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
    let worlds: std::collections::HashMap<Dimension, String> = Dimension::ALL
        .into_iter()
        .map(|d| (d, world_name(&config, d)))
        .collect();
    let worlds = Arc::new(worlds);
    // Land claims: the last feed seen, then kept fresh from the backend.
    let world_dir = config.save_dir.join(&config.world);
    let land: gameplay::land::SharedLand = Arc::new(std::sync::RwLock::new(
        gameplay::land::load_cached(&world_dir)
            .unwrap_or_else(|e| fail(format!("cannot load cached land claims: {e}"))),
    ));
    // Guilds (membership, allies, wars) and their shared vaults.
    let guilds: gameplay::guilds::SharedGuilds = Arc::new(std::sync::RwLock::new(
        gameplay::guilds::load_cached(&world_dir)
            .unwrap_or_else(|e| fail(format!("cannot load cached guilds: {e}"))),
    ));
    let vaults: gameplay::guilds::SharedVaults = Arc::new(std::sync::Mutex::new(
        gameplay::guilds::Vaults::load(&world_dir)
            .unwrap_or_else(|e| fail(format!("cannot load guild vaults: {e}"))),
    ));
    match &config.backend {
        Some(b) => info!("backend: {} (land claims, market)", b.url),
        None => warn!("backend off: this world has no land claims and no market"),
    }
    let links = Arc::new(std::sync::Mutex::new(
        gameplay::travel::PortalLinks::load(&config.save_dir.join(&config.world))
            .unwrap_or_else(|e| fail(format!("cannot load portal links: {e}"))),
    ));
    // The market link: requests are queued now and sent once the server's
    // async runtime runs.
    let bridge = config
        .backend
        .as_ref()
        .map(|b| gameplay::bridge::Bridge::start(b.url.clone(), b.token.clone(), &config.world));
    for dimension in Dimension::ALL {
        let dimensions = gameplay::Dimensions {
            current: dimension,
            worlds: worlds.clone(),
            links: links.clone(),
            land: land.clone(),
            guilds: guilds.clone(),
            vaults: vaults.clone(),
            bridge: bridge.clone(),
            siege_seconds: config.siege_seconds,
        };
        server
            .add_world(build_world(&config, content.clone(), dimensions))
            .unwrap_or_else(|e| fail(format!("cannot add world: {e:?}")));
    }

    info!(
        "world {:?} seed {} content {:?}, saving to {}",
        config.world,
        config.seed,
        summary,
        config.save_dir.display()
    );

    let info = json!({
        "world": config.world,
        "dimensions": worlds.iter().map(|(d, w)| (d.key(), w.clone())).collect::<std::collections::BTreeMap<_, _>>(),
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
        "mobs": content.mobs(),
        "achievements": content.achievements(),
        "jobs": content.jobs(),
        "quests": content.quests(),
    });
    if let Some(backend) = config.backend.clone() {
        actix_web::rt::spawn(gameplay::land::poll(
            gameplay::land::FeedConfig {
                url: format!("{}/lands?world={}", backend.url, config.world),
                token: backend.token.clone(),
                interval: std::time::Duration::from_millis(backend.land_interval_ms),
                cache_dir: world_dir.clone(),
            },
            land.clone(),
        ));
        actix_web::rt::spawn(gameplay::guilds::poll(
            gameplay::land::FeedConfig {
                url: format!("{}/guilds", backend.url),
                token: backend.token.clone(),
                interval: std::time::Duration::from_millis(backend.land_interval_ms),
                cache_dir: world_dir.clone(),
            },
            guilds.clone(),
        ));
    }
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
        let broken = Arc::new(behaviors::BrokenBlocks::default());
        let behavior_ctx = Arc::new(behaviors::BehaviorContext::new(&content, broken.clone()));
        let registry = registry::build_registry_with(&content, &behavior_ctx);
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
