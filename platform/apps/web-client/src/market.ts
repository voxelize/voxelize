// Market panel (M): browse and buy, bid on auctions, sell the held stack,
// manage your listings, see deliveries on their way. Buying and bidding go
// to the API (money); selling goes to the game server, which takes the
// goods from your inventory and hands them to the market.

import { api, ApiError, idempotencyKey, type Listing } from "./api";
import type { Content } from "./content";
import type { InventorySnapshot } from "./hud";

type Tab = "browse" | "sell" | "mine" | "deliveries";

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

/** "3h 20m" until an ISO time, or "ended". */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return "ended";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d`;
}

/** What a sell form sends to `platform.market.list`, or why it cannot. */
export function sellPayload(form: { slot: number; count: number; price: number; kind: string; buyout: number | null; hours: number }, held: { count: number } | null): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string } {
  if (!held) return { ok: false, reason: "Hold the stack you want to sell" };
  if (!Number.isInteger(form.count) || form.count < 1 || form.count > held.count) return { ok: false, reason: `Sell 1 to ${held.count}` };
  if (!Number.isInteger(form.price) || form.price < 1) return { ok: false, reason: "Set a price of at least 1" };
  if (form.kind === "auction" && form.buyout !== null && form.buyout <= form.price) return { ok: false, reason: "Buyout must be above the opening bid" };
  const payload: Record<string, unknown> = { slot: form.slot, count: form.count, price: form.price, kind: form.kind, hours: form.hours };
  if (form.kind === "auction" && form.buyout !== null) payload.buyout = form.buyout;
  return { ok: true, payload };
}

export class MarketPanel {
  readonly root: HTMLElement;
  private tab: Tab = "browse";
  private busy = false;

  constructor(
    private readonly options: {
      world: string;
      content: Content;
      inventory: () => InventorySnapshot;
      sell: (payload: Record<string, unknown>) => void;
      notify: (text: string) => void;
    },
  ) {
    this.root = el("section", { id: "market", className: "panel", hidden: true });
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

  private name(key: string) {
    return this.options.content.itemsByKey.get(key)?.name ?? key;
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
    const wallets = await api.wallets().catch(() => []);
    const crowns = wallets.find((w) => w.currency === "CRN")?.balance ?? 0;
    const tabs = el(
      "nav",
      { className: "market-tabs" },
      ...(["browse", "sell", "mine", "deliveries"] as Tab[]).map((t) =>
        el("button", { type: "button", className: t === this.tab ? "active" : "", onclick: () => ((this.tab = t), void this.render()) }, t[0].toUpperCase() + t.slice(1)),
      ),
    );
    const body = el("div", { className: "market-body" });
    if (this.tab === "browse") body.append(...(await this.browse()));
    if (this.tab === "sell") body.append(...this.sellForm());
    if (this.tab === "mine") body.append(...(await this.mine()));
    if (this.tab === "deliveries") body.append(...(await this.deliveries()));
    this.root.replaceChildren(
      el("h2", { textContent: "Market" }),
      el("p", { className: "market-balance", textContent: `${crowns} Crowns` }),
      tabs,
      body,
      el("button", { type: "button", onclick: () => (this.root.hidden = true) }, "Done"),
    );
  }

  private row(l: Listing, actions: Node[]): HTMLElement {
    const price =
      l.kind === "fixed"
        ? `${l.price} CRN`
        : `bid ${l.current_bid ?? "—"} (next ${l.minimum_bid})${l.buyout ? ` · buyout ${l.buyout}` : ""}`;
    return el(
      "li",
      {},
      el("strong", { textContent: `${l.count} × ${this.name(l.item)}` }),
      ` ${price} · ${l.seller.name} · ${timeLeft(l.ends_at)}`,
      ...actions,
    );
  }

  private async browse(): Promise<Node[]> {
    const listings = await api.market.listings(this.options.world).catch(() => [] as Listing[]);
    if (!listings.length) return [el("p", { textContent: "Nothing for sale right now." })];
    const list = el("ul", { className: "market-list" });
    for (const l of listings) {
      const actions: Node[] = [];
      if (l.kind === "fixed" || l.buyout)
        actions.push(el("button", { type: "button", onclick: () => this.act(() => api.market.buy(l.id), "Bought: it arrives in your inventory") }, l.kind === "fixed" ? "Buy" : "Buy out"));
      if (l.kind === "auction") {
        const amount = el("input", { type: "number", min: String(l.minimum_bid ?? 1), value: String(l.minimum_bid ?? 1), className: "market-bid" });
        actions.push(amount, el("button", { type: "button", onclick: () => this.act(() => api.market.bid(l.id, Number(amount.value), idempotencyKey()), "Bid placed") }, "Bid"));
      }
      list.append(this.row(l, actions));
    }
    return [list];
  }

  private sellForm(): Node[] {
    const inv = this.options.inventory();
    const held = inv.slots[inv.selected] ?? null;
    const item = held ? this.options.content.itemsById.get(held.item) : undefined;
    if (!held || !item) return [el("p", { textContent: "Hold the stack you want to sell, then come back." })];
    const count = el("input", { type: "number", min: "1", max: String(held.count), value: String(held.count) });
    const price = el("input", { type: "number", min: "1", value: String(Math.max(1, (item as { value?: number }).value ?? 1) * held.count) });
    const kind = el("select", {}, el("option", { value: "fixed", textContent: "Fixed price" }), el("option", { value: "auction", textContent: "Auction" }));
    const buyout = el("input", { type: "number", min: "1", placeholder: "Buyout (optional)" });
    const hours = el("select", {}, ...[1, 6, 24, 48, 168].map((h) => el("option", { value: String(h), textContent: h < 48 ? `${h} hours` : `${h / 24} days`, selected: h === 48 })));
    const submit = () => {
      const result = sellPayload(
        {
          slot: inv.selected,
          count: Number(count.value),
          price: Number(price.value),
          kind: kind.value,
          buyout: buyout.value ? Number(buyout.value) : null,
          hours: Number(hours.value),
        },
        held,
      );
      if (!result.ok) return this.options.notify(result.reason);
      this.options.sell(result.payload);
    };
    return [
      el("p", { textContent: `Selling from your hand: ${held.count} × ${item.name}` }),
      el("label", { className: "setting" }, el("span", { textContent: "Count" }), count),
      el("label", { className: "setting" }, el("span", { textContent: "Price (CRN)" }), price),
      el("label", { className: "setting" }, el("span", { textContent: "Kind" }), kind),
      el("label", { className: "setting" }, el("span", { textContent: "Buyout" }), buyout),
      el("label", { className: "setting" }, el("span", { textContent: "Runs for" }), hours),
      el("p", { className: "market-note", textContent: "A 5% fee is taken from the sale. Unsold goods come back to you." }),
      el("button", { type: "button", onclick: submit }, "List for sale"),
    ];
  }

  private async mine(): Promise<Node[]> {
    const listings = await api.market.listings(this.options.world, { mine: true }).catch(() => [] as Listing[]);
    if (!listings.length) return [el("p", { textContent: "You have no listings." })];
    const list = el("ul", { className: "market-list" });
    for (const l of listings) {
      const actions: Node[] = [el("span", { className: "market-status", textContent: ` [${l.status}]` })];
      if (l.status === "open" && l.bid_count === 0)
        actions.push(el("button", { type: "button", onclick: () => this.act(() => api.market.cancel(l.id), "Cancelled: the goods come back to you") }, "Cancel"));
      list.append(this.row(l, actions));
    }
    return [list];
  }

  private async deliveries(): Promise<Node[]> {
    const rows = await api.market.deliveries().catch(() => []);
    if (!rows.length) return [el("p", { textContent: "Nothing on its way." })];
    return [
      el("p", { textContent: "Handed to you in the world named, when you are there with room in your inventory." }),
      el("ul", { className: "market-list" }, ...rows.map((d) => el("li", { textContent: `${d.count} × ${this.name(d.item)} (${d.reason.replace("_", " ")})` }))),
    ];
  }
}
