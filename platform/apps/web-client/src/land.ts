// Land panel (L): who owns the ground you stand on, claiming it, and
// managing your land's members and public permissions. Claims are paid
// and recorded by the API; the game server enforces them within seconds.

import { api, ApiError, idempotencyKey, type LandPermissions, type LandView } from "./api";

/** What the game server says about the land under the player. */
export type LandHere = {
  id: string;
  name: string;
  owner: { id: string; name: string };
  role: string | null;
  public: LandPermissions;
  min: [number, number];
  max: [number, number];
} | null;

export const LAND_CHUNK = 16;

export const chunkOf = (x: number, z: number): [number, number] => [
  Math.floor(x / LAND_CHUNK),
  Math.floor(z / LAND_CHUNK),
];

/** The claim box of `radius` chunks around a chunk (0: just that chunk). */
export function claimBox([cx, cz]: [number, number], radius: number): { min: [number, number]; max: [number, number] } {
  return { min: [cx - radius, cz - radius], max: [cx + radius, cz + radius] };
}

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

export class LandPanel {
  readonly root: HTMLElement;
  private here: LandHere = null;
  private busy = false;

  constructor(
    private readonly options: {
      world: string;
      dimension: string;
      position: () => { x: number; z: number };
      /** My guild, when I may claim land for it. */
      guild?: () => { id: string; tag: string; role: string | null } | null;
      notify: (text: string) => void;
    },
  ) {
    this.root = el("section", { id: "land", className: "panel", hidden: true });
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  setHere(here: LandHere) {
    this.here = here;
    if (this.isOpen) void this.render();
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (this.isOpen) void this.render();
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
    const { x, z } = this.options.position();
    const chunk = chunkOf(x, z);
    const here = this.here;
    const children: (Node | string)[] = [el("h2", { textContent: "Land" })];
    children.push(el("p", { className: "land-where", textContent: `Chunk ${chunk[0]}, ${chunk[1]} · ${this.options.dimension}` }));

    if (!here) {
      children.push(el("p", { textContent: "Wilderness: nobody owns this ground." }));
      const quote = await api.lands.quote(1).catch(() => null);
      const quote9 = await api.lands.quote(9).catch(() => null);
      const name = el("input", { type: "text", maxLength: 48, value: "My land", placeholder: "Name" });
      const guild = this.options.guild?.() ?? null;
      const forGuild = el("input", { type: "checkbox", checked: false });
      const claim = (radius: number) =>
        this.act(
          () =>
            api.lands.claim(idempotencyKey(), {
              world: this.options.world,
              dimension: this.options.dimension,
              ...claimBox(chunk, radius),
              name: name.value.trim() || "My land",
              ...(forGuild.checked && guild ? { guild: guild.id } : {}),
            }),
          "Claimed. It is protected within a few seconds.",
        );
      children.push(
        el("label", { className: "setting" }, el("span", { textContent: "Name" }), name),
        ...(guild && (guild.role === "leader" || guild.role === "officer")
          ? [el("label", { className: "setting" }, el("span", { textContent: `For [${guild.tag}], paid from its treasury` }), forGuild)]
          : []),
        el("button", { type: "button", onclick: () => claim(0) }, `Claim this chunk${quote ? ` (${quote.price} ${quote.currency})` : ""}`),
        el("button", { type: "button", onclick: () => claim(1) }, `Claim 3×3 chunks${quote9 ? ` (${quote9.price} ${quote9.currency})` : ""}`),
      );
    } else {
      children.push(
        el("p", {}, el("strong", { textContent: here.name || "Unnamed land" }), ` — ${here.owner.name || "someone"}`),
        el("p", { className: "land-role", textContent: here.role ? `Your role: ${here.role}` : "You are a guest here." }),
      );
      if (here.role === "owner" || here.role === "manager") children.push(...(await this.manage(here.id, here.role)));
    }
    children.push(el("button", { type: "button", onclick: () => (this.root.hidden = true) }, "Done"));
    this.root.replaceChildren(...children);
  }

  private async manage(id: string, role: string): Promise<Node[]> {
    const lands = await api.lands.list(this.options.world, this.options.dimension).catch(() => [] as LandView[]);
    const land = lands.find((l) => l.id === id);
    if (!land) return [el("p", { textContent: "Loading land details failed." })];
    const nodes: Node[] = [];
    const members = el("ul", { className: "land-members" });
    for (const m of land.members) {
      members.append(
        el(
          "li",
          {},
          `${m.name} (${m.role}) `,
          el("button", { type: "button", onclick: () => this.act(() => api.lands.removeMember(id, m.name), `${m.name} removed`) }, "Remove"),
        ),
      );
    }
    if (!land.members.length) members.append(el("li", { textContent: "No members yet." }));
    const player = el("input", { type: "text", maxLength: 24, placeholder: "Player name" });
    const roleSelect = el("select", {}, ...["builder", "visitor", ...(role === "owner" ? ["manager"] : [])].map((r) => el("option", { value: r, textContent: r })));
    nodes.push(
      el("h3", { textContent: `Members · ${land.chunks} chunk(s)` }),
      members,
      el(
        "div",
        { className: "land-add" },
        player,
        roleSelect,
        el(
          "button",
          { type: "button", onclick: () => this.act(() => api.lands.addMember(id, player.value.trim(), roleSelect.value), "Member saved") },
          "Add",
        ),
      ),
      el("h3", { textContent: "Guests may" }),
    );
    for (const key of ["build", "containers", "use"] as const) {
      const box = el("input", { type: "checkbox", checked: land.permissions[key] });
      box.addEventListener("change", () =>
        this.act(() => api.lands.update(id, { permissions: { ...land.permissions, [key]: box.checked } }), "Saved"),
      );
      const label = { build: "build and break", containers: "open chests and furnaces", use: "use switches and gates" }[key];
      nodes.push(el("label", { className: "setting" }, el("span", { textContent: label }), box));
    }
    if (role === "owner") {
      nodes.push(
        el(
          "button",
          {
            type: "button",
            className: "danger",
            onclick: () => {
              if (confirm(`Release ${land.name}? Nothing is refunded.`)) void this.act(() => api.lands.release(id), "Land released");
            },
          },
          "Release this land",
        ),
      );
    }
    return nodes;
  }
}
