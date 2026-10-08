//! The showcase: an in-engine world serving a landscape preset, 512 blocks
//! tall, for the voxelize example client and `@voxelize/agent`.
//!
//! It builds a registry of Air plus the demo block pack, compiles the
//! preset against the demo role binding, checks (or writes) the identity
//! file next to the saved chunks when saving is on (policy `Warn`), installs
//! the landscape as one engine stage, and serves world `showcase`.
//!
//! ```text
//! cargo run -p voxelize-gen --release --features unstable-landscape --example showcase -- \
//!   [--port 4000] [--seed 7] [--height 512] [--save-dir <dir>] [--policy warn|refuse|allow]
//! ```
//!
//! Then the example client (`pnpm --dir examples/client demo`) at
//! `http://localhost:3000/?world=showcase` (add `&serverPort=<port>` when
//! the showcase is not on 4000).

use log::info;
use voxelize::{Registry, Server, Voxelize, World, WorldConfig};
use voxelize_gen::landscape::presets::{demo_blocks, plain_landscape, Knobs, RoleBinding};
use voxelize_gen::landscape::{compile, install, DriftPolicy, IdentityFile, KindRegistry, Tier};

struct Options {
    port: u16,
    seed: u32,
    height: u32,
    save_dir: Option<String>,
    policy: DriftPolicy,
}

fn options() -> Options {
    let mut o = Options {
        port: 4000,
        seed: 7,
        height: 512,
        save_dir: None,
        policy: DriftPolicy::Warn,
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        let value = args.get(i + 1).cloned();
        let need = |v: Option<String>| v.unwrap_or_else(|| panic!("{} needs a value", args[i]));
        match args[i].as_str() {
            "--port" => o.port = need(value).parse().expect("port"),
            "--seed" => o.seed = need(value).parse().expect("seed"),
            "--height" => o.height = need(value).parse().expect("height"),
            "--save-dir" => o.save_dir = Some(need(value)),
            "--policy" => {
                o.policy = match need(value).as_str() {
                    "warn" => DriftPolicy::Warn,
                    "refuse" => DriftPolicy::Refuse,
                    "allow" => DriftPolicy::Allow,
                    other => panic!("unknown policy {other} (warn, refuse, allow)"),
                }
            }
            other => panic!("unknown argument {other}"),
        }
        i += 2;
    }
    o
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let o = options();
    let binding = RoleBinding::demo();
    let mut registry = Registry::new();
    registry.register_blocks(&demo_blocks(1, &binding));

    let mut builder = WorldConfig::new()
        .seed(o.seed)
        .chunk_size(16)
        .max_height(o.height as usize)
        .sub_chunks(16)
        .preload(true)
        .preload_radius(2)
        .default_time(1200.0)
        .time_per_day(2400);
    if let Some(dir) = &o.save_dir {
        builder = builder.saving(true).save_dir(dir.as_str());
    }
    let config = builder.build();

    let spec = plain_landscape(&Knobs {
        height: o.height,
        ..Knobs::default()
    });
    let land = compile(
        &spec,
        &KindRegistry::with_builtins(),
        &binding,
        &registry,
        &config,
    )
    .unwrap_or_else(|e| panic!("the showcase preset compiles: {e}"));
    let id = land.identity();
    println!(
        "landscape {} {}.{}.{} seed {} spec_hash {:016x} algo {} canon {}",
        id.preset,
        id.content_version.major,
        id.content_version.minor,
        id.content_version.patch,
        id.world_seed,
        id.spec_hash,
        id.algo,
        id.canon
    );
    for lint in land.lints() {
        println!("{lint}");
    }
    match IdentityFile::chunks_dir(&config) {
        Some(dir) => {
            let report = IdentityFile::check_dir(&dir, id, o.policy)
                .unwrap_or_else(|e| panic!("identity: {e}"));
            println!(
                "identity {}: {} ({} saved chunk(s){})",
                report.path.display(),
                report.verdict,
                report.saved_chunks,
                if report.wrote { ", written" } else { "" }
            );
        }
        None => println!("identity: saving is off, nothing persisted"),
    }
    let (sx, sy, sz) = land.spawn_point();
    let spawn = land.column(sx, sz, Tier::Full);
    println!(
        "spawn ({sx}, {sy}, {sz}): biome {}, slope {:.3}",
        land.biome_keys()[spawn.biome.id.0 as usize],
        spawn.slope
    );

    let mut world = World::new("showcase", &config);
    {
        let mut pipeline = world.pipeline_mut();
        install(&mut *pipeline, land.clone());
    }

    let mut server = Server::new()
        .port(o.port)
        .secret("test")
        .registry(&registry)
        .build();
    server
        .add_world(world)
        .expect("the showcase world is added");
    info!("showcase serving world `showcase` on port {}", o.port);
    println!("showcase serving world `showcase` on port {}", o.port);
    Voxelize::run(server).await
}
