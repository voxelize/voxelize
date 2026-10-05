// The admin panel (/admin.html): players and moderation, the economy, the
// live server monitor and the audit log. Moderators see players, servers
// and the log, and suspend or mute; administrators also ban, manage roles,
// grant currency and see the economy. The API enforces all of it
// (docs/API.md, "Admin"); this page only hides what would be refused.

import "./style.css";

import { api, ApiError, type AdminPlayer, type AdminPlayerState, type User } from "./api";

export type Tab = "players" | "servers" | "economy" | "audit";

/** Tabs a user with these roles may open. */
export function tabsFor(roles: string[]): Tab[] {
  const admin = roles.includes("admin");
  if (!admin && !roles.includes("moderator")) return [];
  return admin ? ["players", "servers", "economy", "audit"] : ["players", "servers", "audit"];
}

/** "3 min ago", "2 h ago", "5 days ago", "never". */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 172800) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

/** A player's saved state in a world: "main · overworld at 10, 64, -3 · 18/20 health · 30 xp". */
export function stateLine(s: AdminPlayerState): string {
  const parts = [`${s.world} · ${s.dimension}`];
  if (s.position) parts[0] += ` at ${s.position.map((v) => Math.round(v)).join(", ")}`;
  if (s.health !== null) parts.push(`${Math.round(s.health * 10) / 10}/20 health`);
  parts.push(`${s.xp} xp`);
  return parts.join(" · ");
}

/** Item names by id, from the game's content pack (fetched once). */
let itemNames: Promise<Map<number, string>> | null = null;
const names = () =>
  (itemNames ??= fetch("/platform/content")
    .then((r) => r.json())
    .then((c: { items: { id: number; name: string }[] }) => new Map(c.items.map((i) => [i.id, i.name])))
    .catch(() => new Map()));

/** A player's state in a few words: "online in main · muted · suspended". */
export function playerLine(p: AdminPlayer, now = Date.now()): string {
  const parts = [p.online ? `online${p.world ? ` in ${p.world}` : ""}` : `seen ${ago(p.last_seen_at, now)}`];
  if (p.muted_until && Date.parse(p.muted_until) > now) parts.push("muted");
  if (p.status !== "active") parts.push(p.status);
  const staff = p.roles.filter((r) => r !== "player");
  if (staff.length) parts.push(staff.join(", "));
  return parts.join(" · ");
}

const root = typeof document === "undefined" ? null : document.getElementById("admin");
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const button = (text: string, onClick: () => void, className = "") => h("button", { type: "button", textContent: text, className, onclick: onClick });
const say = (e: unknown) => (e instanceof ApiError ? `${e.message} (${e.code})` : "The server cannot be reached");

async function signIn(): Promise<User> {
  if (api.hasSession()) {
    try {
      return await api.me();
    } catch {
      api.forget();
    }
  }
  return new Promise((resolve) => {
    const error = h("p", { className: "admin-error" });
    const login = h("input", { name: "login", placeholder: "Username or email", required: true });
    const password = h("input", { name: "password", type: "password", placeholder: "Password", required: true });
    const form = h("form", { className: "admin-login" }, h("h1", { textContent: "Admin" }), login, password, h("button", { type: "submit", textContent: "Sign in" }), error);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        resolve(await api.login(login.value.trim(), password.value));
      } catch (e) {
        error.textContent = say(e);
      }
    });
    root?.replaceChildren(form);
  });
}

async function start() {
  if (!root) return;
  const me = await signIn();
  const roles = me.roles ?? ["player"];
  const tabs = tabsFor(roles);
  if (!tabs.length) {
    root.replaceChildren(h("h1", { textContent: "Admin" }), h("p", { textContent: "This account has no moderator or administrator role." }));
    return;
  }
  const isAdmin = roles.includes("admin");
  const status = h("p", { className: "admin-error" });
  const body = h("div", { className: "admin-body" });
  let timer: number | undefined;
  const nav = h("nav", { className: "admin-tabs" });
  const open = (tab: Tab) => {
    window.clearInterval(timer);
    status.textContent = "";
    nav.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    void views[tab]();
  };
  for (const tab of tabs) {
    const b = button(tab[0].toUpperCase() + tab.slice(1), () => open(tab));
    b.dataset.tab = tab;
    nav.append(b);
  }
  root.replaceChildren(h("header", {}, h("h1", { textContent: "Admin" }), h("span", { textContent: `${me.username} · ${roles.filter((r) => r !== "player").join(", ")}` }), button("Sign out", () => (api.forget(), location.reload()), "link")), nav, status, body);

  const run = async (action: () => Promise<unknown>, after: () => void) => {
    try {
      await action();
      status.textContent = "";
    } catch (e) {
      status.textContent = say(e);
    }
    after();
  };
  const reasonFor = (what: string) => {
    const r = prompt(`Reason to ${what}:`)?.trim();
    return r && r.length >= 3 ? r : null;
  };

  const showPlayer = async (id: string) => {
    let detail;
    try {
      detail = await api.admin.player(id);
    } catch (e) {
      status.textContent = say(e);
      return;
    }
    const p = detail.player;
    const itemNamesById = await names();
    const itemName = (id: number) => itemNamesById.get(id) ?? `#${id}`;
    const again = () => void showPlayer(id);
    const actions = h("div", { className: "admin-actions" });
    if (p.status === "active") {
      actions.append(button("Suspend", () => { const r = reasonFor(`suspend ${p.username}`); if (r) void run(() => api.admin.status(p.id, "suspended", r), again); }));
      if (isAdmin) actions.append(button("Ban", () => { const r = reasonFor(`ban ${p.username}`); if (r) void run(() => api.admin.status(p.id, "banned", r), again); }, "danger"));
    } else {
      actions.append(button("Reinstate", () => { const r = reasonFor(`reinstate ${p.username}`); if (r) void run(() => api.admin.status(p.id, "active", r), again); }));
    }
    const minutes = h("select", {}, ...[15, 60, 1440, 10080].map((m) => h("option", { value: String(m), textContent: m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : `${m / 1440} days` })));
    actions.append(minutes, button("Mute", () => { const r = reasonFor(`mute ${p.username}`); if (r) void run(() => api.admin.mute(p.id, Number(minutes.value), r), again); }));
    if (p.muted_until) actions.append(button("Unmute", () => { const r = reasonFor(`unmute ${p.username}`); if (r) void run(() => api.admin.mute(p.id, 0, r), again); }));
    const admin = h("div", { className: "admin-actions" });
    if (isAdmin) {
      const boxes = ["moderator", "admin"].map((role) => {
        const box = h("input", { type: "checkbox", checked: p.roles.includes(role) });
        box.dataset.role = role;
        return box;
      });
      admin.append(
        ...boxes.map((b) => h("label", {}, b, ` ${b.dataset.role}`)),
        button("Save roles", () => { const r = reasonFor("change roles"); if (r) void run(() => api.admin.roles(p.id, boxes.filter((b) => b.checked).map((b) => b.dataset.role!), r), again); }),
      );
      const amount = h("input", { type: "number", min: "1", value: "100", className: "admin-amount" });
      admin.append(amount, button("Grant Crowns", () => { const r = reasonFor(`grant ${amount.value} Crowns`); if (r) void run(() => api.admin.grant(p.id, "CRN", Number(amount.value), r), again); }));
    }
    body.replaceChildren(
      button("← Players", () => void views.players(), "link"),
      h("h2", { textContent: p.username }),
      h("p", { textContent: `${playerLine(p)} · ${p.email} · joined ${ago(p.created_at)} · ${p.tickets_today} ticket(s) today` }),
      ...(p.status_reason ? [h("p", { textContent: `${p.status}: ${p.status_reason}` })] : []),
      ...(p.mute_reason ? [h("p", { textContent: `muted until ${new Date(p.muted_until!).toLocaleString()}: ${p.mute_reason}` })] : []),
      h("p", { textContent: `Wallets: ${p.wallets.map((w) => `${w.balance} ${w.currency}`).join(", ") || "none"}` }),
      ...p.states.map((st) =>
        h(
          "p",
          { className: "admin-stats" },
          `${stateLine(st)} · carrying ${st.items.map((i) => `${i.count} × ${itemName(i.item)}`).join(", ") || "nothing"}`,
        ),
      ),
      actions,
      admin,
      h("h3", { textContent: "History" }),
      h("ul", { className: "admin-list" }, ...detail.audit.map((a) => h("li", { textContent: `${ago(a.created_at)} · ${a.action}${a.reason ? ` — ${a.reason}` : ""}` }))),
    );
  };

  const views: Record<Tab, () => Promise<void>> = {
    players: async () => {
      const q = h("input", { placeholder: "Name, email or id" });
      const filter = h("select", {}, ...["", "active", "suspended", "banned", "muted"].map((v) => h("option", { value: v, textContent: v || "everyone" })));
      const list = h("ul", { className: "admin-list" });
      const load = async () => {
        try {
          const players = await api.admin.players(q.value.trim(), filter.value);
          list.replaceChildren(...players.map((p) => h("li", {}, button(p.username, () => void showPlayer(p.id), "link"), ` ${playerLine(p)}`)));
          if (!players.length) list.append(h("li", { textContent: "Nobody matches." }));
        } catch (e) {
          status.textContent = say(e);
        }
      };
      const form = h("form", { className: "admin-actions" }, q, filter, h("button", { type: "submit", textContent: "Search" }));
      form.addEventListener("submit", (e) => (e.preventDefault(), void load()));
      body.replaceChildren(form, list);
      await load();
    },
    servers: async () => {
      const load = async () => {
        try {
          const s = await api.admin.servers();
          body.replaceChildren(
            h("p", { className: "admin-stats", textContent: `${s.online_players} online · ${s.tickets_last_hour} joins in the last hour · ${s.accounts} accounts` }),
            h(
              "table",
              { className: "admin-table" },
              h("tr", {}, ...["World", "Dimension", "Players", "Last report", ""].map((t) => h("th", { textContent: t }))),
              ...s.worlds.map((w) => h("tr", { className: w.online ? "" : "offline" }, ...[w.world, w.dimension, String(w.players), ago(w.seen_at), w.online ? "online" : "offline"].map((t) => h("td", { textContent: t })))),
            ),
          );
        } catch (e) {
          status.textContent = say(e);
        }
      };
      await load();
      timer = window.setInterval(() => void load(), 10000);
    },
    economy: async () => {
      try {
        const e = await api.admin.economy();
        body.replaceChildren(
          h("p", { className: e.problems.length ? "admin-error" : "admin-stats", textContent: e.problems.length ? `Ledger problems: ${e.problems.join("; ")}` : "The ledger balances." }),
          h(
            "table",
            { className: "admin-table" },
            h("tr", {}, ...["Currency", "In wallets", "Escrow", "Guild treasuries", "Minted", "Burned"].map((t) => h("th", { textContent: t }))),
            ...e.currencies.map((c) => h("tr", {}, ...[c.currency, c.wallets, c.escrow, c.guilds, c.minted, c.burned].map((t) => h("td", { textContent: String(t) })))),
          ),
          h("h3", { textContent: "Latest transactions" }),
          h("ul", { className: "admin-list" }, ...e.recent.map((t) => h("li", { textContent: `${ago(t.created_at)} · ${t.type} · ${t.reason}` }))),
        );
      } catch (err) {
        status.textContent = say(err);
      }
    },
    audit: async () => {
      try {
        const { entries } = await api.admin.audit();
        body.replaceChildren(h("ul", { className: "admin-list" }, ...entries.map((a) => h("li", { textContent: `${ago(a.created_at)} · ${a.action}${a.subject_id ? ` · ${a.subject_id}` : ""}${a.reason ? ` — ${a.reason}` : ""}` }))));
      } catch (e) {
        status.textContent = say(e);
      }
    },
  };
  open(tabs[0]);
}

if (root) void start();
