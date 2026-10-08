//! The showcase: an in-engine world serving a landscape preset, 512 blocks
//! tall, for the voxelize example client and `@voxelize/agent`.
//!
//! It builds a registry of Air plus the demo block pack, compiles the
//! preset against the demo role binding, checks (or writes) the identity
//! file next to the saved chunks when saving is on (policy `Warn`), installs
//! the landscape as one engine stage, and serves world `showcase`.
//!
//! ```text
//! cargo run -p voxelize-gen --release --features unstable-landscape[,kit] --example showcase -- \
//!   [--port 4000] [--seed 7] [--height 512] [--preset plain|proving] [--save-dir <dir>] \
//!   [--policy warn|refuse|allow] [--trace-out <file>] [--debug-http <port>] [--time <t>]
//! ```
//!
//! - `--preset proving` (with the `kit` feature) serves the plain preset
//!   with the kit's test landforms and the sinkhole of
//!   `examples/sinkhole.rs`;
//! - `--trace-out <file>` logs every chunk the engine generates, in the
//!   order its workers took them, one `cx cz` per line: a recorded walk
//!   for `walk_bench --workloads trace:<file>`;
//! - `--debug-http <port>` serves, on 127.0.0.1 only,
//!   `/landscape/explain?x=&z=[&text=1]`,
//!   `/landscape/map?layer=hillshade|edges|claims&x0=&z0=&size=&stride=` (PNG),
//!   `/landscape/dag`, `/landscape/census?r=` and
//!   `/landscape/quality?x0=&z0=&size=[&stride=]`;
//! - `--time <t>` starts the world clock at `t` (of 2400 per day) and
//!   stops it, so captures keep one light (a saved world starts from its
//!   saved clock instead).
//!
//! Then the example client (`pnpm --dir examples/client demo`) at
//! `http://localhost:3000/?world=showcase` (add `&serverPort=<port>` when
//! the showcase is not on 4000).

#[path = "common/font.rs"]
mod font;
#[path = "common/render.rs"]
mod render;
#[cfg(feature = "kit")]
#[path = "sinkhole.rs"]
mod sinkhole;

use std::io::Write as _;
use std::sync::{Arc, Mutex};

use actix_web::{web, App, HttpResponse, HttpServer};
use voxelize::{
    Chunk, ChunkStage, Registry, Resources, Server, Space, Voxelize, World, WorldConfig,
};
use voxelize_gen::landscape::geometry::Aabb2;
use voxelize_gen::landscape::presets::{demo_blocks, plain_landscape, Knobs, RoleBinding};
use voxelize_gen::landscape::{
    compile, DriftPolicy, IdentityFile, KindRegistry, Landscape, LandscapeSpec, LandscapeStage,
    Tier,
};

struct Options {
    port: u16,
    seed: u32,
    height: u32,
    preset: String,
    save_dir: Option<String>,
    policy: DriftPolicy,
    trace_out: Option<String>,
    debug_http: Option<u16>,
    time: Option<f32>,
}

fn options() -> Options {
    let mut o = Options {
        port: 4000,
        seed: 7,
        height: 512,
        preset: "plain".into(),
        save_dir: None,
        policy: DriftPolicy::Warn,
        trace_out: None,
        debug_http: None,
        time: None,
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
            "--preset" => o.preset = need(value),
            "--save-dir" => o.save_dir = Some(need(value)),
            "--trace-out" => o.trace_out = Some(need(value)),
            "--debug-http" => o.debug_http = Some(need(value).parse().expect("debug port")),
            "--time" => o.time = Some(need(value).parse().expect("time of day")),
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

fn preset(o: &Options) -> (LandscapeSpec, KindRegistry) {
    let knobs = Knobs {
        height: o.height,
        ..Knobs::default()
    };
    match o.preset.as_str() {
        "plain" => (plain_landscape(&knobs), KindRegistry::with_builtins()),
        #[cfg(feature = "kit")]
        "proving" => {
            let mut kinds = voxelize_gen::landscape::kit::test_kinds();
            sinkhole::register(&mut kinds);
            (
                sinkhole::with_sinkholes(voxelize_gen::landscape::kit::proving_landscape(&knobs)),
                kinds,
            )
        }
        other => panic!("unknown preset {other} (plain; proving with --features kit)"),
    }
}

/// The landscape stage, logging every chunk it generates.
struct TracingStage {
    inner: LandscapeStage,
    out: Arc<Mutex<std::io::BufWriter<std::fs::File>>>,
}

impl ChunkStage for TracingStage {
    fn name(&self) -> String {
        self.inner.name()
    }

    fn process(&self, chunk: Chunk, resources: Resources, space: Option<Space>) -> Chunk {
        let voxelize::Vec2(cx, cz) = chunk.coords;
        {
            let mut w = self.out.lock().unwrap_or_else(|p| p.into_inner());
            let _ = writeln!(w, "{cx} {cz}");
            let _ = w.flush();
        }
        self.inner.process(chunk, resources, space)
    }
}

fn query<T: std::str::FromStr>(
    q: &web::Query<std::collections::HashMap<String, String>>,
    k: &str,
) -> Option<T> {
    q.get(k).and_then(|v| v.parse().ok())
}

type Q = web::Query<std::collections::HashMap<String, String>>;

async fn explain(land: web::Data<Arc<Landscape>>, q: Q) -> HttpResponse {
    let (Some(x), Some(z)) = (query::<i32>(&q, "x"), query::<i32>(&q, "z")) else {
        return HttpResponse::BadRequest().body("explain needs x and z");
    };
    let land = land.get_ref().clone();
    let text = query::<u8>(&q, "text") == Some(1);
    let body = web::block(move || {
        let e = land.explain(x, z);
        if text {
            e.to_text()
        } else {
            serde_json::to_string_pretty(&e).expect("serializes")
        }
    })
    .await
    .unwrap_or_default();
    HttpResponse::Ok()
        .content_type(if text {
            "text/plain"
        } else {
            "application/json"
        })
        .body(body)
}

async fn map(land: web::Data<Arc<Landscape>>, q: Q) -> HttpResponse {
    let layer = q
        .get("layer")
        .cloned()
        .unwrap_or_else(|| "hillshade".into());
    let size = query::<usize>(&q, "size").unwrap_or(1024).min(8192);
    let stride = query::<i32>(&q, "stride").unwrap_or(4).max(1);
    let land = land.get_ref().clone();
    let (sx, sz) = land.spawn();
    let x0 = query::<i32>(&q, "x0").unwrap_or(sx - size as i32 / 2);
    let z0 = query::<i32>(&q, "z0").unwrap_or(sz - size as i32 / 2);
    let n = (size / stride as usize).max(1);
    let png = web::block(move || {
        render::map_layer(&land, &layer, x0, z0, n, stride).map(|(mut c, rows)| {
            render::legend(&mut c, &rows);
            render::label(
                &mut c,
                &format!(
                    "{} {layer} {size} BLOCKS FROM {x0},{z0} STRIDE {stride}",
                    land.identity().preset
                ),
                size,
            );
            c.encode_png()
        })
    })
    .await;
    match png {
        Ok(Ok(bytes)) => HttpResponse::Ok().content_type("image/png").body(bytes),
        Ok(Err(e)) => HttpResponse::BadRequest().body(e),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

async fn dag(land: web::Data<Arc<Landscape>>) -> HttpResponse {
    HttpResponse::Ok()
        .content_type("text/plain")
        .body(land.dag().to_text())
}

async fn census(land: web::Data<Arc<Landscape>>, q: Q) -> HttpResponse {
    let r = query::<f64>(&q, "r").unwrap_or(2048.0);
    let land = land.get_ref().clone();
    let body = web::block(move || {
        let (sx, sz) = land.spawn();
        let instances = land.instances_in(Aabb2::around(sx as f64, sz as f64, r));
        serde_json::to_string_pretty(&serde_json::json!({
            "spawn": [sx, sz],
            "radius": r,
            "instances": instances,
            "plans": land.plan_stats(),
        }))
        .expect("serializes")
    })
    .await
    .unwrap_or_default();
    HttpResponse::Ok()
        .content_type("application/json")
        .body(body)
}

async fn quality(land: web::Data<Arc<Landscape>>, q: Q) -> HttpResponse {
    let land = land.get_ref().clone();
    let (sx, sz) = land.spawn();
    let size = query::<usize>(&q, "size").unwrap_or(1024).min(8192);
    let stride = query::<u32>(&q, "stride").unwrap_or(2).max(1);
    let x0 = query::<i32>(&q, "x0").unwrap_or(sx - size as i32 / 2);
    let z0 = query::<i32>(&q, "z0").unwrap_or(sz - size as i32 / 2);
    let body = web::block(move || {
        serde_json::to_string_pretty(&land.quality(x0, z0, size, stride as i32))
            .expect("serializes")
    })
    .await
    .unwrap_or_default();
    HttpResponse::Ok()
        .content_type("application/json")
        .body(body)
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
    if let Some(t) = o.time {
        builder = builder.default_time(t).does_tick_time(false);
    }
    let config = builder.build();

    let (spec, kinds) = preset(&o);
    let land = compile(&spec, &kinds, &binding, &registry, &config)
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
            if let Some(w) = &report.warning {
                println!("warning: {w}");
            }
        }
        None => println!("identity: saving is off, nothing persisted"),
    }
    let (sx, sy, sz) = land.spawn_point();
    let spawn = land.column(sx, sz, Tier::Full);
    println!(
        "spawn ({sx}, {sy}, {sz}): biome {}, slope {:.3}, {:?}",
        land.biome_keys()[spawn.biome.id.0 as usize],
        spawn.slope,
        land.spawn_report().outcome
    );
    if land.has_nodes() {
        println!("composition order: {}", land.dag().order.join(", "));
    }

    let mut world = World::new("showcase", &config);
    {
        let mut pipeline = world.pipeline_mut();
        match &o.trace_out {
            Some(path) => {
                let file = std::fs::File::create(path).expect("create the trace file");
                let mut w = std::io::BufWriter::new(file);
                let _ = writeln!(
                    w,
                    "# showcase walk: preset {} seed {} H {}; one `cx cz` per generated chunk, in the order the engine's workers took them",
                    id.preset, o.seed, o.height
                );
                pipeline.add_stage(TracingStage {
                    inner: LandscapeStage::new(land.clone()),
                    out: Arc::new(Mutex::new(w)),
                });
                println!("tracing chunk requests to {path}");
            }
            None => voxelize_gen::landscape::install(&mut *pipeline, land.clone()),
        }
    }

    if let Some(port) = o.debug_http {
        let data = web::Data::new(land.clone());
        let server = HttpServer::new(move || {
            App::new()
                .app_data(data.clone())
                .route("/landscape/explain", web::get().to(explain))
                .route("/landscape/map", web::get().to(map))
                .route("/landscape/dag", web::get().to(dag))
                .route("/landscape/census", web::get().to(census))
                .route("/landscape/quality", web::get().to(quality))
        })
        .workers(2)
        .bind(("127.0.0.1", port))?
        .run();
        actix_web::rt::spawn(server);
        println!("debug routes on http://127.0.0.1:{port}/landscape/");
    }

    let mut server = Server::new()
        .port(o.port)
        .secret("test")
        .registry(&registry)
        .build();
    server
        .add_world(world)
        .expect("the showcase world is added");
    println!("showcase serving world `showcase` on port {}", o.port);
    Voxelize::run(server).await
}
