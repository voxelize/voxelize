// Friends (O): ask players by name, accept or decline requests, see who is
// online and where, whisper them. Everything goes to the API; game servers
// report who is playing every half minute.

import { api, ApiError, type FriendLists, type FriendView } from "./api";

/** Seconds between refreshes while playing (online notices). */
export const FRIENDS_POLL_SECONDS = 30;

/** "online in main" or "seen 5 min ago". */
export function friendLine(f: FriendView, now = Date.now()): string {
  if (f.online) return f.world ? `online in ${f.world}` : "online";
  if (!f.last_seen_at) return "not seen yet";
  const minutes = Math.max(0, Math.floor((now - Date.parse(f.last_seen_at)) / 60000));
  if (minutes < 1) return "seen just now";
  if (minutes < 60) return `seen ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `seen ${hours} h ago`;
  return `seen ${Math.floor(hours / 24)} days ago`;
}

/** Notices worth a toast between two refreshes: friends who came online, new requests, accepted ones. */
export function friendNotices(before: FriendLists | null, after: FriendLists): string[] {
  if (!before) return after.incoming.length ? [`${after.incoming.length} friend request(s) waiting (O)`] : [];
  const out: string[] = [];
  const was = new Map(before.friends.map((f) => [f.player, f]));
  for (const f of after.friends) {
    const old = was.get(f.player);
    if (!old) out.push(`${f.username} is now your friend`);
    else if (f.online && !old.online) out.push(`${f.username} is online`);
  }
  const asked = new Set(before.incoming.map((c) => c.player));
  for (const c of after.incoming) if (!asked.has(c.player)) out.push(`${c.username} wants to be friends (O)`);
  return out;
}

const FRIEND_ERRORS: Record<string, string> = {
  self: "That is you",
  player_not_found: "No player by that name",
  already_friends: "You are friends already",
  too_many_friends: "The friend list is full",
  too_many_requests: "Too many requests waiting",
  no_request: "No request from that player",
};

export class FriendsPanel {
  readonly root: HTMLElement;
  lists: FriendLists | null = null;
  private timer: number | undefined;

  constructor(private readonly actions: { notify: (text: string) => void; whisper: (name: string) => void }) {
    this.root = document.createElement("section");
    this.root.id = "friends";
    this.root.className = "panel";
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (this.isOpen) {
      this.render();
      void this.refresh();
    }
  }

  /** Refresh now and every [`FRIENDS_POLL_SECONDS`], toasting what changed. */
  start() {
    void this.refresh();
    this.timer ??= window.setInterval(() => void this.refresh(), FRIENDS_POLL_SECONDS * 1000);
  }

  /** `quiet` after the player's own action: its result was already said. */
  async refresh(quiet = false) {
    try {
      const next = await api.friends.list();
      if (!quiet) for (const line of friendNotices(this.lists, next)) this.actions.notify(line);
      this.lists = next;
      if (this.isOpen) this.render();
    } catch {
      // Offline backend: keep what we had.
    }
  }

  private async act(run: () => Promise<unknown>, done?: string) {
    try {
      await run();
      if (done) this.actions.notify(done);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      this.actions.notify(FRIEND_ERRORS[code] ?? "Could not reach the server");
    }
    await this.refresh(true);
  }

  private render() {
    const h = (tag: string, text: string) => Object.assign(document.createElement(tag), { textContent: text });
    const button = (text: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.addEventListener("click", onClick);
      return b;
    };
    const l = this.lists;
    const nodes: Node[] = [h("h2", `Friends${l ? ` · ${l.friends.length}/${l.limit}` : ""}`)];

    const form = document.createElement("form");
    const input = Object.assign(document.createElement("input"), { placeholder: "Player name", maxLength: 24, required: true });
    form.append(input, button("Add friend", () => form.requestSubmit()));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      void this.act(async () => {
        const r = await api.friends.add(name);
        this.actions.notify(r.status === "accepted" ? `You and ${name} are friends` : `Asked ${name} to be friends`);
      });
    });
    nodes.push(form);

    if (l?.incoming.length) {
      nodes.push(h("h3", "Requests"));
      for (const c of l.incoming) {
        const row = h("div", `${c.username} `);
        row.className = "friend-row";
        row.append(
          button("Accept", () => void this.act(() => api.friends.accept(c.username), `You and ${c.username} are friends`)),
          button("Decline", () => void this.act(() => api.friends.remove(c.username))),
        );
        nodes.push(row);
      }
    }

    const list = document.createElement("ul");
    list.className = "friend-list";
    for (const f of l?.friends ?? []) {
      const li = document.createElement("li");
      li.className = f.online ? "online" : "";
      li.append(h("strong", f.username), ` — ${friendLine(f)} `);
      if (f.online) li.append(button("Whisper", () => this.actions.whisper(f.username)));
      li.append(button("Remove", () => void this.act(() => api.friends.remove(f.username), `${f.username} is no longer your friend`)));
      list.append(li);
    }
    if (l && !l.friends.length) list.append(h("li", "No friends yet: add someone by name."));
    nodes.push(list);

    if (l?.outgoing.length) {
      nodes.push(h("h3", "Asked"));
      for (const c of l.outgoing) {
        const row = h("div", `${c.username} `);
        row.className = "friend-row";
        row.append(button("Withdraw", () => void this.act(() => api.friends.remove(c.username))));
        nodes.push(row);
      }
    }
    nodes.push(button("Done", () => (this.root.hidden = true)));
    this.root.replaceChildren(...nodes);
  }
}
