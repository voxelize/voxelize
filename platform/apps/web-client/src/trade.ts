// Trade window: T invites the nearest player, Y accepts an invitation.
// Each side adds stacks from their hotbar and Crowns; any change unconfirms
// both; when both confirm, the server moves the Crowns and swaps the goods.

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

type SideView = { name: string; items: { item: string | null; count: number }[]; crowns: number; confirmed: boolean };
export type TradeView = { id: string; mine: SideView; theirs: SideView; paying: boolean };

/** The nearest other player within `range` blocks, by id. */
export function nearest(me: { x: number; y: number; z: number }, others: [string, { x: number; y: number; z: number }][], range = 8): string | null {
  let best: [string, number] | null = null;
  for (const [id, p] of others) {
    const d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
    if (d <= range && (!best || d < best[1])) best = [id, d];
  }
  return best ? best[0] : null;
}

export class TradePanel {
  readonly root: HTMLElement;
  private view: TradeView | null = null;
  invite: { from: string; name: string } | null = null;

  constructor(
    private readonly options: {
      itemName: (key: string | null) => string;
      heldSlot: () => { slot: number; count: number } | null;
      call: (intent: string, payload: Record<string, unknown>) => void;
      notify: (text: string) => void;
    },
  ) {
    this.root = el("section", { id: "trade", className: "panel", hidden: true });
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  show(view: TradeView | null) {
    this.view = view;
    this.root.hidden = !view;
    if (view) this.render();
  }

  private side(title: string, s: SideView): HTMLElement {
    return el(
      "div",
      { className: "trade-side" },
      el("h3", { textContent: `${title}${s.confirmed ? " ✓" : ""}` }),
      el("ul", { className: "market-list" }, ...(s.items.length ? s.items.map((i) => el("li", { textContent: `${i.count} × ${this.options.itemName(i.item)}` })) : [el("li", { textContent: "nothing" })])),
      el("p", { textContent: `${s.crowns} Crowns` }),
    );
  }

  private render() {
    const v = this.view!;
    const crowns = el("input", { type: "number", min: "0", value: String(v.mine.crowns), className: "market-bid" });
    const send = (extra: Record<string, unknown>) =>
      this.options.call("platform.trade.offer", { crowns: Math.max(0, Math.floor(Number(crowns.value) || 0)), ...extra });
    const addHeld = () => {
      const held = this.options.heldSlot();
      if (!held) return this.options.notify("Hold the stack you want to offer");
      send({ items: [{ slot: held.slot, count: held.count }] });
    };
    this.root.replaceChildren(
      el("h2", { textContent: `Trade with ${v.theirs.name || "a player"}` }),
      el("div", { className: "trade-sides" }, this.side("You give", v.mine), this.side("You get", v.theirs)),
      v.paying ? el("p", { className: "market-note", textContent: "Moving the Crowns…" }) : "",
      el("div", { className: "land-add" },
        el("button", { type: "button", onclick: addHeld }, "Add held stack"),
        el("button", { type: "button", onclick: () => send({ reset: true }) }, "Take all back")),
      el("label", { className: "setting" }, el("span", { textContent: "Crowns you give" }), crowns, el("button", { type: "button", onclick: () => send({}) }, "Set")),
      el("div", { className: "land-add" },
        el("button", { type: "button", onclick: () => this.options.call("platform.trade.confirm", {}) }, v.mine.confirmed ? "Confirmed" : "Confirm"),
        el("button", { type: "button", className: "danger", onclick: () => this.options.call("platform.trade.cancel", {}) }, "Cancel")),
    );
  }
}
