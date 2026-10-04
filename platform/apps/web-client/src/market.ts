// Market panel (M): browse and buy, bid on auctions, sell the held stack,
// manage your listings, see deliveries on their way. Buying and bidding go
// to the API (money); selling goes to the game server, which takes the
// goods from your inventory and hands them to the market.

import { api, ApiError, idempotencyKey, type ContractView, type Listing, type PriceHistory } from "./api";
import type { Content } from "./content";
import type { InventorySnapshot } from "./hud";

type Tab = "browse" | "sell" | "mine" | "contracts" | "deliveries";

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

/** Item keys whose name or key contains the query (case-insensitive). */
export function searchKeys(items: { key: string; name: string }[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const asKey = q.replace(/\s+/g, "_");
  return items.filter((i) => i.name.toLowerCase().includes(q) || i.key.includes(asKey)).map((i) => i.key);
}

/** What `count` of a `total`-item stack priced `price` costs (the server's
 * rounding: up, with the last items paying the rest). */
export function partPrice(price: number, total: number, count: number): number {
  return count >= total ? price : Math.ceil((price * count) / total);
}

/** One line of price statistics. */
export function historyLine(h: PriceHistory): string {
  const s = h.stats;
  if (!s.sales) return `No sales in ${s.days} days`;
  return `${s.items} sold in ${s.sales} sales over ${s.days} days · avg ${s.average_unit_price} each (${s.min_unit_price}–${s.max_unit_price})`;
}

export class MarketPanel {
  readonly root: HTMLElement;
  private tab: Tab = "browse";
  private query = "";
  private busy = false;

  constructor(
    private readonly options: {
      world: string;
      content: Content;
      inventory: () => InventorySnapshot;
      sell: (payload: Record<string, unknown>) => void;
      deliver: (contract: string, slot: number, count: number) => void;
      /** My guild, when I may post contracts for it. */
      guild?: () => { id: string; tag: string; role: string | null } | null;
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
      ...(["browse", "sell", "mine", "contracts", "deliveries"] as Tab[]).map((t) =>
        el("button", { type: "button", className: t === this.tab ? "active" : "", onclick: () => ((this.tab = t), void this.render()) }, t[0].toUpperCase() + t.slice(1)),
      ),
    );
    const body = el("div", { className: "market-body" });
    if (this.tab === "browse") body.append(...(await this.browse()));
    if (this.tab === "sell") body.append(...this.sellForm());
    if (this.tab === "mine") body.append(...(await this.mine()));
    if (this.tab === "deliveries") body.append(...(await this.deliveries()));
    if (this.tab === "contracts") body.append(...(await this.contracts()));
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
    const search = el("input", { type: "search", placeholder: "Search items", value: this.query, className: "market-search" });
    search.addEventListener("change", () => {
      this.query = search.value;
      void this.render();
    });
    const keys = searchKeys(this.options.content.pack.items, this.query);
    if (this.query.trim() && !keys.length) return [search, el("p", { textContent: "No item by that name." })];
    const listings = await api.market.listings(this.options.world, keys.length ? { items: keys.slice(0, 100) } : {}).catch(() => [] as Listing[]);
    if (!listings.length) return [search, el("p", { textContent: "Nothing for sale right now." })];
    const list = el("ul", { className: "market-list" });
    for (const l of listings) {
      const actions: Node[] = [];
      if (l.kind === "fixed" && l.count > 1) {
        const n = el("input", { type: "number", min: "1", max: String(l.count - 1), value: "1", className: "market-bid" });
        const label = () => `Buy ${n.value} for ${partPrice(l.price, l.count, Math.max(1, Number(n.value) || 1))}`;
        const part = el("button", { type: "button", onclick: () => this.act(() => api.market.buyPart(l.id, Math.max(1, Math.floor(Number(n.value) || 1)), idempotencyKey()), "Bought: it arrives in your inventory") }, label());
        n.addEventListener("input", () => (part.textContent = label()));
        actions.push(n, part);
      }
      const history = el("button", { type: "button", className: "market-history" }, "Prices");
      history.addEventListener("click", async () => {
        const h = await api.market.history(this.options.world, l.item).catch(() => null);
        history.replaceWith(el("span", { className: "muted", textContent: h ? historyLine(h) : "No history" }));
      });
      actions.push(history);
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

  private async contracts(): Promise<Node[]> {
    const open = await api.contracts.list(this.options.world).catch(() => [] as ContractView[]);
    const mine = await api.contracts.list(this.options.world, true).catch(() => [] as ContractView[]);
    const line = (c: ContractView) =>
      `${c.guild ? `[${c.guild.tag}] ` : ""}${c.title}: ${c.count} × ${this.name(c.item)} for ${c.reward} CRN · ${timeLeft(c.deadline_at)}`;
    const guild = this.options.guild?.() ?? null;
    const officer = !!guild && (guild.role === "leader" || guild.role === "officer");
    const openList = el("ul", { className: "market-list" });
    for (const c of open.filter((c) => !mine.some((m) => m.id === c.id)))
      openList.append(el("li", {}, line(c), ` · by ${c.poster.name}`, el("button", { type: "button", onclick: () => this.act(() => api.contracts.accept(c.id), "Contract taken: bring the goods") }, "Take")));
    const mineList = el("ul", { className: "market-list" });
    for (const c of mine) {
      const actions: Node[] = [el("span", { className: "market-status", textContent: ` [${c.status}]` })];
      if (c.status === "accepted" && c.role === "contractor") {
        actions.push(
          el("button", {
            type: "button",
            onclick: () => {
              const inv = this.options.inventory();
              const held = inv.slots[inv.selected];
              const item = held ? this.options.content.itemsById.get(held.item) : undefined;
              if (!held || item?.key !== c.item || held.count < c.count) return this.options.notify(`Hold ${c.count} × ${this.name(c.item)}`);
              this.options.deliver(c.id, inv.selected, c.count);
            },
          }, "Deliver held"),
          el("button", { type: "button", onclick: () => this.act(() => api.contracts.abandon(c.id), "Contract given back") }, "Give up"),
        );
      }
      if (c.status === "open" && (c.role === "poster" || (officer && c.guild?.id === guild?.id))) actions.push(el("button", { type: "button", onclick: () => this.act(() => api.contracts.cancel(c.id), "Withdrawn: reward refunded") }, "Withdraw"));
      mineList.append(el("li", {}, line(c), ...actions));
    }
    const item = el("select", {}, ...this.options.content.pack.items.map((i) => el("option", { value: i.key, textContent: i.name })));
    const count = el("input", { type: "number", min: "1", value: "16", className: "market-bid" });
    const reward = el("input", { type: "number", min: "1", value: "50", className: "market-bid" });
    const hours = el("select", {}, ...[2, 24, 48, 168].map((h) => el("option", { value: String(h), textContent: `${h} h`, selected: h === 48 })));
    const title = el("input", { type: "text", maxLength: 80, placeholder: "Title" });
    const forGuild = el("input", { type: "checkbox", checked: false });
    const post = () =>
      this.act(
        () =>
          api.contracts.post(idempotencyKey(), {
            world: this.options.world,
            title: title.value,
            item: item.value,
            count: Number(count.value),
            reward: Number(reward.value),
            hours: Number(hours.value),
            ...(forGuild.checked && guild ? { guild: guild.id } : {}),
          }),
        "Posted: the reward is locked until it is done or expires",
      );
    return [
      el("h3", { textContent: "Open" }),
      open.length ? openList : el("p", { textContent: "No open contracts." }),
      el("h3", { textContent: "Yours" }),
      mine.length ? mineList : el("p", { textContent: "You have no contracts." }),
      el("h3", { textContent: "Post a contract" }),
      el("label", { className: "setting" }, el("span", { textContent: "Wanted" }), item),
      el("label", { className: "setting" }, el("span", { textContent: "Count / reward" }), count, reward),
      el("label", { className: "setting" }, el("span", { textContent: "Deadline" }), hours),
      title,
      ...(officer && guild ? [el("label", { className: "setting" }, el("span", { textContent: `For [${guild.tag}], paid from its treasury` }), forGuild)] : []),
      el("button", { type: "button", onclick: post }, "Post"),
    ];
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
