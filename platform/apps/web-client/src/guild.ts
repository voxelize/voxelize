// Guild panel (G): found or join a guild, run its roster and treasury.
// Everything goes to the API; guild land shows up in the land panel and is
// enforced by the game server like any other land.

import { api, ApiError, idempotencyKey, type GuildRole, type GuildView } from "./api";

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

/** What a role may do to another member's role (the leader appoints; officers only remove members). */
export function guildActions(mine: GuildRole | null, theirs: GuildRole, self: boolean): ("promote" | "demote" | "lead" | "kick")[] {
  if (self || theirs === "leader" || !mine || mine === "member") return [];
  if (mine === "officer") return theirs === "member" ? ["kick"] : [];
  return theirs === "member" ? ["promote", "lead", "kick"] : ["demote", "lead", "kick"];
}

/** A guild tag as players type it: 2-5 letters or digits, upper case. */
export const normaliseTag = (tag: string) => tag.trim().toUpperCase();
export const validTag = (tag: string) => /^[A-Z0-9]{2,5}$/.test(normaliseTag(tag));

export class GuildPanel {
  readonly root: HTMLElement;
  private busy = false;
  /** My guild, kept for the land panel's "claim for the guild". */
  guild: GuildView | null = null;

  private me = "";

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
    this.guild = state?.guild ?? null;
    if (!state) children.push(el("p", { textContent: "Could not load your guild." }));
    else if (state.guild) children.push(...this.ownGuild(state.guild));
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

  private ownGuild(g: GuildView): Node[] {
    const me = this.me;
    const nodes: Node[] = [
      el("p", {}, el("strong", { textContent: `[${g.tag}] ${g.name}` }), ` · ${g.members}/${g.max_members} members · you are ${g.my_role}`),
      el("p", { className: "guild-treasury", textContent: `Treasury: ${g.treasury} ${g.currency}` }),
    ];
    const roster = el("ul", { className: "guild-roster" });
    for (const m of g.roster) {
      const li = el("li", {}, `${m.name} (${m.role}) `);
      for (const action of guildActions(g.my_role, m.role, m.name === me)) {
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

    const amount = el("input", { type: "number", min: 1, value: 10 });
    const depositKey = idempotencyKey();
    nodes.push(
      el("div", { className: "guild-money" }, amount,
        el("button", { type: "button", onclick: () => this.act(() => api.guilds.deposit(g.id, depositKey, Number(amount.value)), "Deposited") }, "Deposit"),
      ),
    );
    if (g.my_role === "leader" || g.my_role === "officer") {
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
