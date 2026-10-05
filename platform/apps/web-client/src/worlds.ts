// The world browser, after signing in: official worlds, public ones, and
// those open to the player (their own, friends', ones they were added to),
// with who is playing. Players create worlds here and choose who may join.
// Each world runs on its own game server; official worlds are reached
// through this site, the others at the address the backend gives.

import { api, ApiError, type WorldView, type WorldVisibility } from "./api";

/** Session keys: the engine world this tab is in, and its game server. */
export const WORLD_KEY = "platform.world";
export const SERVER_KEY = "platform.server";

/** "main_underworld" → "main": the world a dimension belongs to. */
export function baseWorld(engineWorld: string): string {
  return engineWorld.replace(/_(underworld|sky)$/, "");
}

/** The http(s) origin of a game server from its WebSocket address. */
export function serverOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (!["ws:", "wss:", "http:", "https:"].includes(u.protocol)) return null;
    return `${u.protocol.replace(/^ws/, "http")}//${u.host}`;
  } catch {
    return null;
  }
}

/** A world's line in the browser: "Castle Hill · by ana · 3/20 playing · creative · friends". */
export function worldLine(w: WorldView): string {
  const parts = [w.name];
  if (w.owner) parts.push(`by ${w.owner.name}`);
  parts.push(w.online ? `${w.players ?? 0}${w.max_players ? `/${w.max_players}` : ""} playing` : "offline");
  if (w.realm === "creative") parts.push("creative");
  if (!w.official && w.visibility !== "public") parts.push(w.visibility === "friends" ? "friends" : "private");
  return parts.join(" · ");
}

const ERRORS: Record<string, string> = {
  bad_name: "A world name is 3-32 letters, digits, spaces, _, ' or -",
  too_many_worlds: "You have as many worlds as you may",
  player_not_found: "No player by that name",
  self: "You own it already",
  world_closed: "That world is not open to you",
  world_full: "That world is full",
  world_offline: "No server hosts that world yet",
};

export const errorText = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : "Could not reach the server");

/** Show the browser until a world is chosen; resolves with it. */
export function chooseWorld(): Promise<WorldView> {
  return new Promise((resolve) => {
    const root = document.createElement("section");
    root.id = "worlds";
    root.className = "panel";
    document.body.append(root);
    const h = (tag: string, text: string) => Object.assign(document.createElement(tag), { textContent: text });
    const button = (text: string, onClick: () => void, cls = "") => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: text, className: cls });
      b.addEventListener("click", onClick);
      return b;
    };
    const status = h("p", "");
    status.className = "worlds-status";
    let worlds: WorldView[] = [];
    let perPlayer = 0;

    const pick = async (w: WorldView) => {
      // Ask for a ticket first: it says at once whether we may get in.
      try {
        const t = await api.ticket(w.key);
        if (!w.official && !serverOrigin(t.url)) throw new Error("bad url");
        root.remove();
        resolve({ ...w, url: t.url });
      } catch (e) {
        status.textContent = errorText(e);
      }
    };
    const act = async (run: () => Promise<unknown>) => {
      try {
        await run();
        status.textContent = "";
      } catch (e) {
        status.textContent = errorText(e);
      }
      await load();
    };

    const manage = (w: WorldView) => {
      const box = document.createElement("div");
      box.className = "world-manage";
      const vis = document.createElement("select");
      for (const v of ["public", "friends", "private"] as WorldVisibility[]) vis.append(new Option(v, v, false, v === w.visibility));
      vis.addEventListener("change", () => void act(() => api.worlds.update(w.key, { visibility: vis.value as WorldVisibility })));
      const member = Object.assign(document.createElement("input"), { placeholder: "Add a member", maxLength: 24 });
      box.append(
        vis,
        member,
        button("Add", () => member.value.trim() && void act(() => api.worlds.addMember(w.key, member.value.trim()))),
        button("Archive", () => confirm(`Archive ${w.name}? Nobody can join it again.`) && void act(() => api.worlds.archive(w.key)), "link"),
      );
      for (const m of w.members ?? []) box.append(button(`${m} ✕`, () => void act(() => api.worlds.removeMember(w.key, m)), "link"));
      return box;
    };

    const render = () => {
      const list = document.createElement("ul");
      list.className = "world-list";
      for (const w of worlds) {
        const li = document.createElement("li");
        li.className = w.online ? "online" : "";
        li.append(h("span", worldLine(w)), button("Play", () => void pick(w)));
        if (w.mine) li.append(manage(w));
        list.append(li);
      }
      const form = document.createElement("form");
      form.className = "world-create";
      const name = Object.assign(document.createElement("input"), { placeholder: "New world name", maxLength: 32, required: true });
      const vis = document.createElement("select");
      for (const v of ["private", "friends", "public"]) vis.append(new Option(v, v));
      const realm = document.createElement("select");
      for (const r of ["survival", "creative"]) realm.append(new Option(r, r));
      form.append(name, vis, realm, Object.assign(document.createElement("button"), { type: "submit", textContent: "Create" }));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void act(() => api.worlds.create(name.value.trim(), vis.value as WorldVisibility, realm.value as "survival" | "creative"));
      });
      const mine = worlds.filter((w) => w.mine).length;
      root.replaceChildren(h("h2", "Worlds"), list, h("h3", `Your worlds (${mine}/${perPlayer})`), form, status, button("Refresh", () => void load(), "link"), button("Sign out", () => void api.logout().then(() => location.reload()), "link"));
    };

    const load = async () => {
      try {
        const r = await api.worlds.list();
        worlds = r.worlds;
        perPlayer = r.per_player;
      } catch (e) {
        status.textContent = errorText(e);
      }
      render();
    };
    void load();
  });
}
