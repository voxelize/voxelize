// Land panel (L): who owns the ground you stand on, claiming it, and
// managing your land's members and public permissions. Claims are paid
// and recorded by the API; the game server enforces them within seconds.

import { api, ApiError, idempotencyKey, type LandPermissions, type LandView } from "./api";

/** What the game server says about the land under the player. */
export type LandHere = {
  id: string;
  name: string;
  owner: { id: string; name: string };
  guild?: { id: string; name: string; tag: string } | null;
  settlement?: { name: string; level: string } | null;
  role: string | null;
  public: LandPermissions;
  min: [number, number];
  max: [number, number];
  sale?: number | null;
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

/** A claim box grown (or shrunk, for negative `by`) on every side; `null`
 * when it would vanish. */
export function ringBox(min: [number, number], max: [number, number], by: number): { min: [number, number]; max: [number, number] } | null {
  const out = { min: [min[0] - by, min[1] - by] as [number, number], max: [max[0] + by, max[1] + by] as [number, number] };
  return out.min[0] > out.max[0] || out.min[1] > out.max[1] ? null : out;
}

export const chunkArea = (min: [number, number], max: [number, number]) => (max[0] - min[0] + 1) * (max[1] - min[1] + 1);

/** World-block rectangle of a claim: [x0, z0, x1, z1] (x1, z1 exclusive). */
export function claimRect(min: [number, number], max: [number, number]): [number, number, number, number] {
  return [min[0] * LAND_CHUNK, min[1] * LAND_CHUNK, (max[0] + 1) * LAND_CHUNK, (max[1] + 1) * LAND_CHUNK];
}

/** Points along a claim's border within `reach` blocks of (x, z), one per
 * block, for drawing posts. */
export function borderPosts(min: [number, number], max: [number, number], x: number, z: number, reach: number): [number, number][] {
  const [x0, z0, x1, z1] = claimRect(min, max);
  const posts: [number, number][] = [];
  const near = (px: number, pz: number) => Math.abs(px - x) <= reach && Math.abs(pz - z) <= reach;
  for (let px = x0; px <= x1; px++) {
    if (near(px, z0)) posts.push([px, z0]);
    if (near(px, z1)) posts.push([px, z1]);
  }
  for (let pz = z0 + 1; pz < z1; pz++) {
    if (near(x0, pz)) posts.push([x0, pz]);
    if (near(x1, pz)) posts.push([x1, pz]);
  }
  return posts;
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
      if (here.sale && here.role !== "owner") {
        const price = here.sale;
        children.push(
          el("p", { className: "land-sale", textContent: `For sale: ${price} CRN` }),
          el(
            "button",
            {
              type: "button",
              onclick: () => {
                if (confirm(`Buy ${here.name} for ${price} CRN?`)) void this.act(() => api.lands.buy(here.id, idempotencyKey(), price), "Bought. It is yours within a few seconds.");
              },
            },
            `Buy for ${price}`,
          ),
        );
      }
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
    for (const key of ["build", "containers", "use", "animals"] as const) {
      const box = el("input", { type: "checkbox", checked: land.permissions[key] });
      box.addEventListener("change", () =>
        this.act(() => api.lands.update(id, { permissions: { ...land.permissions, [key]: box.checked } }), "Saved"),
      );
      const label = {
        build: "build and break",
        containers: "open chests and furnaces",
        use: "use switches and gates",
        animals: "hurt animals",
      }[key];
      nodes.push(el("label", { className: "setting" }, el("span", { textContent: label }), box));
    }
    if (role === "owner") {
      // Size: grow or shrink by a ring of chunks.
      const grown = ringBox(land.min, land.max, 1);
      const shrunk = ringBox(land.min, land.max, -1);
      const added = grown ? chunkArea(grown.min, grown.max) - land.chunks : 0;
      const quote = added > 0 ? await api.lands.quote(added).catch(() => null) : null;
      nodes.push(el("h3", { textContent: "Size" }));
      if (grown) {
        nodes.push(
          el(
            "button",
            { type: "button", onclick: () => this.act(() => api.lands.resize(id, idempotencyKey(), grown.min, grown.max), "Land grown") },
            `Grow by a chunk on every side${quote ? ` (${quote.price} ${quote.currency})` : ""}`,
          ),
        );
      }
      if (shrunk) {
        nodes.push(
          el(
            "button",
            {
              type: "button",
              onclick: () => {
                if (confirm("Shrink by a chunk on every side? Nothing is refunded.")) void this.act(() => api.lands.resize(id, idempotencyKey(), shrunk.min, shrunk.max), "Land shrunk");
              },
            },
            "Shrink by a chunk on every side",
          ),
        );
      }
      // Sale.
      if (!land.guild) {
        nodes.push(el("h3", { textContent: "Sale" }));
        if (land.sale_price) {
          nodes.push(
            el("p", { textContent: `Offered for ${land.sale_price} CRN.` }),
            el("button", { type: "button", onclick: () => this.act(() => api.lands.withdraw(id), "Offer withdrawn") }, "Withdraw the offer"),
          );
        } else {
          const price = el("input", { type: "number", min: "1", step: "1", placeholder: "Price" });
          nodes.push(
            el(
              "div",
              { className: "land-add" },
              price,
              el(
                "button",
                {
                  type: "button",
                  onclick: () => {
                    const value = Math.floor(Number(price.value));
                    if (value >= 1) void this.act(() => api.lands.offer(id, value), "Offered for sale");
                  },
                },
                "Offer for sale",
              ),
            ),
          );
        }
      }
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
