// Trade stall panel: another player's stall shows what it sells; your own
// stall shows a price for every slot (its stock is in the window beside).

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

export type StallView = {
  at: [number, number, number];
  owner: { id: string; name: string };
  mine: boolean;
  creative: boolean;
  offers: { slot: number; item: string | null; count: number; price: number }[];
  prices: number[];
  pending: number;
  stock: ({ item: string | null; count: number } | null)[] | null;
};

/** A price typed by the owner: a whole number from 0 (off sale) up. */
export function parsePrice(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n <= 1_000_000_000 ? n : null;
}

export class StallPanel {
  readonly root: HTMLElement;
  private view: StallView | null = null;

  constructor(
    private readonly options: {
      itemName: (key: string | null) => string;
      buy: (at: [number, number, number], slot: number) => void;
      price: (at: [number, number, number], slot: number, price: number) => void;
      notify: (text: string) => void;
    },
  ) {
    this.root = el("section", { id: "stall", className: "panel", hidden: true });
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  close() {
    this.root.hidden = true;
  }

  show(view: StallView) {
    this.view = view;
    this.root.hidden = false;
    this.render();
  }

  private render() {
    const v = this.view;
    if (!v) return;
    const nodes: (Node | string)[] = [el("h2", { textContent: v.mine ? "Your stall" : `${v.owner.name || "A"}'s stall` })];
    if (v.creative) nodes.push(el("p", { className: "market-note", textContent: "A creative stall: for show, never for sale." }));
    if (v.mine) {
      nodes.push(el("p", { className: "market-note", textContent: "Stock it in the window; set a price per slot (0 = not for sale). Payments reach your wallet minus the 5% fee." }));
      const list = el("ul", { className: "market-list" });
      (v.stock ?? []).forEach((s, slot) => {
        const input = el("input", { type: "number", min: "0", value: String(v.prices[slot] ?? 0), className: "market-bid" });
        const save = () => {
          const price = parsePrice(input.value);
          if (price === null) return this.options.notify("Prices are whole Crowns");
          this.options.price(v.at, slot, price);
        };
        list.append(
          el(
            "li",
            {},
            `${slot + 1}. ${s ? `${s.count} × ${this.options.itemName(s.item)}` : "empty"}`,
            input,
            el("button", { type: "button", onclick: save }, "Set"),
          ),
        );
      });
      nodes.push(list);
    } else if (!v.offers.length) {
      nodes.push(el("p", { textContent: "Nothing for sale right now." }));
    } else {
      const list = el("ul", { className: "market-list" });
      for (const o of v.offers)
        list.append(
          el(
            "li",
            {},
            el("strong", { textContent: `${o.count} × ${this.options.itemName(o.item)}` }),
            ` ${o.price} CRN`,
            el("button", { type: "button", onclick: () => this.options.buy(v.at, o.slot) }, "Buy"),
          ),
        );
      nodes.push(list);
    }
    if (v.pending) nodes.push(el("p", { className: "market-note", textContent: `${v.pending} sale(s) waiting for payment.` }));
    nodes.push(el("button", { type: "button", onclick: () => this.close() }, "Done"));
    this.root.replaceChildren(...nodes);
  }
}
