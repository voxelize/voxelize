// Guild panel (G): found or join a guild, run its roster and treasury.
// Everything goes to the API; guild land shows up in the land panel and is
// enforced by the game server like any other land.

import {
  api,
  ApiError,
  GUILD_PERMISSIONS,
  idempotencyKey,
  type GuildMessage,
  type GuildPermission,
  type GuildRelation,
  type GuildRole,
  type GuildView,
  type Settlement,
} from "./api";
import type { LandHere } from "./land";
import { entryLine } from "./market";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

/**
 * What a member may do to another: the leader appoints and removes anyone;
 * officers, and members whose rank allows it, remove members only.
 */
export function guildActions(
  mine: GuildRole | null,
  theirs: GuildRole,
  self: boolean,
  canKick = mine === "leader" || mine === "officer",
): ("promote" | "demote" | "lead" | "kick")[] {
  if (self || theirs === "leader" || !mine) return [];
  if (mine === "leader") return theirs === "member" ? ["promote", "lead", "kick"] : ["demote", "lead", "kick"];
  return canKick && theirs === "member" ? ["kick"] : [];
}

/** A rank's permissions in words. */
export const PERMISSION_NAMES: Record<GuildPermission, string> = {
  invite: "invite",
  kick: "remove members",
  treasury: "pay out",
  land: "claim and manage land",
  contracts: "post contracts",
};

/** A siege's state in a line. */
export function siegeLine(s: { progress: number; needed: number; contested: boolean }): string {
  const pct = Math.min(100, Math.floor((s.progress / s.needed) * 100));
  return `Siege ${pct}%${s.contested ? " · contested" : ""}`;
}

/** A guild tag as players type it: 2-5 letters or digits, upper case. */
export const normaliseTag = (tag: string) => tag.trim().toUpperCase();
export const validTag = (tag: string) => /^[A-Z0-9]{2,5}$/.test(normaliseTag(tag));

/** The toast shown when walking onto land (or into the wild). */
export function landNotice(land: LandHere | null | undefined): string {
  if (!land) return "Wilderness";
  const base = `${land.name || "Land"} — ${land.owner.name || "owned"}`;
  const tag = land.guild ? ` [${land.guild.tag}]` : "";
  if (land.settlement && land.settlement.level !== "none") return `The ${land.settlement.level} of ${land.settlement.name}${tag} · ${base}`;
  return base + tag;
}

/** One settlement in a line: "Town · 18 chunks · chunks 0,0 to 5,2 (overworld)". */
export function settlementLine(s: Settlement): string {
  const level = s.level === "none" ? "Outpost" : s.level[0].toUpperCase() + s.level.slice(1);
  return `${level} · ${s.chunks} chunk(s) · ${s.min.join(",")} to ${s.max.join(",")} (${s.dimension})`;
}

/** One relation in a line, from our side. */
export function relationLine(r: GuildRelation, now = Date.now()): string {
  const who = `[${r.with.tag}] ${r.with.name}`;
  if (r.kind === "alliance") return r.status === "active" ? `Allied with ${who}` : r.initiated ? `Alliance offered to ${who}` : `${who} offers an alliance`;
  const score = r.score ? ` · ${r.score.us}:${r.score.them}` : "";
  const starts = r.starts_at ? Date.parse(r.starts_at) : 0;
  const phase = r.fighting ? "at war" : starts > now ? `war in ${Math.ceil((starts - now) / 60_000)} min` : "war";
  const peace = r.peace_offered === "us" ? " · peace offered" : r.peace_offered === "them" ? " · they offer peace" : "";
  return `${phase} with ${who}${score}${peace}`;
}

/** A tax typed as a percentage, in basis points (0–20 %), or null. */
export function parseTax(raw: string): number | null {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(raw.trim())) return null;
  const bps = Math.round(Number(raw.trim()) * 100);
  return bps <= 2000 ? bps : null;
}

/** Messages newer than `after`, oldest first, without duplicates. */
export function newMessages(list: GuildMessage[], after: number): GuildMessage[] {
  return list.filter((m) => m.id > after).sort((a, b) => a.id - b.id);
}

export class GuildPanel {
  readonly root: HTMLElement;
  private busy = false;
  /** My guild, kept for the land panel's "claim for the guild". */
  guild: GuildView | null = null;

  private me = "";
  /** The guild chat seen so far (the latest 50 lines). */
  private chat: GuildMessage[] = [];
  private lastMessage = 0;
  private polling: number | null = null;
  /** The rank the leader is editing (its form is filled in), if any. */
  private editing: string | null = null;

  constructor(private readonly options: { notify: (text: string) => void }) {
    this.root = el("section", { id: "guild", className: "panel", hidden: true });
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (this.isOpen) void this.render();
  }

  async refresh() {
    this.guild = (await api.guilds.mine().catch(() => null))?.guild ?? null;
    return this.guild;
  }

  /** Poll the guild chat every few seconds; new lines from others are toasted while the panel is closed. */
  startChat(intervalMs = 4000) {
    if (this.polling !== null) return;
    const tick = async () => {
      if (!this.guild) return;
      const fresh = await api.guilds.messages(this.guild.id, this.lastMessage).catch(() => null);
      if (!fresh) return;
      const added = newMessages(fresh, this.lastMessage);
      if (!added.length) return;
      const first = this.lastMessage === 0;
      this.lastMessage = added[added.length - 1].id;
      this.chat = [...this.chat, ...added].slice(-50);
      if (this.isOpen) void this.render();
      else if (!first) for (const m of added) if (m.from.name !== this.me) this.options.notify(`[${this.guild.tag}] ${m.from.name}: ${m.body}`);
    };
    void tick();
    this.polling = window.setInterval(() => void tick(), intervalMs);
  }

  private async act(work: () => Promise<unknown>, done: string) {
    if (this.busy) return;
    this.busy = true;
    try {
      await work();
      this.options.notify(done);
    } catch (e) {
      this.options.notify(e instanceof ApiError ? e.message : "Could not reach the server");
    } finally {
      this.busy = false;
      void this.render();
    }
  }

  private async render() {
    const children: (Node | string)[] = [el("h2", { textContent: "Guild" })];
    if (!this.me) this.me = (await api.me().catch(() => null))?.username ?? "";
    const state = await api.guilds.mine().catch(() => null);
    if (state?.guild?.id !== this.guild?.id) {
      this.chat = [];
      this.lastMessage = 0;
    }
    this.guild = state?.guild ?? null;
    if (!state) children.push(el("p", { textContent: "Could not load your guild." }));
    else if (state.guild) children.push(...(await this.ownGuild(state.guild)));
    else {
      for (const inv of state.invites) {
        children.push(
          el(
            "p",
            { className: "guild-invite" },
            `[${inv.tag}] ${inv.name} (${inv.members} members) invites you `,
            el("button", { type: "button", onclick: () => this.act(() => api.guilds.join(inv.id), `Joined ${inv.name}`) }, "Join"),
            el("button", { type: "button", onclick: () => this.act(() => api.guilds.decline(inv.id), "Declined") }, "Decline"),
          ),
        );
      }
      const name = el("input", { type: "text", maxLength: 32, placeholder: "Guild name" });
      const tag = el("input", { type: "text", maxLength: 5, placeholder: "TAG" });
      const key = idempotencyKey();
      children.push(
        el("p", { textContent: state.invites.length ? "Or found your own:" : "You are not in a guild. Found one, or ask a guild officer to invite you." }),
        el("div", { className: "guild-found" }, name, tag,
          el("button", {
            type: "button",
            onclick: () => {
              if (!validTag(tag.value)) return this.options.notify("A tag is 2-5 letters or digits.");
              void this.act(() => api.guilds.create(key, name.value.trim(), normaliseTag(tag.value)), "Guild founded");
            },
          }, "Found (100 CRN)"),
        ),
      );
    }
    children.push(el("button", { type: "button", onclick: () => (this.root.hidden = true) }, "Done"));
    this.root.replaceChildren(...children);
  }

  private async ownGuild(g: GuildView): Promise<Node[]> {
    const me = this.me;
    const nodes: Node[] = [
      el("p", {}, el("strong", { textContent: `[${g.tag}] ${g.name}` }), ` · ${g.members}/${g.max_members} members · you are ${g.my_role}`),
      el("p", { className: "guild-treasury", textContent: `Treasury: ${g.treasury} ${g.currency}` }),
    ];
    const roster = el("ul", { className: "guild-roster" });
    for (const m of g.roster) {
      const li = el("li", {}, `${m.name} (${m.role}) `);
      if (m.rank) li.append(el("em", { textContent: `${m.rank.name} ` }));
      if (g.my_role === "leader" && m.role !== "leader" && g.ranks.length) {
        const pick = el("select", {}, el("option", { value: "", textContent: "no rank" }), ...g.ranks.map((r) => el("option", { value: r.id, textContent: r.name, selected: m.rank?.id === r.id })));
        pick.addEventListener("change", () => this.act(() => api.guilds.assignRank(g.id, m.name, pick.value || null), "Rank given"));
        li.append(pick);
      }
      for (const action of guildActions(g.my_role, m.role, m.name === me, g.my_permissions.includes("kick"))) {
        const [label, work, done] = {
          promote: ["Make officer", () => api.guilds.setRole(g.id, m.name, "officer"), `${m.name} is an officer`],
          demote: ["Make member", () => api.guilds.setRole(g.id, m.name, "member"), `${m.name} is a member`],
          lead: ["Hand over", () => api.guilds.setRole(g.id, m.name, "leader"), `${m.name} leads the guild`],
          kick: ["Remove", () => api.guilds.kick(g.id, m.name), `${m.name} removed`],
        }[action] as [string, () => Promise<unknown>, string];
        li.append(el("button", {
          type: "button",
          onclick: () => {
            if (action !== "lead" || confirm(`Hand the guild over to ${m.name}?`)) void this.act(work, done);
          },
        }, label));
      }
      roster.append(li);
    }
    nodes.push(el("h3", { textContent: "Members" }), roster);

    // Ranks: titles with permissions, given by the leader.
    if (g.ranks.length || g.my_role === "leader") {
      nodes.push(el("h3", { textContent: "Ranks" }));
      const list = el("ul", { className: "guild-roster" });
      for (const r of g.ranks) {
        const li = el("li", { textContent: `${r.name}: ${r.permissions.map((p) => PERMISSION_NAMES[p]).join(", ") || "no extra rights"} ` });
        if (g.my_role === "leader") {
          li.append(
            el("button", { type: "button", onclick: () => ((this.editing = r.id), void this.render()) }, "Edit"),
            el("button", { type: "button", onclick: () => this.act(() => api.guilds.deleteRank(g.id, r.id), "Rank removed") }, "Remove"),
          );
        }
        list.append(li);
      }
      nodes.push(list);
      if (g.my_role === "leader") {
        const editing = g.ranks.find((r) => r.id === this.editing) ?? null;
        const name = el("input", { type: "text", maxLength: 24, placeholder: "Rank name", value: editing?.name ?? "" });
        const boxes = GUILD_PERMISSIONS.map((p) => [p, el("input", { type: "checkbox", checked: editing?.permissions.includes(p) ?? false })] as const);
        const chosen = () => boxes.filter(([, b]) => b.checked).map(([p]) => p);
        nodes.push(
          el("div", { className: "guild-found" }, name, ...boxes.map(([p, box]) => el("label", {}, box, ` ${PERMISSION_NAMES[p]}`))),
          editing
            ? el("div", { className: "guild-add" },
                el("button", {
                  type: "button",
                  onclick: () => {
                    this.editing = null;
                    void this.act(() => api.guilds.updateRank(g.id, editing.id, { name: name.value.trim(), permissions: chosen() }), "Rank saved");
                  },
                }, `Save ${editing.name}`),
                el("button", { type: "button", onclick: () => ((this.editing = null), void this.render()) }, "Cancel"))
            : el("button", {
                type: "button",
                onclick: () => this.act(() => api.guilds.createRank(g.id, name.value.trim(), chosen()), "Rank created"),
              }, "Create rank"),
        );
      }
    }

    // Settlements: touching guild lands, levelled by size and membership.
    nodes.push(el("h3", { textContent: `Settlements${g.settlement_level !== "none" ? ` · best: ${g.settlement_level}` : ""}` }));
    if (g.settlements.length) {
      const list = el("ul", { className: "guild-roster" });
      for (const s of g.settlements) list.append(el("li", { textContent: settlementLine(s) }));
      nodes.push(list);
    } else nodes.push(el("p", { textContent: "No guild land yet. Officers claim it in the land panel (L)." }));

    // Diplomacy and taxes (leaders act; everyone sees).
    const leader = g.my_role === "leader";
    nodes.push(el("h3", { textContent: `Relations · sales tax ${g.tax_bps / 100}%` }));
    const relations = el("ul", { className: "guild-roster" });
    for (const r of g.relations) {
      const li = el("li", { textContent: relationLine(r) + " " });
      if (leader && r.kind === "alliance" && r.status === "proposed" && !r.initiated)
        li.append(el("button", { type: "button", onclick: () => this.act(() => api.guilds.ally(g.id, r.with.id), `Allied with [${r.with.tag}]`) }, "Accept"));
      if (leader && r.kind === "alliance")
        li.append(el("button", { type: "button", onclick: () => this.act(() => api.guilds.endAlliance(g.id, r.with.id), "Alliance ended") }, r.status === "active" ? "End" : "Refuse"));
      if (leader && r.kind === "war" && r.peace_offered !== "us")
        li.append(el("button", { type: "button", onclick: () => this.act(() => api.guilds.peace(g.id, r.with.id), r.peace_offered === "them" ? "Peace made" : "Peace offered") }, r.peace_offered === "them" ? "Accept peace" : "Offer peace"));
      relations.append(li);
    }
    if (!g.relations.length) relations.append(el("li", { textContent: "No alliances or wars." }));
    nodes.push(relations);
    if (leader) {
      const other = el("input", { type: "text", maxLength: 26, placeholder: "Guild tag or name" });
      // Suggest guilds as the leader types.
      const found = el("datalist", { id: "guild-search" });
      other.setAttribute("list", "guild-search");
      let lookup = 0;
      other.addEventListener("input", () => {
        const q = other.value.trim();
        const mine = ++lookup;
        if (q.length < 2) return;
        void api.guilds.search(q).then((list) => {
          if (mine !== lookup) return;
          found.replaceChildren(...list.filter((x) => x.id !== g.id).slice(0, 10).map((x) => el("option", { value: x.tag, textContent: `${x.name} · ${x.members} members` })));
        }).catch(() => {});
      });
      nodes.push(found);
      const tax = el("input", { type: "text", maxLength: 5, value: String(g.tax_bps / 100), className: "market-bid" });
      nodes.push(
        el("div", { className: "guild-add" }, other,
          el("button", { type: "button", onclick: () => this.act(() => api.guilds.ally(g.id, other.value.trim()), "Alliance proposed") }, "Propose alliance"),
          el("button", {
            type: "button",
            className: "danger",
            onclick: () => {
              if (confirm(`Declare war on [${other.value.trim()}]? It costs 200 CRN from the treasury; fighting starts in 10 minutes.`))
                void this.act(() => api.guilds.declareWar(g.id, other.value.trim()), "War declared");
            },
          }, "Declare war"),
        ),
        el("div", { className: "guild-add" }, el("span", { textContent: "Sales tax on our land (%)" }), tax,
          el("button", {
            type: "button",
            onclick: () => {
              const bps = parseTax(tax.value);
              if (bps === null) return this.options.notify("A tax is 0 to 20 percent");
              void this.act(() => api.guilds.setTax(g.id, bps), "Tax set");
            },
          }, "Set"),
        ),
      );
    }

    // Chat.
    const log = el("ul", { className: "guild-chat" });
    for (const m of this.chat) log.append(el("li", {}, el("strong", { textContent: `${m.from.name}: ` }), m.body));
    if (!this.chat.length) log.append(el("li", { textContent: "No messages yet." }));
    const line = el("input", { type: "text", maxLength: 300, placeholder: "Message your guild" });
    const send = () => {
      const body = line.value.trim();
      if (!body) return;
      void this.act(() => api.guilds.say(g.id, body), "Sent");
    };
    line.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });
    nodes.push(el("h3", { textContent: "Chat" }), log, el("div", { className: "guild-add" }, line, el("button", { type: "button", onclick: send }, "Send")));

    const amount = el("input", { type: "number", min: 1, value: 10 });
    const depositKey = idempotencyKey();
    nodes.push(
      el("div", { className: "guild-money" }, amount,
        el("button", { type: "button", onclick: () => this.act(() => api.guilds.deposit(g.id, depositKey, Number(amount.value)), "Deposited") }, "Deposit"),
      ),
    );
    const statement = await api.guilds.entries(g.id).catch(() => []);
    if (statement.length) {
      const list = el("ul", { className: "guild-roster guild-statement" });
      for (const e of statement.slice(0, 15)) list.append(el("li", { textContent: entryLine(e) }));
      nodes.push(el("details", {}, el("summary", { textContent: "Treasury statement" }), list));
    }
    if (g.my_permissions.includes("treasury") || g.my_permissions.includes("invite")) {
      const player = el("input", { type: "text", maxLength: 24, placeholder: "Player name" });
      const withdrawKey = idempotencyKey();
      nodes.push(
        el("div", { className: "guild-money" },
          el("button", {
            type: "button",
            onclick: () => this.act(() => api.guilds.withdraw(g.id, withdrawKey, Number(amount.value), player.value.trim() || undefined), "Paid out"),
          }, "Pay out to"),
          player,
        ),
        el("div", { className: "guild-add" },
          el("button", { type: "button", onclick: () => this.act(() => api.guilds.invite(g.id, player.value.trim()), "Invitation sent") }, "Invite"),
        ),
      );
    }
    nodes.push(
      el("button", {
        type: "button",
        className: "danger",
        onclick: () => {
          const last = g.members === 1;
          if (confirm(last ? `Leave and disband ${g.name}? The treasury goes to you and guild land is released.` : `Leave ${g.name}?`))
            void this.act(() => api.guilds.leave(g.id), last ? "Guild disbanded" : "You left the guild");
        },
      }, "Leave guild"),
    );
    return nodes;
  }
}
