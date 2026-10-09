use std::sync::{Arc, Mutex};

use crate::{ChunkStage, MethodGuard, MethodVerdict, Registry, Server, World, WorldConfig};

/// A world's generation as its setup built it: the stage list, registry
/// and config the server would generate with.
pub struct CapturedWorld {
    pub name: String,
    pub stages: Vec<Arc<dyn ChunkStage + Send + Sync>>,
    pub registry: Registry,
    pub config: WorldConfig,
}

#[derive(Default)]
struct CaptureGuard {
    name: String,
    captured: Mutex<Option<CapturedWorld>>,
}

impl MethodGuard for CaptureGuard {
    fn check(&self, _: &mut World, _: &str, _: &str) -> MethodVerdict {
        MethodVerdict::Allow
    }

    fn audit(&self, world: &World) {
        if world.name != self.name {
            return;
        }
        *self.captured.lock().unwrap() = Some(CapturedWorld {
            name: world.name.clone(),
            stages: world.pipeline().stages.clone(),
            registry: (*world.registry()).clone(),
            config: (*world.config()).clone(),
        });
    }
}

/// Runs a game's world setup against a throwaway server and keeps what it
/// handed `Server::add_world` for the world called `name`, at the method
/// guard's audit (the moment the world is finished and not yet started).
/// Nothing about the pipeline is re-declared, so a viewer built on it
/// cannot drift from what the server generates.
pub fn capture_world(
    registry: &Registry,
    name: &str,
    setup: impl FnOnce(&mut Server),
) -> Result<CapturedWorld, String> {
    let guard = Arc::new(CaptureGuard {
        name: name.to_owned(),
        captured: Mutex::new(None),
    });
    let installed = guard.clone() as Arc<dyn MethodGuard>;
    let run = move || {
        let mut server = Server::new().registry(registry).build();
        server.method_guard = Some(installed);
        setup(&mut server);
    };
    // `add_world` starts the world's actor, which needs a running system.
    if actix::System::try_current().is_some() {
        run();
    } else {
        actix::System::new().block_on(async move { run() });
    }
    let captured = guard.captured.lock().unwrap().take();
    captured.ok_or_else(|| {
        format!("the setup never handed a world named `{name}` to Server::add_world")
    })
}
