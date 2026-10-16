use super::*;
use crate::world::{
    InitRegistry, WorldConfig, INIT_REGISTRY_CACHED_KEY, INIT_REGISTRY_DIGEST_KEY,
    INIT_REGISTRY_LENGTH_KEY,
};
use crate::{decode_message, Block, GetWorldStats, SessionIdentity};
use actix::{Handler, MessageResult};

const WORLD: &str = "cacheworld";
const OTHER_WORLD: &str = "otherworld";

fn registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_blocks(&[
        Block::new("Stone").id(1).build(),
        Block::new("Dirt").id(2).build(),
        Block::new("Lamp").id(3).torch_light_level(12).build(),
    ]);
    registry
}

fn build_server() -> Server {
    let mut server = Server::new().debug(false).registry(&registry()).build();
    let config = WorldConfig::new().build();
    server
        .add_world(World::new(WORLD, &config))
        .expect("world should register");
    server
        .add_world(World::new(OTHER_WORLD, &config))
        .expect("second world should register");
    server
}

fn fake_socket() -> (WsSender, mpsc::UnboundedReceiver<Vec<u8>>) {
    let (control_tx, control_rx) = mpsc::unbounded_channel();
    let (bulk_tx, _) = mpsc::unbounded_channel();
    (WsSender::new(control_tx, bulk_tx), control_rx)
}

fn join_message(world: &str, registry_digest: Option<&str>) -> Message {
    let mut body = json!({ "world": world, "username": "tester" });
    if let Some(digest) = registry_digest {
        body["registryDigest"] = json!(digest);
    }
    Message::new(&MessageType::Join)
        .json(&body.to_string())
        .build()
}

/// The INIT a session receives for one JOIN: its raw JSON text and the
/// encoded size it went out at.
struct Init {
    text: String,
    json: Value,
    wire_bytes: usize,
}

/// Join `world` as a fresh session and return the INIT it is answered with.
async fn join(server: &mut Server, client: &str, world: &str, digest: Option<&str>) -> Init {
    let (sender, mut rx) = fake_socket();
    let (id, token) =
        server.register_session(SessionIdentity::for_client(client), false, sender.clone());
    assert_eq!(
        server.on_request(&id, join_message(world, digest), None, 0, Some(&token)),
        None
    );
    // The world handles JOIN on its own thread; a round trip through its
    // mailbox proves the INIT went out.
    server
        .worlds
        .get(world)
        .unwrap()
        .send(GetWorldStats)
        .await
        .unwrap();

    while let Ok(bytes) = rx.try_recv() {
        sender.mark_control_written();
        let message = decode_message(&bytes).ok().or_else(|| {
            let mut decoder = lz4_flex::frame::FrameDecoder::new(&bytes[..]);
            let mut decompressed = Vec::new();
            std::io::Read::read_to_end(&mut decoder, &mut decompressed).ok()?;
            decode_message(&decompressed).ok()
        });
        if let Some(message) = message.filter(|m| m.r#type == MessageType::Init as i32) {
            return Init {
                json: serde_json::from_str(&message.json).unwrap(),
                text: message.json,
                wire_bytes: bytes.len(),
            };
        }
    }
    panic!("no INIT for {client} in {world}");
}

fn digest_of(init: &Init) -> String {
    init.json[INIT_REGISTRY_DIGEST_KEY]
        .as_str()
        .expect("every INIT names its registry digest")
        .to_owned()
}

fn assert_full(init: &Init) {
    assert!(
        init.text.starts_with("{\"blocks\":"),
        "a full INIT starts with the registry text"
    );
    assert!(init.json["blocks"]["stone"].is_object());
    assert!(init.json.get(INIT_REGISTRY_CACHED_KEY).is_none());

    // The advertised length cuts exactly the registry text out of the INIT
    // text, the way a client slices it (UTF-16 units; this registry is ASCII).
    let length = init.json[INIT_REGISTRY_LENGTH_KEY].as_u64().unwrap() as usize;
    let prefix = "{\"blocks\":".len();
    let cut = &init.text[prefix..prefix + length];
    assert_eq!(
        serde_json::from_str::<Value>(cut).unwrap(),
        init.json["blocks"],
        "the cut is the registry and nothing else"
    );
    assert!(
        init.text[prefix + length..].starts_with(&format!(
            ",\"{}\":\"{}\"",
            INIT_REGISTRY_DIGEST_KEY,
            digest_of(init)
        )),
        "the digest follows the registry text, marking the cut"
    );
    assert_eq!(digest_of(init), crate::registry_digest(cut.as_bytes()));
}

#[test]
fn a_join_without_a_digest_gets_the_full_registry_and_its_digest() {
    actix::System::new().block_on(async {
        let mut server = build_server();
        let init = join(&mut server, "first", WORLD, None).await;
        assert_full(&init);
    });
}

#[test]
fn a_join_naming_the_digest_gets_an_init_without_the_registry() {
    actix::System::new().block_on(async {
        let mut server = build_server();
        let full = join(&mut server, "first", WORLD, None).await;
        let digest = digest_of(&full);

        let cached = join(&mut server, "second", WORLD, Some(&digest)).await;
        assert!(cached.json.get("blocks").is_none(), "no registry: {}", cached.text);
        assert_eq!(cached.json[INIT_REGISTRY_CACHED_KEY], json!(true));
        assert_eq!(digest_of(&cached), digest);
        assert!(cached.json.get(INIT_REGISTRY_LENGTH_KEY).is_none());
        // Everything else a join carries is still there.
        assert_eq!(cached.json["id"], json!("second"));
        assert!(cached.json["options"].is_object());
        assert!(cached.wire_bytes < full.wire_bytes);

        // The other world serves the same registry under the same digest.
        let elsewhere = join(&mut server, "third", OTHER_WORLD, Some(&digest)).await;
        assert!(elsewhere.json.get("blocks").is_none());
        assert_eq!(digest_of(&elsewhere), digest);
    });
}

#[test]
fn a_stale_or_empty_digest_gets_the_full_registry() {
    actix::System::new().block_on(async {
        let mut server = build_server();
        let full = join(&mut server, "first", WORLD, None).await;

        let stale = join(&mut server, "stale", WORLD, Some("0123-45")).await;
        assert_full(&stale);
        assert_eq!(digest_of(&stale), digest_of(&full));

        let empty = join(&mut server, "empty", WORLD, Some("")).await;
        assert_full(&empty);
    });
}

#[test]
fn a_replayed_join_answers_the_digest_it_carries() {
    actix::System::new().block_on(async {
        let mut server = build_server();
        let digest = digest_of(&join(&mut server, "first", WORLD, None).await);

        // Same session joining again (a retried JOIN): the replayed INIT
        // follows the retry's digest, not the first JOIN's.
        let (sender, mut rx) = fake_socket();
        let (id, token) =
            server.register_session(SessionIdentity::for_client("retry"), false, sender.clone());
        for digest in [None, Some(digest.as_str())] {
            assert_eq!(
                server.on_request(&id, join_message(WORLD, digest), None, 0, Some(&token)),
                None
            );
        }
        server
            .worlds
            .get(WORLD)
            .unwrap()
            .send(GetWorldStats)
            .await
            .unwrap();
        let mut inits = vec![];
        while let Ok(bytes) = rx.try_recv() {
            sender.mark_control_written();
            let decoded = decode_message(&bytes).ok().or_else(|| {
                let mut decoder = lz4_flex::frame::FrameDecoder::new(&bytes[..]);
                let mut out = Vec::new();
                std::io::Read::read_to_end(&mut decoder, &mut out).ok()?;
                decode_message(&out).ok()
            });
            if let Some(message) = decoded.filter(|m| m.r#type == MessageType::Init as i32) {
                inits.push(serde_json::from_str::<Value>(&message.json).unwrap());
            }
        }
        assert_eq!(inits.len(), 2);
        assert!(inits[0]["blocks"].is_object());
        assert!(inits[1].get("blocks").is_none());
    });
}

#[test]
fn transports_always_get_the_full_registry() {
    actix::System::new().block_on(async {
        let mut server = build_server();
        let (sender, mut rx) = fake_socket();
        server.register_session(SessionIdentity::for_client("transport"), true, sender.clone());
        server
            .worlds
            .get(WORLD)
            .unwrap()
            .send(GetWorldStats)
            .await
            .unwrap();
        let mut saw_init = false;
        while let Ok(bytes) = rx.try_recv() {
            let decoded = decode_message(&bytes).ok().or_else(|| {
                let mut decoder = lz4_flex::frame::FrameDecoder::new(&bytes[..]);
                let mut out = Vec::new();
                std::io::Read::read_to_end(&mut decoder, &mut out).ok()?;
                decode_message(&out).ok()
            });
            if let Some(message) = decoded.filter(|m| m.r#type == MessageType::Init as i32) {
                let json: Value = serde_json::from_str(&message.json).unwrap();
                assert!(json["blocks"]["stone"].is_object());
                assert!(json[INIT_REGISTRY_DIGEST_KEY].is_string());
                saw_init = true;
            }
        }
        assert!(saw_init);
    });
}

#[test]
fn every_world_shares_one_registry_text() {
    let config = WorldConfig::new().build();
    let shared = SharedInitRegistry::default();
    let mut worlds = [World::new("a", &config), World::new("b", &config)];
    for world in worlds.iter_mut() {
        world.ecs_mut().insert(registry());
        world.share_init_registry(&shared);
        assert!(world.shares_init_registry_with(&shared));
    }
    let first = worlds[0].init_registry() as *const _;
    let second = worlds[1].init_registry() as *const _;
    assert!(std::ptr::eq(first, second), "serialized once, served by both");

    // A world outside any server still serves its own registry.
    let mut alone = World::new("alone", &config);
    alone.ecs_mut().insert(registry());
    assert!(!alone.shares_init_registry_with(&shared));
    assert_eq!(alone.init_registry().digest, worlds[0].init_registry().digest);
}

/// A registry no world holds: a copy serialized from it names itself in the
/// digest of every INIT it serves.
fn probe_registry() -> Registry {
    let mut registry = registry();
    registry.register_blocks(&[Block::new("Probe").id(4).build()]);
    registry
}

#[test]
fn worlds_the_server_adds_or_creates_serve_its_one_registry_copy() {
    actix::System::new().block_on(async {
        let mut server = Server::new().debug(false).registry(&registry()).build();
        // The server's copy is filled first, from the probe: an INIT names
        // the probe only when its world serves that very copy (one shared
        // Arc). A world serializing its own would name the real registry.
        let probe = server
            .init_registry
            .get_or_init("probe", &probe_registry())
            .digest
            .clone();
        assert_ne!(probe, InitRegistry::new(&registry()).digest);

        let config = WorldConfig::new().build();
        server
            .add_world(World::new(WORLD, &config))
            .expect("world should register");
        let added = join(&mut server, "added", WORLD, None).await;
        assert_eq!(digest_of(&added), probe, "add_world shares the copy");

        const CREATED: &str = "createdworld";
        let MessageResult(created) = <Server as Handler<CreateWorld>>::handle(
            &mut server,
            CreateWorld {
                name: CREATED.to_owned(),
                config: WorldConfig::new().build(),
                gc_policy: GcPolicy::Never,
            },
            &mut Context::new(),
        );
        created.expect("world should be created");
        let created = join(&mut server, "created", CREATED, None).await;
        assert_eq!(digest_of(&created), probe, "create_world shares the copy");
    });
}
