// A starting point for a server plugin. Copy this folder to
// <content pack>/plugins/<your key>/, rename the key in plugin.json and
// check it with `game-server --check <content pack>`. Delete the hooks you
// do not need; every one is optional. docs/MODDING.md has the full API.

fn on_join(player) {
    // player: #{ id, name, dimension }
    if player.dimension == "overworld" {
        tell(player.id, `Hello, ${player.name}!`);
    }
}

fn on_leave(player) {}

// Return false to hide a public chat line.
fn on_chat(player, text) {
    true
}

// Commands listed in plugin.json's "commands".
fn on_command(player, name, args) {
    let n = store_get("hellos");
    if n == () { n = 0; }
    store_set("hellos", n + 1);
    tell(player.id, `Hello #${n + 1}! You said: ${args}`);
}

// event: #{ kind, target, count } — kind is mine, place, craft, smelt,
// kill, eat or enter; target is the block, item, creature or dimension key.
fn on_event(player, event) {
    if event.kind == "kill" && event.target == "ember_warden" {
        broadcast(`${player.name} defeated the Ember Warden!`);
        give(player.id, "diamond", 1);
    }
}

// Once a second, with seconds since the server started.
fn on_tick(seconds) {}
