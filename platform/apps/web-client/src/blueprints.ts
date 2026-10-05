// Blueprint panel (B): capture a building between two marked corners,
// price and publish your blueprints, buy other players', and build one you
// own where you are looking, from your own materials.

import { api, ApiError, type BlueprintView } from "./api";
import type { Content } from "./content";

type Coords = [number, number, number];

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

/** The box two marked corners span: its size, or why it cannot be captured. */
export function boxSize(a: Coords | null, b: Coords | null, max = 32): { ok: true; size: Coords } | { ok: false; reason: string } {
  if (!a || !b) return { ok: false, reason: "Mark two corners first" };
  const size = [0, 1, 2].map((i) => Math.abs(a[i] - b[i]) + 1) as Coords;
  if (size.some((s) => s > max)) return { ok: false, reason: `At most ${max} blocks along each side` };
  return { ok: true, size };
}

/** A blueprint's footprint after `turn` quarter turns (x and z swap on odd turns). */
export function turnedSize([x, y, z]: Coords, turn: number): Coords {
  return turn % 2 === 1 ? [z, y, x] : [x, y, z];
}

/** How a status reads in the panel. */
export function statusLabel(status: string): string {
  return { in_review: "waiting for review", published: "published", draft: "draft", rejected: "removed" }[status] ?? status;
}

export class BlueprintPanel {
  readonly root: HTMLElement;
  private corners: [Coords | null, Coords | null] = [null, null];
  private turn = 0;
  private mirror = false;
  private busy = false;

  private readonly me: Promise<string | null>;

  constructor(
    private readonly options: {
      world: string;
      content: Content;
      target: () => Coords | null;
      placeAt: () => Coords | null;
      capture: (min: Coords, max: Coords, name: string, update?: string) => void;
      build: (id: string, at: Coords, turn: number, mirror: boolean) => void;
      notify: (text: string) => void;
    },
  ) {
    this.root = el("section", { id: "blueprints", className: "panel", hidden: true });
    this.me = api.me().then((u) => u.id).catch(() => null);
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (this.isOpen) void this.render();
  }

  refresh() {
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

  private materials(m: Record<string, number>) {
    return Object.entries(m)
      .map(([k, n]) => `${n} ${this.options.content.itemsByKey.get(k)?.name ?? k}`)
      .join(", ");
  }

  private async render() {
    const [a, b] = this.corners;
    const fmt = (c: Coords | null) => (c ? c.join(", ") : "—");
    const name = el("input", { type: "text", maxLength: 64, value: "My building", placeholder: "Name" });
    const mark = (i: 0 | 1) => () => {
      const t = this.options.target();
      if (!t) return this.options.notify("Look at a block to mark it");
      this.corners[i] = t;
      void this.render();
    };
    const capture = (update?: string) => {
      const box = boxSize(a, b);
      if (!box.ok) return this.options.notify(box.reason);
      const min = [0, 1, 2].map((i) => Math.min(a![i], b![i])) as Coords;
      const max = [0, 1, 2].map((i) => Math.max(a![i], b![i])) as Coords;
      this.options.capture(min, max, name.value.trim() || "My building", update);
    };
    const turn = el("select", {}, ...[0, 1, 2, 3].map((t) => el("option", { value: String(t), textContent: `${t * 90}°`, selected: t === this.turn })));
    turn.addEventListener("change", () => (this.turn = Number(turn.value)));
    const mirror = el("input", { type: "checkbox", checked: this.mirror });
    mirror.addEventListener("change", () => (this.mirror = mirror.checked));
    const box = boxSize(a, b);
    const nodes: (Node | string)[] = [
      el("h2", { textContent: "Blueprints" }),
      el("h3", { textContent: "Capture" }),
      el("p", { className: "market-note", textContent: `Corner 1: ${fmt(a)} · Corner 2: ${fmt(b)}${box.ok ? ` · ${box.size.join("×")}` : ""}` }),
      el("div", { className: "land-add" },
        el("button", { type: "button", onclick: mark(0) }, "Mark corner 1"),
        el("button", { type: "button", onclick: mark(1) }, "Mark corner 2")),
      el("label", { className: "setting" }, el("span", { textContent: "Name" }), name),
      el("button", { type: "button", onclick: () => capture() }, "Capture"),
      el("h3", { textContent: "Building" }),
      el("label", { className: "setting" }, el("span", { textContent: "Turn" }), turn),
      el("label", { className: "setting" }, el("span", { textContent: "Mirror" }), mirror),
    ];

    const mine = await api.blueprints.mine().catch(() => [] as BlueprintView[]);
    nodes.push(el("h3", { textContent: "Yours" }));
    if (!mine.length) nodes.push(el("p", { textContent: "Nothing captured or bought yet." }));
    const list = el("ul", { className: "market-list" });
    for (const bp of mine) {
      const actions: Node[] = [
        el("button", {
          type: "button",
          onclick: () => {
            const at = this.options.placeAt();
            if (!at) return this.options.notify("Look at where it should stand");
            this.options.build(bp.id, at, this.turn, this.mirror);
          },
        }, "Build here"),
      ];
      if (bp.mine && bp.status !== "rejected") {
        actions.push(el("button", { type: "button", title: "Capture the marked box as the next revision", onclick: () => capture(bp.id) }, "New revision"));
      }
      if (!bp.mine) {
        // My licence already for sale: withdraw it.
        const me = await this.me;
        for (const r of await api.blueprints.resales(bp.id).catch(() => [])) {
          if (r.seller.id !== me) continue;
          actions.push(el("button", { type: "button", title: `For sale at ${r.price} CRN`, onclick: () => this.act(() => api.blueprints.cancelResale(r.id), "Resale withdrawn") }, `Withdraw resale (${r.price} CRN)`));
        }
        const ask = el("input", { type: "number", min: "1", value: String(bp.price ?? 50), className: "market-bid" });
        actions.push(ask, el("button", { type: "button", onclick: () => this.act(() => api.blueprints.resell(bp.id, Number(ask.value)), "Your licence is for sale") }, "Resell"));
      }
      if (bp.mine) {
        const royalty = el("input", { type: "number", min: "0", max: "50", value: String(bp.royalty_bps / 100), className: "market-bid", title: "Royalty % on resales" });
        actions.push(royalty, el("button", { type: "button", onclick: () => this.act(() => api.blueprints.update(bp.id, { royalty_bps: Math.round(Number(royalty.value) * 100) }), "Royalty saved") }, "Royalty %"));
        const price = el("input", { type: "number", min: "1", value: String(bp.price ?? 50), className: "market-bid" });
        const copies = el("input", { type: "number", min: "1", placeholder: "copies", value: bp.max_copies ? String(bp.max_copies) : "", className: "market-bid" });
        actions.push(
          price,
          copies,
          el("button", {
            type: "button",
            onclick: () =>
              this.act(
                () =>
                  api.blueprints.update(bp.id, {
                    price: Number(price.value),
                    ...(copies.value ? { max_copies: Number(copies.value) } : {}),
                    published: bp.status === "draft",
                  }),
                bp.status === "draft" ? "Sent to be published" : "Unpublished",
              ),
          }, bp.status === "draft" ? "Publish" : "Unpublish"),
        );
      }
      list.append(
        el("li", {},
          el("strong", { textContent: bp.name }),
          ` ${turnedSize(bp.size, this.turn).join("×")} · ${bp.blocks} blocks · r${bp.revision ?? 1} · ${bp.mine ? `${statusLabel(bp.status)}, ${bp.copies_sold} sold` : `by ${bp.creator.name}`}`,
          ...(bp.mine && bp.review_note ? [el("div", { className: "market-note", textContent: `Review: ${bp.review_note}` })] : []),
          el("div", { className: "market-note", textContent: `Needs: ${this.materials(bp.materials)}` }),
          ...actions),
      );
    }
    nodes.push(list);

    const shop = (await api.blueprints.published(this.options.world).catch(() => [] as BlueprintView[])).filter((bp) => !bp.licensed);
    nodes.push(el("h3", { textContent: "For sale" }));
    if (!shop.length) nodes.push(el("p", { textContent: "No blueprints for sale." }));
    const sale = el("ul", { className: "market-list" });
    for (const bp of shop) {
      for (const r of await api.blueprints.resales(bp.id).catch(() => [])) {
        sale.append(
          el("li", {},
            el("strong", { textContent: r.name }),
            ` resold by ${r.seller.name} · ${r.price} CRN (creator gets ${r.royalty_bps / 100}%)`,
            el("button", { type: "button", onclick: () => this.act(() => api.blueprints.buyResale(r.id), "Licence bought") }, "Buy")),
        );
      }
      const left = bp.max_copies ? ` · ${bp.max_copies - bp.copies_sold} of ${bp.max_copies} left` : "";
      sale.append(
        el("li", {},
          el("strong", { textContent: bp.name }),
          ` by ${bp.creator.name} · ${bp.size.join("×")} · ${bp.price} CRN${left}`,
          el("button", { type: "button", onclick: () => this.act(() => api.blueprints.buy(bp.id), "Licence bought: build it from your blueprints") }, "Buy")),
      );
    }
    nodes.push(sale, el("button", { type: "button", onclick: () => (this.root.hidden = true) }, "Done"));
    this.root.replaceChildren(...nodes);
  }
}
