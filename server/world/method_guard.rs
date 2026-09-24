use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

use log::warn;

use super::World;

/// What a game's [`MethodGuard`] decided about one inbound `Method` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MethodVerdict {
    /// Run the handler.
    Allow,
    /// Skip the handler. The guard has already told the caller why and
    /// logged the refusal; dispatch adds nothing.
    Refuse,
}

/// A game's check on every inbound `Method` call. The engine hands a method
/// from any connected client (or transport) to whatever handler is
/// registered under its name; a game with authority tiers installs one guard
/// so the check happens once, at dispatch, rather than in every handler.
///
/// Installed per world with [`World::set_method_guard`], or for every world
/// a server adds through `Server::method_guard`.
pub trait MethodGuard: Send + Sync {
    /// Decides one call before its handler runs. `method` is the dispatch
    /// key (lowercase); `client_id` is the caller, a player or a transport.
    fn check(&self, world: &mut World, client_id: &str, method: &str) -> MethodVerdict;

    /// Called once when a server adds `world`, after its setup registered
    /// every handler and before it starts: the place to report handlers the
    /// guard has no rule for.
    fn audit(&self, _world: &World) {}
}

pub(crate) struct MethodGuardSlot(pub(crate) Arc<dyn MethodGuard>);

impl World {
    /// Puts `guard` in front of every method this world dispatches.
    pub fn set_method_guard(&mut self, guard: Arc<dyn MethodGuard>) {
        self.ecs_mut().insert(MethodGuardSlot(guard));
    }

    pub(crate) fn method_guard(&self) -> Option<Arc<dyn MethodGuard>> {
        self.ecs()
            .try_fetch::<MethodGuardSlot>()
            .map(|slot| Arc::clone(&slot.0))
    }

    /// Every method a handler is registered under, as dispatch keys them
    /// (lowercase), sorted.
    pub fn method_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.method_handles.keys().cloned().collect();
        names.sort();
        names
    }

    /// Runs one `Method` call exactly as one arriving from the network: the
    /// handler registered under `method` (any casing), behind the world's
    /// guard.
    pub fn dispatch_method(&mut self, client_id: &str, method: &str, payload: &str) {
        let key = method.to_lowercase();
        let Some(handle) = self.method_handles.get(&key).cloned() else {
            warn!(
                "`Method` type messages received of name {}, but no method handler set.",
                method
            );
            return;
        };

        // Method payloads are client-supplied input. A panicking guard or
        // handler (e.g. an unknown block name lookup) must not unwind through
        // the actor and take the whole world down with it.
        if let Some(guard) = self.method_guard() {
            match catch_unwind(AssertUnwindSafe(|| guard.check(self, client_id, &key))) {
                Ok(MethodVerdict::Allow) => {}
                Ok(MethodVerdict::Refuse) => return,
                Err(panic) => {
                    warn!(
                        "Method guard panicked on '{}' from {} in world '{}': {}. The call is refused.",
                        method,
                        client_id,
                        self.name,
                        panic_reason(&*panic)
                    );
                    return;
                }
            }
        }

        if let Err(panic) = catch_unwind(AssertUnwindSafe(|| handle(self, client_id, payload))) {
            warn!(
                "Method handler '{}' panicked in world '{}': {}. Continuing.",
                method,
                self.name,
                panic_reason(&*panic)
            );
        }
    }
}

fn panic_reason(panic: &(dyn Any + Send)) -> &str {
    panic
        .downcast_ref::<String>()
        .map(|reason| reason.as_str())
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("unknown panic")
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::{Message, MessageType, MethodProtocol, WorldConfig};

    fn world(name: &str) -> World {
        World::new(name, &WorldConfig::new().saving(false).build())
    }

    /// Records every call a handler receives, as `client:payload`.
    fn recording_handler(world: &mut World, method: &str) -> Arc<Mutex<Vec<String>>> {
        let calls: Arc<Mutex<Vec<String>>> = Arc::default();
        let recorded = Arc::clone(&calls);
        world.set_method_handle(method, move |_, client_id, payload| {
            recorded
                .lock()
                .unwrap()
                .push(format!("{client_id}:{payload}"));
        });
        calls
    }

    /// Refuses one client and remembers every call it was asked about.
    struct RefuseOne {
        refused: &'static str,
        asked: Mutex<Vec<(String, String)>>,
    }

    impl MethodGuard for RefuseOne {
        fn check(&self, _: &mut World, client_id: &str, method: &str) -> MethodVerdict {
            self.asked
                .lock()
                .unwrap()
                .push((client_id.to_owned(), method.to_owned()));
            if client_id == self.refused {
                MethodVerdict::Refuse
            } else {
                MethodVerdict::Allow
            }
        }
    }

    struct Panics;

    impl MethodGuard for Panics {
        fn check(&self, _: &mut World, _: &str, _: &str) -> MethodVerdict {
            panic!("the guard fell over");
        }
    }

    #[test]
    fn the_guard_decides_before_the_handler_runs() {
        let mut world = world("method-guard-decides");
        let calls = recording_handler(&mut world, "Kill-All");
        let guard = Arc::new(RefuseOne {
            refused: "guest",
            asked: Mutex::default(),
        });
        world.set_method_guard(guard.clone());

        world.dispatch_method("guest", "kill-all", "{}");
        world.dispatch_method("admin", "KILL-ALL", "{}");

        assert_eq!(*calls.lock().unwrap(), ["admin:{}"]);
        assert_eq!(
            *guard.asked.lock().unwrap(),
            [
                ("guest".to_owned(), "kill-all".to_owned()),
                ("admin".to_owned(), "kill-all".to_owned()),
            ],
            "the guard sees every call under its lowercase dispatch key"
        );
    }

    #[test]
    fn a_method_message_from_the_network_meets_the_guard() {
        let mut world = world("method-guard-network");
        let calls = recording_handler(&mut world, "spawn-pig");
        world.set_method_guard(Arc::new(RefuseOne {
            refused: "guest",
            asked: Mutex::default(),
        }));
        let message = |payload: &str| {
            Message::new(&MessageType::Method)
                .method(MethodProtocol {
                    name: "spawn-pig".to_owned(),
                    payload: payload.to_owned(),
                })
                .build()
        };

        world.on_method("guest", message("guest-pig"));
        world.on_method("agent", message("agent-pig"));

        assert_eq!(*calls.lock().unwrap(), ["agent:agent-pig"]);
    }

    #[test]
    fn a_guard_that_panics_refuses_the_call_and_the_world_carries_on() {
        let mut world = world("method-guard-panics");
        let calls = recording_handler(&mut world, "remove-entity");
        world.set_method_guard(Arc::new(Panics));

        world.dispatch_method("guest", "remove-entity", "{}");
        world.dispatch_method("guest", "remove-entity", "{}");

        assert!(calls.lock().unwrap().is_empty());
    }

    #[test]
    fn without_a_guard_every_call_reaches_its_handler() {
        let mut world = world("method-guard-absent");
        let calls = recording_handler(&mut world, "craft");

        world.dispatch_method("guest", "craft", "planks");

        assert_eq!(*calls.lock().unwrap(), ["guest:planks"]);
    }

    #[test]
    fn method_names_lists_every_handler_under_its_dispatch_key() {
        let mut world = world("method-guard-names");
        world.set_method_handle("Garden:Place", |_, _, _| {});

        let names = world.method_names();

        assert!(names.contains(&"garden:place".to_owned()), "{names:?}");
        assert!(
            names.contains(&"vox-builtin:set-time".to_owned()),
            "{names:?}"
        );
        assert!(names.windows(2).all(|pair| pair[0] < pair[1]), "{names:?}");
    }
}
