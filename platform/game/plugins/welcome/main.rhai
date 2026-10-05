// Welcome: greets players and keeps a few counts for /stats.
// Store keys: "<player id>:<count>" -> number.

fn count(id, what) {
    let n = store_get(`${id}:${what}`);
    if n == () { 0 } else { n }
}

fn add(id, what, by) {
    store_set(`${id}:${what}`, count(id, what) + by);
}

fn on_join(player) {
    if player.dimension != "overworld" { return; }
    let visits = count(player.id, "visits");
    add(player.id, "visits", 1);
    if visits == 0 {
        tell(player.id, `Welcome, ${player.name}! Punch a tree to start. Type /help for chat commands.`);
    } else {
        tell(player.id, `Welcome back, ${player.name} (visit ${visits + 1}).`);
    }
}

fn on_event(player, event) {
    if event.kind == "mine" || event.kind == "craft" || event.kind == "kill" {
        add(player.id, event.kind, event.count);
    }
}

fn on_command(player, name, args) {
    let id = player.id;
    tell(id, `${player.name}: ${count(id, "mine")} blocks mined, ${count(id, "craft")} items crafted, ${count(id, "kill")} creatures defeated, ${count(id, "visits")} visits.`);
}
