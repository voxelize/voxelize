// A villager's offers, opened by using (right-clicking) the villager. The
// game server checks reach and materials and makes the exchange.

import type { Content } from "./content";

export type ItemCount = { item: string; count: number };
export type Offer = { give: ItemCount; take: ItemCount[] };

/** "20 Wheat → 1 Gold Ingot". */
export function offerLine(offer: Offer, name: (key: string) => string = (k) => k): string {
  const take = offer.take.map((t) => `${t.count} ${name(t.item)}`).join(" + ");
  return `${take} → ${offer.give.count} ${name(offer.give.item)}`;
}

/** Whether an inventory (item key → count) can pay for an offer. */
export function affordable(offer: Offer, have: (key: string) => number): boolean {
  return offer.take.every((t) => have(t.item) >= t.count);
}

export class NpcPanel {
  readonly root: HTMLElement;
  private shown: { mob: number; name: string; trades: Offer[] } | null = null;

  constructor(
    private readonly content: Content,
    private readonly actions: { trade: (mob: number, offer: number) => void; have: (key: string) => number },
  ) {
    this.root = document.createElement("section");
    this.root.id = "npc";
    this.root.className = "panel";
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(mob: number, name: string, trades: Offer[]) {
    this.shown = { mob, name, trades };
    this.root.hidden = false;
    this.render();
  }

  refresh() {
    if (this.isOpen) this.render();
  }

  private render() {
    if (!this.shown) return;
    const name = (k: string) => this.content.itemsByKey.get(k)?.name ?? k;
    const title = Object.assign(document.createElement("h2"), { textContent: this.shown.name });
    const list = document.createElement("ul");
    list.className = "market-list";
    this.shown.trades.forEach((offer, i) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Trade";
      button.disabled = !affordable(offer, this.actions.have);
      button.addEventListener("click", () => this.actions.trade(this.shown!.mob, i));
      li.append(offerLine(offer, name), " ", button);
      list.append(li);
    });
    const close = Object.assign(document.createElement("button"), { type: "button", textContent: "Done" });
    close.addEventListener("click", () => (this.root.hidden = true));
    this.root.replaceChildren(title, list, close);
  }
}
