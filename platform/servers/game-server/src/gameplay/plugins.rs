//! Server plugins: small scripts (Rhai) that react to what happens in the
//! world and act through a narrow API. Each lives in
//! `<content pack>/plugins/<key>/` with a `plugin.json` manifest and its
//! script, and is loaded once for the whole world (every dimension).
//!
//! Hooks a script may define (all optional):
//!
//! | function | when |
//! | --- | --- |
//! | `on_join(player)` / `on_leave(player)` | a player enters or leaves a dimension |
//! | `on_chat(player, text)` | a public chat line; return `false` to hide it |
//! | `on_command(player, name, args)` | `/name args`, for the manifest's `commands` |
//! | `on_event(player, event)` | `event.kind` mine, place, craft, smelt, kill, eat or enter, with `event.target` and `event.count` |
//! | `on_tick(seconds)` | once a second, with seconds since start |
//!
//! `player` is `#{ id, name, dimension }`. Scripts act with `tell(id, text)`,
//! `broadcast(text)`, `give(id, item_key, count)`, and keep state across
//! restarts with `store_get(key)` / `store_set(key, value)`. They cannot
//! touch files, the network or other plugins; each call is limited in
//! operations, and a plugin that keeps failing is switched off.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rhai::{Dynamic, Engine, FuncArgs, Map, AST};
use serde::Deserialize;

/// Operations one hook call may take before it is stopped.
pub const MAX_OPERATIONS: u64 = 200_000;
/// Failures after which a plugin is switched off.
pub const MAX_FAILURES: u32 = 10;
/// Keys a plugin may keep in its store.
pub const MAX_STORE_KEYS: usize = 10_000;
/// Actions one call may take (messages, gifts).
pub const MAX_ACTIONS_PER_CALL: usize = 64;
/// Commands the game keeps for itself.
pub const RESERVED_COMMANDS: &[&str] =
    &["w", "msg", "tell", "r", "l", "local", "g", "guild", "help"];

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub key: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_script")]
    pub script: String,
    /// Chat commands the plugin answers (`/name`).
    #[serde(default)]
    pub commands: Vec<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn default_script() -> String {
    "main.rhai".into()
}

fn yes() -> bool {
    true
}

/// What a script asked for; the game carries it out after the call.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Tell {
        player: String,
        text: String,
        from: String,
    },
    Broadcast {
        text: String,
        from: String,
    },
    Give {
        player: String,
        item: String,
        count: u32,
    },
}

#[derive(Default)]
struct Host {
    actions: Vec<Action>,
    /// The plugin being called (index into the list).
    current: usize,
    names: Vec<String>,
    stores: Vec<Map>,
    dirty: Vec<bool>,
}

pub struct Plugin {
    pub manifest: Manifest,
    ast: AST,
    pub failures: u32,
    pub disabled: bool,
}

impl Plugin {
    fn has(&self, hook: &str, arity: usize) -> bool {
        self.ast
            .iter_functions()
            .any(|f| f.name == hook && f.params.len() == arity)
    }
}

enum Queued {
    Join(Map),
    Leave(Map),
    Event(Map, Map),
    Tick(i64),
}

/// The world's plugins, shared by every dimension.
pub struct Plugins {
    engine: Engine,
    host: Arc<Mutex<Host>>,
    pub list: Vec<Plugin>,
    queue: Vec<Queued>,
    /// Actions waiting for each dimension's world to carry them out.
    outbox: HashMap<String, Vec<Action>>,
    store_dir: Option<PathBuf>,
}

pub type SharedPlugins = Arc<Mutex<Plugins>>;

/// A player as scripts see them.
pub fn player(id: &str, name: &str, dimension: &str) -> Map {
    let mut m = Map::new();
    m.insert("id".into(), id.into());
    m.insert("name".into(), name.into());
    m.insert("dimension".into(), dimension.into());
    m
}

fn valid_command(c: &str) -> bool {
    !c.is_empty()
        && c.len() <= 16
        && c.starts_with(|ch: char| ch.is_ascii_lowercase())
        && c.chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
        && !RESERVED_COMMANDS.contains(&c)
}

fn engine(host: Arc<Mutex<Host>>) -> Engine {
    let mut e = Engine::new();
    e.set_max_operations(MAX_OPERATIONS);
    e.set_max_call_levels(32);
    e.set_max_expr_depths(64, 32);
    e.set_max_string_size(64 * 1024);
    e.set_max_array_size(10_000);
    e.set_max_map_size(10_000);
    e.disable_symbol("eval");
    e.on_print(|s| log::info!("[plugin] {s}"));
    e.on_debug(|s, _, _| log::debug!("[plugin] {s}"));

    let push = {
        let host = host.clone();
        move |action: Action| {
            let mut h = host.lock().unwrap_or_else(|p| p.into_inner());
            if h.actions.len() < MAX_ACTIONS_PER_CALL {
                h.actions.push(action);
            }
        }
    };
    let from = {
        let host = host.clone();
        move || {
            let h = host.lock().unwrap_or_else(|p| p.into_inner());
            h.names.get(h.current).cloned().unwrap_or_default()
        }
    };
    {
        let (push, from) = (push.clone(), from.clone());
        e.register_fn("tell", move |player: &str, text: &str| {
            push(Action::Tell {
                player: player.into(),
                text: text.chars().take(256).collect(),
                from: from(),
            })
        });
    }
    {
        let (push, from) = (push.clone(), from.clone());
        e.register_fn("broadcast", move |text: &str| {
            push(Action::Broadcast {
                text: text.chars().take(256).collect(),
                from: from(),
            })
        });
    }
    {
        let push = push.clone();
        e.register_fn("give", move |player: &str, item: &str, count: i64| {
            if (1..=64 * 36).contains(&count) {
                push(Action::Give {
                    player: player.into(),
                    item: item.into(),
                    count: count as u32,
                })
            }
        });
    }
    {
        let host = host.clone();
        e.register_fn("store_get", move |key: &str| -> Dynamic {
            let h = host.lock().unwrap_or_else(|p| p.into_inner());
            h.stores
                .get(h.current)
                .and_then(|s| s.get(key).cloned())
                .unwrap_or(Dynamic::UNIT)
        });
    }
    {
        let host = host.clone();
        e.register_fn("store_set", move |key: &str, value: Dynamic| {
            let mut h = host.lock().unwrap_or_else(|p| p.into_inner());
            let i = h.current;
            let Some(store) = h.stores.get_mut(i) else {
                return;
            };
            if store.len() >= MAX_STORE_KEYS && !store.contains_key(key) {
                return;
            }
            if value.is_unit() {
                store.remove(key);
            } else {
                store.insert(key.into(), value);
            }
            h.dirty[i] = true;
        });
    }
    e
}

impl Plugins {
    /// No plugins.
    pub fn none() -> Self {
        let host = Arc::new(Mutex::new(Host::default()));
        Self {
            engine: engine(host.clone()),
            host,
            list: Vec::new(),
            queue: Vec::new(),
            outbox: HashMap::new(),
            store_dir: None,
        }
    }

    /// Every plugin under `dir` (none when it does not exist). A broken
    /// plugin stops the server at start, with its path in the error.
    pub fn load(dir: &Path, store_dir: Option<&Path>) -> Result<Self, String> {
        let mut plugins = Self::none();
        plugins.store_dir = store_dir.map(Path::to_path_buf);
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Ok(plugins);
        };
        let mut dirs: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.join("plugin.json").is_file())
            .collect();
        dirs.sort();
        let mut commands: HashMap<String, String> = HashMap::new();
        for path in dirs {
            let at = path.display();
            let raw = std::fs::read_to_string(path.join("plugin.json"))
                .map_err(|e| format!("{at}/plugin.json: {e}"))?;
            let manifest: Manifest =
                serde_json::from_str(&raw).map_err(|e| format!("{at}/plugin.json: {e}"))?;
            if !manifest.enabled {
                continue;
            }
            if !platform_content::is_valid_key(&manifest.key) {
                return Err(format!(
                    "{at}/plugin.json: key {:?} must be snake_case",
                    manifest.key
                ));
            }
            if plugins.list.iter().any(|p| p.manifest.key == manifest.key) {
                return Err(format!(
                    "{at}: a plugin named {:?} is already loaded",
                    manifest.key
                ));
            }
            for c in &manifest.commands {
                if !valid_command(c) {
                    return Err(format!("{at}/plugin.json: command {c:?} is reserved or not a-z, 0-9 and _ (16 at most)"));
                }
                if let Some(other) = commands.insert(c.clone(), manifest.key.clone()) {
                    return Err(format!("{at}/plugin.json: /{c} is already {other}'s"));
                }
            }
            let script = path.join(&manifest.script);
            let source = std::fs::read_to_string(&script)
                .map_err(|e| format!("{}: {e}", script.display()))?;
            let ast = plugins
                .engine
                .compile(&source)
                .map_err(|e| format!("{}: {e}", script.display()))?;
            plugins.add(manifest, ast);
        }
        Ok(plugins)
    }

    /// A plugin from source (tests, and `load`).
    pub fn add(&mut self, manifest: Manifest, ast: AST) {
        let store = self
            .store_dir
            .as_ref()
            .and_then(|d| std::fs::read_to_string(d.join(format!("{}.json", manifest.key))).ok())
            .and_then(|raw| serde_json::from_str::<Dynamic>(&raw).ok())
            .and_then(|d| d.try_cast::<Map>())
            .unwrap_or_default();
        {
            let mut h = self.host.lock().unwrap_or_else(|p| p.into_inner());
            h.names.push(manifest.name.clone());
            h.stores.push(store);
            h.dirty.push(false);
        }
        log::info!("plugin {} {} loaded", manifest.key, manifest.version);
        self.list.push(Plugin {
            manifest,
            ast,
            failures: 0,
            disabled: false,
        });
    }

    pub fn compile(&self, source: &str) -> Result<AST, String> {
        self.engine.compile(source).map_err(|e| e.to_string())
    }

    /// Dimensions whose worlds carry out actions (each takes its own copy).
    pub fn attach(&mut self, world: &str) {
        self.outbox.entry(world.to_owned()).or_default();
    }

    fn call(&mut self, i: usize, hook: &str, args: impl FuncArgs) -> Option<Dynamic> {
        let plugin = &self.list[i];
        if plugin.disabled {
            return None;
        }
        self.host.lock().unwrap_or_else(|p| p.into_inner()).current = i;
        let mut scope = rhai::Scope::new();
        let options = rhai::CallFnOptions::new()
            .eval_ast(false)
            .rewind_scope(true);
        let result = self.engine.call_fn_with_options::<Dynamic>(
            options,
            &mut scope,
            &plugin.ast,
            hook,
            args,
        );
        let actions =
            std::mem::take(&mut self.host.lock().unwrap_or_else(|p| p.into_inner()).actions);
        for queue in self.outbox.values_mut() {
            queue.extend(actions.iter().cloned());
        }
        match result {
            Ok(v) => Some(v),
            Err(e) => {
                let plugin = &mut self.list[i];
                plugin.failures += 1;
                log::warn!("plugin {}: {hook} failed: {e}", plugin.manifest.key);
                if plugin.failures >= MAX_FAILURES {
                    plugin.disabled = true;
                    log::error!(
                        "plugin {} failed {MAX_FAILURES} times and is switched off",
                        plugin.manifest.key
                    );
                }
                None
            }
        }
    }

    fn each(&mut self, hook: &str, arity: usize, args: impl Fn() -> Vec<Dynamic>) -> Vec<Dynamic> {
        let mut out = Vec::new();
        for i in 0..self.list.len() {
            if self.list[i].has(hook, arity) {
                if let Some(v) = self.call(i, hook, args()) {
                    out.push(v);
                }
            }
        }
        out
    }

    /// A public chat line: false when a plugin hides it.
    pub fn chat(&mut self, player: Map, text: &str) -> bool {
        let results = self.each("on_chat", 2, || vec![player.clone().into(), text.into()]);
        !results.iter().any(|r| r.as_bool() == Ok(false))
    }

    /// `/name args`: true when a plugin answers it.
    pub fn command(&mut self, player: Map, name: &str, args: &str) -> bool {
        let Some(i) = self
            .list
            .iter()
            .position(|p| !p.disabled && p.manifest.commands.iter().any(|c| c == name))
        else {
            return false;
        };
        if self.list[i].has("on_command", 3) {
            self.call(i, "on_command", (player, name.to_owned(), args.to_owned()));
        }
        true
    }

    /// Plugin commands for /help: `(command, plugin name)`.
    pub fn commands(&self) -> Vec<(String, String)> {
        self.list
            .iter()
            .filter(|p| !p.disabled)
            .flat_map(|p| {
                p.manifest
                    .commands
                    .iter()
                    .map(|c| (c.clone(), p.manifest.name.clone()))
            })
            .collect()
    }

    pub fn joined(&mut self, player: Map) {
        self.queue.push(Queued::Join(player));
    }

    pub fn left(&mut self, player: Map) {
        self.queue.push(Queued::Leave(player));
    }

    pub fn event(&mut self, player: Map, kind: &str, target: &str, count: u32) {
        let mut e = Map::new();
        e.insert("kind".into(), kind.into());
        e.insert("target".into(), target.into());
        e.insert("count".into(), (count as i64).into());
        self.queue.push(Queued::Event(player, e));
    }

    pub fn tick(&mut self, seconds: i64) {
        self.queue.push(Queued::Tick(seconds));
    }

    /// Run the hooks queued since last time.
    pub fn run_queued(&mut self) {
        for q in std::mem::take(&mut self.queue) {
            match q {
                Queued::Join(p) => drop(self.each("on_join", 1, || vec![p.clone().into()])),
                Queued::Leave(p) => drop(self.each("on_leave", 1, || vec![p.clone().into()])),
                Queued::Event(p, e) => {
                    drop(self.each("on_event", 2, || vec![p.clone().into(), e.clone().into()]))
                }
                Queued::Tick(s) => drop(self.each("on_tick", 1, || vec![s.into()])),
            }
        }
    }

    /// Actions for one dimension's world to carry out.
    pub fn take_actions(&mut self, world: &str) -> Vec<Action> {
        self.outbox
            .get_mut(world)
            .map(std::mem::take)
            .unwrap_or_default()
    }

    /// Write stores that changed.
    pub fn save(&mut self) {
        let Some(dir) = self.store_dir.clone() else {
            return;
        };
        let mut h = self.host.lock().unwrap_or_else(|p| p.into_inner());
        for i in 0..h.stores.len() {
            if !h.dirty[i] {
                continue;
            }
            h.dirty[i] = false;
            let key = &self.list[i].manifest.key;
            let json = match serde_json::to_string(&Dynamic::from_map(h.stores[i].clone())) {
                Ok(j) => j,
                Err(e) => {
                    log::error!("plugin {key}: store not saved: {e}");
                    continue;
                }
            };
            let _ = std::fs::create_dir_all(&dir);
            let tmp = dir.join(format!("{key}.json.tmp"));
            if let Err(e) = std::fs::write(&tmp, json)
                .and_then(|_| std::fs::rename(&tmp, dir.join(format!("{key}.json"))))
            {
                log::error!("plugin {key}: store not saved: {e}");
            }
        }
    }
}

/// Runs queued hooks (and the overworld's once-a-second tick), then carries
/// out what scripts asked for in this world: messages and gifts.
#[derive(Default)]
pub struct PluginSystem {
    started: Option<std::time::Instant>,
    last_tick: i64,
    since_save: f32,
    last: Option<std::time::Instant>,
}

impl<'a> specs::System<'a> for PluginSystem {
    type SystemData = (
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::WriteExpect<'a, super::Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (clients, mut g, mut events): Self::SystemData) {
        use serde_json::json;
        use voxelize::{ClientFilter, Event};

        let now = std::time::Instant::now();
        let dt = self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0);
        self.last = Some(now);
        let started = *self.started.get_or_insert(now);
        let shared = g.dimensions.plugins.clone();
        let Ok(mut plugins) = shared.lock() else {
            return;
        };
        if plugins.list.is_empty() {
            return;
        }
        let here = g.dimensions.current;
        // One clock for the whole world: the overworld's.
        let seconds = now.duration_since(started).as_secs() as i64;
        if here == platform_content::Dimension::Overworld && seconds > self.last_tick {
            self.last_tick = seconds;
            plugins.tick(seconds);
        }
        plugins.run_queued();
        self.since_save += dt;
        if self.since_save >= 10.0 && here == platform_content::Dimension::Overworld {
            self.since_save = 0.0;
            plugins.save();
        }
        let world = g.dimensions.world_of(here).unwrap_or_default().to_owned();
        let actions = plugins.take_actions(&world);
        drop(plugins);
        let line = |from: &str, text: &str| json!({ "channel": "system", "from": null, "to": null, "body": format!("[{from}] {text}") });
        for action in actions {
            match action {
                Action::Tell { player, text, from } if clients.contains_key(&player) => events
                    .dispatch(
                        Event::new(super::chat::CHAT_EVENT)
                            .payload(line(&from, &text))
                            .filter(ClientFilter::Direct(player))
                            .build(),
                    ),
                Action::Broadcast { text, from } => events.dispatch(
                    Event::new(super::chat::CHAT_EVENT)
                        .payload(line(&from, &text))
                        .filter(ClientFilter::All)
                        .build(),
                ),
                Action::Give {
                    player,
                    item,
                    count,
                } => {
                    let content = g.rules.content_arc();
                    let Some(def) = content.item(&item) else {
                        log::warn!("plugin gift of unknown item {item:?}");
                        continue;
                    };
                    let Some(state) = g.players.get_mut(&player) else {
                        continue;
                    };
                    let left = state.inventory.add(&content, def.id, count);
                    if left > 0 {
                        log::info!("plugin gift to {player}: {left} {item} did not fit");
                    }
                    let armor = super::rules::armor_points(&content, state);
                    events.dispatch(
                        Event::new(super::INVENTORY_EVENT)
                            .payload(json!({ "slots": state.inventory.slots, "selected": state.inventory.selected, "realm": state.realm, "armor": armor }))
                            .filter(ClientFilter::Direct(player))
                            .build(),
                    );
                }
                Action::Tell { .. } => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(key: &str, commands: &[&str]) -> Manifest {
        Manifest {
            key: key.into(),
            name: key.into(),
            version: "1".into(),
            description: String::new(),
            script: "main.rhai".into(),
            commands: commands.iter().map(|c| c.to_string()).collect(),
            enabled: true,
        }
    }

    fn with(source: &str, commands: &[&str]) -> Plugins {
        let mut p = Plugins::none();
        p.attach("main");
        let ast = p.compile(source).unwrap();
        p.add(manifest("test", commands), ast);
        p
    }

    #[test]
    fn hooks_run_and_their_actions_reach_every_dimension() {
        let mut p = with(
            r#"
            fn on_join(player) { tell(player.id, `Welcome, ${player.name}!`); }
            fn on_event(player, e) { if e.kind == "mine" { give(player.id, "stick", e.count); } }
            fn on_tick(s) { if s % 60 == 0 { broadcast("A minute passed"); } }
            "#,
            &[],
        );
        p.attach("main_sky");
        p.joined(player("pl_1", "Ann", "overworld"));
        p.event(player("pl_1", "Ann", "overworld"), "mine", "stone", 3);
        p.tick(59);
        p.tick(60);
        p.run_queued();
        let actions = p.take_actions("main");
        assert_eq!(
            actions,
            vec![
                Action::Tell {
                    player: "pl_1".into(),
                    text: "Welcome, Ann!".into(),
                    from: "test".into()
                },
                Action::Give {
                    player: "pl_1".into(),
                    item: "stick".into(),
                    count: 3
                },
                Action::Broadcast {
                    text: "A minute passed".into(),
                    from: "test".into()
                },
            ]
        );
        assert_eq!(
            p.take_actions("main_sky").len(),
            3,
            "each world gets its copy"
        );
        assert!(p.take_actions("main").is_empty(), "taken once");
    }

    #[test]
    fn chat_can_be_hidden_and_commands_answered() {
        let mut p = with(
            r#"
            fn on_chat(player, text) { !text.contains("spoiler") }
            fn on_command(player, name, args) { tell(player.id, `${name}:${args}`); }
            "#,
            &["roll"],
        );
        let ann = player("pl_1", "Ann", "overworld");
        assert!(p.chat(ann.clone(), "hello"));
        assert!(!p.chat(ann.clone(), "big spoiler here"));
        assert!(p.command(ann.clone(), "roll", "2d6"));
        assert!(!p.command(ann, "dance", ""), "not a plugin command");
        assert_eq!(
            p.take_actions("main"),
            vec![Action::Tell {
                player: "pl_1".into(),
                text: "roll:2d6".into(),
                from: "test".into()
            }]
        );
        assert_eq!(p.commands(), vec![("roll".to_owned(), "test".to_owned())]);
    }

    #[test]
    fn runaway_scripts_are_stopped_and_failing_plugins_switched_off() {
        let mut p = with("fn on_tick(s) { loop { } }", &[]);
        for s in 0..MAX_FAILURES as i64 {
            p.tick(s);
        }
        p.run_queued();
        assert!(
            p.list[0].disabled,
            "switched off after {MAX_FAILURES} failures"
        );
        assert!(Plugins::none().compile("eval(\"1\")").is_err(), "no eval");
    }

    #[test]
    fn stores_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!("plugins-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let source = r#"fn on_event(player, e) { let n = store_get(player.id); if n == () { n = 0; } store_set(player.id, n + e.count); }"#;
        let run = |count: u32| {
            let mut p = Plugins::none();
            p.store_dir = Some(dir.clone());
            p.attach("main");
            let ast = p.compile(source).unwrap();
            p.add(manifest("counter", &[]), ast);
            p.event(player("pl_1", "Ann", "overworld"), "mine", "stone", count);
            p.run_queued();
            p.save();
        };
        run(2);
        run(5);
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("counter.json")).unwrap())
                .unwrap();
        assert_eq!(saved["pl_1"], 7);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_shipped_plugins_load() {
        let dir = platform_content::default_pack_dir().join("plugins");
        let p = Plugins::load(&dir, None).unwrap();
        assert!(p.list.iter().any(|p| p.manifest.key == "welcome"));
        assert!(valid_command("stats") && !valid_command("help") && !valid_command("Bad"));
    }
}
