//! Chat channels. Plain lines are public in the world (the engine logs and
//! broadcasts them); the game stamps the speaker's real name on them, caps
//! their length and rate, and drops muted players' lines. Commands open the
//! other channels:
//!
//! | command | channel |
//! | --- | --- |
//! | `/w <name> <text>` (`/msg`, `/tell`) | whisper to one player |
//! | `/r <text>` | reply to the last whisper |
//! | `/l <text>` (`/local`) | players within [`LOCAL_RANGE`] blocks |
//! | `/g <text>` (`/guild`) | online members of your guild |
//! | `/help` | the list |
//!
//! Channel lines reach clients as [`CHAT_EVENT`] events.

use std::collections::HashMap;
use std::time::Instant;

use serde_json::json;
use specs::WorldExt;
use voxelize::{ClientFilter, Clients, Event, PositionComp, World};

use super::Gameplay;

/// `{ "channel": "whisper" | "local" | "guild" | "system", "from": { "id", "name" } | null, "to": name | null, "body" }`.
pub const CHAT_EVENT: &str = "platform.chat";
/// How far local chat carries, in blocks.
pub const LOCAL_RANGE: f32 = 48.0;
/// Longest line, in characters.
pub const MAX_LINE: usize = 256;
/// Lines a player may send per [`RATE_WINDOW`] seconds.
pub const RATE_LINES: u32 = 6;
pub const RATE_WINDOW: f32 = 8.0;

/// Per-player chat state: rate window and whom to reply to.
#[derive(Debug, Default)]
pub struct ChatState {
    windows: HashMap<String, (Instant, u32)>,
    pub reply_to: HashMap<String, String>,
}

impl ChatState {
    /// Whether `player` may speak now (and count the line).
    pub fn allow(&mut self, player: &str, now: Instant) -> bool {
        let entry = self.windows.entry(player.to_owned()).or_insert((now, 0));
        if now.duration_since(entry.0).as_secs_f32() > RATE_WINDOW {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= RATE_LINES
    }
}

/// A line cut to [`MAX_LINE`] characters with control characters removed;
/// `None` when nothing is left.
pub fn clean(body: &str) -> Option<String> {
    let line: String = body
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_LINE)
        .collect();
    let line = line.trim().to_owned();
    (!line.is_empty()).then_some(line)
}

/// A command line split into its name and the rest.
pub fn split_command(line: &str) -> (String, String) {
    let line = line.trim();
    match line.split_once(char::is_whitespace) {
        Some((name, rest)) => (name.to_lowercase(), rest.trim().to_owned()),
        None => (line.to_lowercase(), String::new()),
    }
}

fn name_of(world: &World, id: &str) -> String {
    world
        .read_resource::<Clients>()
        .get(id)
        .map(|c| c.username.clone())
        .unwrap_or_else(|| id.to_owned())
}

fn id_by_name(world: &World, name: &str) -> Option<String> {
    world
        .read_resource::<Clients>()
        .values()
        .find(|c| c.username.eq_ignore_ascii_case(name))
        .map(|c| c.id.clone())
}

fn system(world: &mut World, to: &str, body: &str) {
    world.events_mut().dispatch(
        Event::new(CHAT_EVENT)
            .payload(json!({ "channel": "system", "from": null, "to": null, "body": body }))
            .filter(ClientFilter::Direct(to.to_owned()))
            .build(),
    );
}

fn deliver(
    world: &mut World,
    to: Vec<String>,
    channel: &str,
    from: &str,
    target: Option<&str>,
    body: &str,
) {
    let name = name_of(world, from);
    world.events_mut().dispatch(
        Event::new(CHAT_EVENT)
            .payload(json!({ "channel": channel, "from": { "id": from, "name": name }, "to": target, "body": body }))
            .filter(ClientFilter::Include(to))
            .build(),
    );
}

/// Rate and mute check shared by every channel.
fn may_speak(world: &mut World, id: &str) -> bool {
    let now = super::sanctions::now();
    let muted = {
        let g = world.ecs().read_resource::<Gameplay>();
        let s = g.dimensions.sanctions.clone();
        drop(g);
        let line = s.read().ok().and_then(|s| {
            s.muted(id, now)
                .map(|(until, reason)| super::sanctions::muted_line(until, reason, now))
        });
        line
    };
    if let Some(line) = muted {
        system(world, id, &line);
        return false;
    }
    let allowed = {
        let mut g = world.ecs().write_resource::<Gameplay>();
        g.chat.allow(id, Instant::now())
    };
    if !allowed {
        system(world, id, "You are sending messages too fast.");
    }
    allowed
}

fn whisper(world: &mut World, id: &str, to_name: &str, body: &str) {
    let Some(to) = id_by_name(world, to_name) else {
        return system(world, id, &format!("{to_name} is not here."));
    };
    if to == id {
        return system(world, id, "Whispering to yourself?");
    }
    {
        let mut g = world.ecs().write_resource::<Gameplay>();
        g.chat.reply_to.insert(to.clone(), id.to_owned());
        g.chat.reply_to.insert(id.to_owned(), to.clone());
    }
    let target = name_of(world, &to);
    deliver(
        world,
        vec![to, id.to_owned()],
        "whisper",
        id,
        Some(&target),
        body,
    );
}

pub(super) fn install(world: &mut World) {
    world.set_chat_guard(|world, id, chat| {
        // Public chat: under the speaker's real name, short, not flooding.
        let Some(line) = clean(&chat.body) else {
            return false;
        };
        if !may_speak(world, id) {
            return false;
        }
        let name = name_of(world, id);
        // A plugin may hide a line (on_chat returning false).
        let shown = {
            let g = world.ecs().read_resource::<Gameplay>();
            let player = super::plugins::player(id, &name, g.dimensions.current.key());
            let plugins = g.dimensions.plugins.clone();
            drop(g);
            plugins
                .lock()
                .map(|mut p| p.chat(player, &line))
                .unwrap_or(true)
        };
        if !shown {
            return false;
        }
        chat.body = line;
        chat.sender = name;
        crate::metrics::inc("platform_chat_lines_total", &[("channel", "public")]);
        true
    });

    world.set_command_handle(|world, id, command| {
        let (name, rest) = split_command(command);
        // Plugin commands (manifest `commands`).
        let answered = {
            let player_name = name_of(world, id);
            let g = world.ecs().read_resource::<Gameplay>();
            let player = super::plugins::player(id, &player_name, g.dimensions.current.key());
            let plugins = g.dimensions.plugins.clone();
            drop(g);
            plugins.lock().map(|mut p| p.command(player, &name, &rest)).unwrap_or(false)
        };
        if answered {
            return;
        }
        if !matches!(name.as_str(), "w" | "msg" | "tell" | "r" | "l" | "local" | "g" | "guild" | "help") {
            return system(world, id, &format!("Unknown command /{name} (try /help)."));
        }
        let Some(body) = clean(&rest).or_else(|| (name == "help").then(String::new)) else {
            return system(world, id, "Say something after the command (try /help).");
        };
        if name != "help" && !may_speak(world, id) {
            return;
        }
        match name.as_str() {
            "w" | "msg" | "tell" => match body.split_once(char::is_whitespace) {
                Some((to, text)) => whisper(world, id, to, text.trim()),
                None => system(world, id, "Use /w <name> <message>."),
            },
            "r" => {
                let last = world
                    .ecs()
                    .read_resource::<Gameplay>()
                    .chat
                    .reply_to
                    .get(id)
                    .cloned();
                match last {
                    Some(to) => {
                        let to_name = name_of(world, &to);
                        whisper(world, id, &to_name, &body)
                    }
                    None => system(world, id, "Nobody to reply to."),
                }
            }
            "l" | "local" => {
                let near: Vec<String> = {
                    let clients = world.read_resource::<Clients>();
                    let positions = world.read_component::<PositionComp>();
                    let me = clients.get(id).and_then(|c| positions.get(c.entity)).map(|p| p.0.clone());
                    match me {
                        None => Vec::new(),
                        Some(me) => clients
                            .values()
                            .filter(|c| {
                                positions.get(c.entity).is_some_and(|p| {
                                    let d = [p.0 .0 - me.0, p.0 .1 - me.1, p.0 .2 - me.2];
                                    (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt() <= LOCAL_RANGE
                                })
                            })
                            .map(|c| c.id.clone())
                            .collect(),
                    }
                };
                deliver(world, near, "local", id, None, &body);
            }
            "g" | "guild" => {
                let members = {
                    let g = world.ecs().read_resource::<Gameplay>();
                    g.dimensions
                        .guilds
                        .read()
                        .ok()
                        .and_then(|index| index.guild_of(id).map(|guild| (guild.tag.clone(), guild.members.clone())))
                };
                match members {
                    None => system(world, id, "You are in no guild."),
                    Some((tag, members)) => {
                        let online: Vec<String> = {
                            let clients = world.read_resource::<Clients>();
                            members.into_iter().filter(|m| clients.contains_key(m)).collect()
                        };
                        deliver(world, online, "guild", id, Some(&tag), &body);
                    }
                }
            }
            "help" => {
                let extra: Vec<String> = {
                    let g = world.ecs().read_resource::<Gameplay>();
                    let plugins = g.dimensions.plugins.clone();
                    drop(g);
                    let list = plugins.lock().map(|p| p.commands()).unwrap_or_default();
                    list.into_iter().map(|(c, from)| format!("/{c} ({from})")).collect()
                };
                let mut text = "/w <name> <text> whispers, /r <text> replies, /l <text> talks to players nearby, /g <text> to your guild; plain lines go to everyone.".to_owned();
                if !extra.is_empty() {
                    text.push_str(&format!(" Also: {}.", extra.join(", ")));
                }
                system(world, id, &text)
            }
            other => system(world, id, &format!("Unknown command /{other} (try /help).")),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_cleaned_and_commands_split() {
        assert_eq!(clean("  hi\u{7}  there "), Some("hi  there".into()));
        assert_eq!(clean(" \n\t "), None);
        assert_eq!(clean(&"x".repeat(1000)).map(|l| l.len()), Some(MAX_LINE));
        assert_eq!(
            split_command("W  Alice  hello there"),
            ("w".into(), "Alice  hello there".into())
        );
        assert_eq!(split_command("help"), ("help".into(), String::new()));
    }

    #[test]
    fn chat_is_rate_limited_per_player() {
        let mut state = ChatState::default();
        let t0 = Instant::now();
        for _ in 0..RATE_LINES {
            assert!(state.allow("a", t0));
        }
        assert!(!state.allow("a", t0), "too fast");
        assert!(state.allow("b", t0), "others are not affected");
        let later = t0 + std::time::Duration::from_secs_f32(RATE_WINDOW + 0.5);
        assert!(state.allow("a", later), "the window passes");
    }
}
