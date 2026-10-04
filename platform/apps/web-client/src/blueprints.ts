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

export class BlueprintPanel {
  readonly root: HTMLElement;
  private corners: [Coords | null, Coords | null] = [null, null];
  private busy = false;

  constructor(
    private readonly options: {
      world: string;
      content: Content;
      target: () => Coords | null;
      placeAt: () => Coords | null;
      capture: (min: Coords, max: Coords, name: string) => void;
      build: (id: string, at: Coords) => void;
      notify: (text: string) => void;
    },
  ) {
    this.root = el("section", { id: "blueprints", className: "panel", hidden: true });
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
    const capture = () => {
      const box = boxSize(a, b);
      if (!box.ok) return this.options.notify(box.reason);
      const min = [0, 1, 2].map((i) => Math.min(a![i], b![i])) as Coords;
      const max = [0, 1, 2].map((i) => Math.max(a![i], b![i])) as Coords;
      this.options.capture(min, max, name.value.trim() || "My building");
    };
    const box = boxSize(a, b);
    const nodes: (Node | string)[] = [
      el("h2", { textContent: "Blueprints" }),
      el("h3", { textContent: "Capture" }),
      el("p", { className: "market-note", textContent: `Corner 1: ${fmt(a)} · Corner 2: ${fmt(b)}${box.ok ? ` · ${box.size.join("×")}` : ""}` }),
      el("div", { className: "land-add" },
        el("button", { type: "button", onclick: mark(0) }, "Mark corner 1"),
        el("button", { type: "button", onclick: mark(1) }, "Mark corner 2")),
      el("label", { className: "setting" }, el("span", { textContent: "Name" }), name),
      el("button", { type: "button", onclick: capture }, "Capture"),
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
            this.options.build(bp.id, at);
          },
        }, "Build here"),
      ];
      if (!bp.mine) {
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
                    published: bp.status !== "published",
                  }),
                bp.status === "published" ? "Unpublished" : "Published",
              ),
          }, bp.status === "published" ? "Unpublish" : "Publish"),
        );
      }
      list.append(
        el("li", {},
          el("strong", { textContent: bp.name }),
          ` ${bp.size.join("×")} · ${bp.blocks} blocks · ${bp.mine ? `${bp.status}, ${bp.copies_sold} sold` : `by ${bp.creator.name}`}`,
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
