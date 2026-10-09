use std::any::Any;
use std::collections::{BTreeMap, BTreeSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, RwLock};

use log::warn;
use serde_json::{json, Value};

use super::{ClientFilter, MessageQueues, World};
use crate::{Message, MessageType, MethodProtocol};

/// The reply a caller gets when the world it called has no handler under
/// that name. Payload: `{"method", "world", "handledBy"}`, where `handledBy`
/// lists the worlds on the same server that do handle it, and is absent
/// when the world runs outside a server that keeps a [`MethodIndex`].
pub const UNHANDLED_METHOD_REPLY: &str = "vox-builtin:unhandled-method";

/// The reply a caller gets when its call reached a handler, or the world's
/// guard, and did nothing: the guard refused it, the handler turned it down
/// through [`World::reject_method`], or one of them panicked. Payload:
/// `{"method", "world", "reason"}`.
pub const METHOD_REJECTED_REPLY: &str = "vox-builtin:method-rejected";

/// What a game's [`MethodGuard`] decided about one inbound `Method` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MethodVerdict {
    /// Run the handler.
    Allow,
    /// Skip the handler. The guard has already told the caller why, in its
    /// own words, and logged the refusal; dispatch adds only the
    /// machine-readable [`METHOD_REJECTED_REPLY`].
    Refuse,
}

/// Which worlds handle each method, kept by a server for every world it
/// runs, so a world with no handler for a call can tell the caller where the
/// call would have run. Every world the server adds holds a handle to the
/// same index.
#[derive(Clone, Default)]
pub struct MethodIndex(Arc<RwLock<BTreeMap<String, BTreeSet<String>>>>);

impl MethodIndex {
    /// Records `methods` (dispatch keys) as the ones `world` handles,
    /// replacing whatever it held under that name.
    pub fn record(&self, world: &str, methods: impl IntoIterator<Item = String>) {
        let mut index = self.0.write().unwrap_or_else(|poisoned| poisoned.into_inner());
        index.insert(world.to_owned(), methods.into_iter().collect());
    }

    /// Drops `world` from the index, returning the methods it handled.
    pub fn forget(&self, world: &str) -> Option<BTreeSet<String>> {
        let mut index = self.0.write().unwrap_or_else(|poisoned| poisoned.into_inner());
        index.remove(world)
    }

    /// The worlds that handle `method` (any casing), sorted.
    pub fn worlds_handling(&self, method: &str) -> Vec<String> {
        let key = method.to_lowercase();
        let index = self.0.read().unwrap_or_else(|poisoned| poisoned.into_inner());
        index
            .iter()
            .filter(|(_, methods)| methods.contains(&key))
            .map(|(world, _)| world.clone())
            .collect()
    }
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

    /// Tells `client_id` that its call to `method` did nothing here, and
    /// why, as a [`METHOD_REJECTED_REPLY`]. A handler that turns a call down
    /// (an unreadable payload, a name it does not know) says so through this
    /// rather than returning in silence: a caller waiting on the call's
    /// outcome reads it, and a log line on the server reaches nobody.
    pub fn reject_method(&mut self, client_id: &str, method: &str, reason: &str) {
        let payload = json!({
            "method": method.to_lowercase(),
            "world": self.name,
            "reason": reason,
        });
        self.reply_to_method(client_id, METHOD_REJECTED_REPLY, payload);
    }

    fn reply_to_method(&mut self, client_id: &str, reply: &str, payload: Value) {
        self.write_resource::<MessageQueues>().push((
            Message::new(&MessageType::Method)
                .method(MethodProtocol {
                    name: reply.to_owned(),
                    payload: payload.to_string(),
                })
                .build(),
            ClientFilter::Direct(client_id.to_owned()),
        ));
    }

    /// Runs one `Method` call exactly as one arriving from the network: the
    /// handler registered under `method` (any casing), behind the world's
    /// guard. A call that runs nothing is answered: an
    /// [`UNHANDLED_METHOD_REPLY`] when no handler has the name, a
    /// [`METHOD_REJECTED_REPLY`] when the guard refuses it or a panic stops it.
    pub fn dispatch_method(&mut self, client_id: &str, method: &str, payload: &str) {
        let key = method.to_lowercase();
        let Some(handle) = self.method_handles.get(&key).cloned() else {
            let handled_by = self
                .ecs()
                .try_fetch::<MethodIndex>()
                .map(|index| index.worlds_handling(&key));
            warn!(
                "`Method` type messages received of name {}, but no method handler set in world '{}' ({}).",
                method,
                self.name,
                match &handled_by {
                    Some(worlds) if worlds.is_empty() => "no world on this server handles it".to_owned(),
                    Some(worlds) => format!("handled in {}", worlds.join(", ")),
                    None => "this world keeps no index of the others".to_owned(),
                }
            );
            let mut reply = json!({ "method": key, "world": self.name });
            if let Some(worlds) = handled_by {
                reply["handledBy"] = json!(worlds);
            }
            self.reply_to_method(client_id, UNHANDLED_METHOD_REPLY, reply);
            return;
        };

        // Method payloads are client-supplied input. A panicking guard or
        // handler (e.g. an unknown block name lookup) must not unwind through
        // the actor and take the whole world down with it.
        if let Some(guard) = self.method_guard() {
            match catch_unwind(AssertUnwindSafe(|| guard.check(self, client_id, &key))) {
                Ok(MethodVerdict::Allow) => {}
                Ok(MethodVerdict::Refuse) => {
                    self.reject_method(client_id, &key, "this world's method guard refused it");
                    return;
                }
                Err(panic) => {
                    let reason = panic_reason(&*panic).to_owned();
                    warn!(
                        "Method guard panicked on '{}' from {} in world '{}': {}. The call is refused.",
                        method, client_id, self.name, reason
                    );
                    self.reject_method(
                        client_id,
                        &key,
                        &format!("the method guard panicked ({reason}), so the call was refused"),
                    );
                    return;
                }
            }
        }

        if let Err(panic) = catch_unwind(AssertUnwindSafe(|| handle(self, client_id, payload))) {
            let reason = panic_reason(&*panic).to_owned();
            warn!(
                "Method handler '{}' panicked in world '{}': {}. Continuing.",
                method, self.name, reason
            );
            self.reject_method(client_id, &key, &format!("its handler panicked ({reason})"));
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

    /// Every method reply queued for `client`, as `(name, payload)`. Drains
    /// the whole queue, so replies to anyone else are gone afterwards.
    fn replies_to(world: &mut World, client: &str) -> Vec<(String, Value)> {
        world
            .write_resource::<MessageQueues>()
            .drain_prioritized()
            .into_iter()
            .filter(|(_, filter)| matches!(filter, ClientFilter::Direct(id) if id == client))
            .filter_map(|(message, _)| message.method)
            .map(|method| {
                let payload = serde_json::from_str(&method.payload).unwrap_or(Value::Null);
                (method.name, payload)
            })
            .collect()
    }

    #[test]
    fn a_call_nothing_handles_is_answered_with_the_worlds_that_do() {
        let index = MethodIndex::default();
        let mut bare = world("bare");
        let mut sandbox = world("sandbox");
        sandbox.set_method_handle("Sandbox:Fill", |_, _, _| {});
        index.record(&bare.name, bare.method_names());
        index.record(&sandbox.name, sandbox.method_names());
        bare.ecs_mut().insert(index.clone());

        bare.dispatch_method("agent", "sandbox:fill", "{}");

        assert_eq!(
            replies_to(&mut bare, "agent"),
            [(
                UNHANDLED_METHOD_REPLY.to_owned(),
                json!({ "method": "sandbox:fill", "world": "bare", "handledBy": ["sandbox"] }),
            )]
        );
    }

    #[test]
    fn a_world_outside_a_server_says_it_cannot_tell_who_handles_a_call() {
        let mut lone = world("lone");

        lone.dispatch_method("agent", "Sandbox:Fill", "{}");

        assert_eq!(
            replies_to(&mut lone, "agent"),
            [(
                UNHANDLED_METHOD_REPLY.to_owned(),
                json!({ "method": "sandbox:fill", "world": "lone" }),
            )],
            "no index means no handledBy at all, not an empty list that claims nobody handles it"
        );
    }

    #[test]
    fn a_refused_call_and_a_panicking_handler_are_answered_as_rejected() {
        let mut world = world("method-guard-rejections");
        recording_handler(&mut world, "kill-all");
        world.set_method_handle("explode", |_, _, _| panic!("no such block 'cratee'"));
        world.set_method_guard(Arc::new(RefuseOne {
            refused: "guest",
            asked: Mutex::default(),
        }));

        world.dispatch_method("guest", "kill-all", "{}");
        assert_eq!(
            replies_to(&mut world, "guest"),
            [(
                METHOD_REJECTED_REPLY.to_owned(),
                json!({
                    "method": "kill-all",
                    "world": "method-guard-rejections",
                    "reason": "this world's method guard refused it",
                }),
            )]
        );

        world.dispatch_method("admin", "explode", "{}");
        assert_eq!(
            replies_to(&mut world, "admin"),
            [(
                METHOD_REJECTED_REPLY.to_owned(),
                json!({
                    "method": "explode",
                    "world": "method-guard-rejections",
                    "reason": "its handler panicked (no such block 'cratee')",
                }),
            )]
        );
    }

    #[test]
    fn a_handler_turns_a_call_down_out_loud_and_a_call_that_ran_gets_no_reply() {
        let mut world = world("method-guard-reject");
        world.set_method_handle("sandbox:fill", |world, client_id, payload| {
            if payload.contains("cratee") {
                world.reject_method(client_id, "Sandbox:Fill", "unknown block name 'cratee'");
            }
        });

        world.dispatch_method("agent", "sandbox:fill", r#"{"block":"crate"}"#);
        assert!(replies_to(&mut world, "agent").is_empty());

        world.dispatch_method("agent", "sandbox:fill", r#"{"block":"cratee"}"#);
        assert_eq!(
            replies_to(&mut world, "agent"),
            [(
                METHOD_REJECTED_REPLY.to_owned(),
                json!({
                    "method": "sandbox:fill",
                    "world": "method-guard-reject",
                    "reason": "unknown block name 'cratee'",
                }),
            )]
        );
    }

    #[test]
    fn the_index_follows_worlds_in_and_out() {
        let index = MethodIndex::default();
        index.record("b", ["sandbox:fill".to_owned(), "stack".to_owned()]);
        index.record("a", ["sandbox:fill".to_owned()]);

        assert_eq!(index.worlds_handling("SANDBOX:FILL"), ["a", "b"]);
        assert_eq!(index.worlds_handling("stack"), ["b"]);
        assert!(index.worlds_handling("teleport").is_empty());

        let methods = index.forget("b").expect("b was recorded");
        assert!(methods.contains("stack"));
        assert_eq!(index.worlds_handling("sandbox:fill"), ["a"]);
        index.record("c", methods);
        assert_eq!(index.worlds_handling("stack"), ["c"]);
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
