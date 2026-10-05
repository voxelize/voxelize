// The item window: inventory screen (2x2 crafting, armor, offhand),
// workbench, furnace and chest. Every click is sent to the server, which
// answers with the authoritative window; the UI only renders that.

import { Content, ItemDef } from "./content";
import { Hud, Slot } from "./hud";
import { recipeFits } from "./recipes";

export type WindowKind = "player" | "workbench" | "furnace" | "chest";

export type WindowState = {
  kind: WindowKind | null;
  open?: boolean;
  at?: [number, number, number] | null;
  slots: Slot[];
  rules: string[];
  inventoryStart: number;
  grid: [number, number] | null;
  cursor: Slot;
  /** A fueled station (furnace, smelter, crusher): which one and how far along. */
  furnace: { station?: string; name?: string; burnLeft: number; burnTotal: number; progress: number; progressTotal: number } | null;
};

export type ClickType =
  | { type: "left" }
  | { type: "right" }
  | { type: "shift" }
  | { type: "double" }
  | { type: "hotbar"; key: number }
  | { type: "drop"; all: boolean };

export type WindowActions = {
  click: (slot: number, click: ClickType) => void;
  drag: (slots: number[], oneEach: boolean) => void;
  fill: (recipe: string, max: boolean) => void;
  close: () => void;
  /** Creative only: a full stack of an item into the selected hotbar slot. */
  creative?: (item: string) => void;
};

/** Items whose name or key contains `query` (case-insensitive), in pack order. */
export function paletteMatches<T extends { key: string; name: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.key.includes(q)) : items;
}

const TITLES: Record<WindowKind, string> = {
  player: "Inventory",
  workbench: "Workbench",
  furnace: "Furnace",
  chest: "Storage Chest",
};

/** The window's heading; fueled stations name themselves (Smelter, Crusher). */
export function windowTitle(kind: WindowKind, furnace: WindowState["furnace"]): string {
  return kind === "furnace" && furnace?.name ? furnace.name : TITLES[kind];
}

export class WindowUi {
  readonly root: HTMLElement;
  private state: WindowState | null = null;
  private cursorEl: HTMLElement;
  private tooltip: HTMLElement;
  private hovered: number | null = null;
  private dragging: { button: number; slots: number[] } | null = null;
  private lastClick = { slot: -1, time: 0 };

  constructor(
    private readonly content: Content,
    private readonly hud: Hud,
    private readonly actions: WindowActions,
  ) {
    this.root = document.createElement("section");
    this.root.id = "window";
    this.root.className = "panel";
    this.root.hidden = true;
    document.body.append(this.root);
    this.cursorEl = document.createElement("div");
    this.cursorEl.id = "cursor-stack";
    document.body.append(this.cursorEl);
    this.tooltip = document.createElement("div");
    this.tooltip.id = "item-tooltip";
    document.body.append(this.tooltip);

    addEventListener("mousemove", (e) => {
      this.cursorEl.style.transform = `translate(${e.clientX - 18}px, ${e.clientY - 18}px)`;
      this.tooltip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 8}px)`;
    });
    addEventListener("mouseup", () => this.endDrag());
    addEventListener("keydown", (e) => {
      if (!this.isOpen || this.hovered === null) return;
      if (e.code.startsWith("Digit")) {
        const key = Number(e.code.slice(5)) - 1;
        if (key >= 0 && key < 9) this.actions.click(this.hovered, { type: "hotbar", key });
      } else if (e.code === "KeyQ") {
        this.actions.click(this.hovered, { type: "drop", all: e.ctrlKey });
      }
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  hide() {
    this.root.hidden = true;
    this.cursorEl.replaceChildren();
    this.tooltip.hidden = true;
    this.state = null;
  }

  set(state: WindowState) {
    if (!state.kind || (state.kind === "player" && !state.open && !this.isOpen && !this.wantPlayer)) {
      if (!state.kind) this.hide();
      return;
    }
    this.state = state;
    this.root.hidden = false;
    this.render();
  }

  /** Set by the game when E opens the inventory screen. */
  wantPlayer = false;

  private slotEl(index: number, extraClass = ""): HTMLElement {
    const state = this.state!;
    const el = document.createElement("div");
    el.className = `wslot ${extraClass}`;
    el.dataset.slot = String(index);
    const stack = state.slots[index];
    const item = stack ? this.content.itemsById.get(stack.item) : undefined;
    if (stack && item) {
      el.append(this.stackEl(item, stack.count, stack.durability));
    }
    el.addEventListener("mousedown", (e) => this.onDown(e, index));
    el.addEventListener("mouseenter", () => {
      this.hovered = index;
      if (this.dragging && !this.dragging.slots.includes(index)) {
        this.dragging.slots.push(index);
        el.classList.add("dragged");
      }
      this.tooltip.hidden = !item;
      if (item) this.tooltip.textContent = this.describe(item, stack!);
    });
    el.addEventListener("mouseleave", () => {
      this.hovered = null;
      this.tooltip.hidden = true;
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    return el;
  }

  private describe(item: ItemDef, stack: NonNullable<Slot>): string {
    const lines = [item.name];
    if (item.tool) lines.push(`${item.tool.kind}, tier ${item.tool.tier}`);
    if (stack.durability !== undefined && item.durability) lines.push(`Durability ${stack.durability}/${item.durability}`);
    return lines.join(" · ");
  }

  private stackEl(item: ItemDef, count: number, durability?: number): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "stack";
    const img = document.createElement("img");
    img.src = this.hud.icon(item);
    img.alt = item.name;
    wrap.append(img);
    if (count > 1) {
      const c = document.createElement("span");
      c.className = "count";
      c.textContent = String(count);
      wrap.append(c);
    }
    if (durability !== undefined && item.durability) {
      const w = document.createElement("i");
      w.className = "wear";
      w.style.width = `${(durability / item.durability) * 100}%`;
      wrap.append(w);
    }
    return wrap;
  }

  private onDown(e: MouseEvent, index: number) {
    e.preventDefault();
    const state = this.state!;
    const now = performance.now();
    if (e.button === 0 && this.lastClick.slot === index && now - this.lastClick.time < 300 && state.cursor) {
      this.actions.click(index, { type: "double" });
      this.lastClick = { slot: -1, time: 0 };
      return;
    }
    this.lastClick = { slot: index, time: now };
    if (e.shiftKey) {
      this.actions.click(index, { type: "shift" });
      return;
    }
    if (state.cursor && state.rules[index] !== "craft_result") {
      // May become a drag across several slots.
      this.dragging = { button: e.button, slots: [index] };
      return;
    }
    this.actions.click(index, { type: e.button === 2 ? "right" : "left" });
  }

  private endDrag() {
    const drag = this.dragging;
    this.dragging = null;
    if (!drag) return;
    if (drag.slots.length > 1) this.actions.drag(drag.slots, drag.button === 2);
    else this.actions.click(drag.slots[0], { type: drag.button === 2 ? "right" : "left" });
  }

  private render() {
    const state = this.state!;
    const kind = state.kind!;
    const root = this.root;
    root.replaceChildren();
    root.dataset.kind = kind;

    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.textContent = windowTitle(kind, state.furnace);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "link";
    close.textContent = "Close (Esc)";
    close.addEventListener("click", () => this.actions.close());
    header.append(title, close);
    root.append(header);

    const top = document.createElement("div");
    top.className = "wtop";
    const inv = state.inventoryStart;

    if (kind === "player" || kind === "workbench") {
      if (kind === "player") {
        const armor = document.createElement("div");
        armor.className = "armor";
        ["Head", "Body", "Legs", "Feet"].forEach((label, i) => {
          const s = this.slotEl(5 + i, "armor-slot");
          s.title = label;
          armor.append(s);
        });
        const off = this.slotEl(9, "offhand");
        off.title = "Off hand";
        armor.append(off);
        top.append(armor);
      }
      const [start, size] = state.grid!;
      const grid = document.createElement("div");
      grid.className = `grid g${size}`;
      for (let i = 0; i < size * size; i++) grid.append(this.slotEl(start + i));
      const arrow = document.createElement("div");
      arrow.className = "arrow";
      arrow.textContent = "→";
      top.append(grid, arrow, this.slotEl(0, "result"));
      top.append(kind === "player" && this.hud.inventory.realm === "creative" && this.actions.creative ? this.palette() : this.recipeBook(size));
    } else if (kind === "furnace") {
      const f = state.furnace;
      const col = document.createElement("div");
      col.className = "furnace";
      const flame = document.createElement("div");
      flame.className = "flame";
      flame.style.setProperty("--fill", f && f.burnTotal ? String(f.burnLeft / f.burnTotal) : "0");
      col.append(this.slotEl(0), flame, this.slotEl(1));
      const arrow = document.createElement("div");
      arrow.className = "progress-arrow";
      arrow.style.setProperty("--fill", f && f.progressTotal ? String(f.progress / f.progressTotal) : "0");
      top.append(col, arrow, this.slotEl(2, "result"));
    } else {
      const chest = document.createElement("div");
      chest.className = "grid g9";
      for (let i = 0; i < inv; i++) chest.append(this.slotEl(i));
      top.append(chest);
    }
    root.append(top);

    const main = document.createElement("div");
    main.className = "grid g9 inventory";
    for (let i = 9; i < 36; i++) main.append(this.slotEl(inv + i));
    const hotbar = document.createElement("div");
    hotbar.className = "grid g9 inventory hotbar-row";
    for (let i = 0; i < 9; i++) hotbar.append(this.slotEl(inv + i));
    root.append(main, hotbar);

    this.cursorEl.replaceChildren();
    const held = state.cursor ? this.content.itemsById.get(state.cursor.item) : undefined;
    if (state.cursor && held) this.cursorEl.append(this.stackEl(held, state.cursor.count, state.cursor.durability));
  }

  private paletteQuery = "";

  /** Creative worlds: every item, a click puts a stack in the selected hotbar slot. */
  private palette(): HTMLElement {
    const box = document.createElement("div");
    box.className = "recipe-book palette";
    const heading = document.createElement("h3");
    heading.textContent = "All items";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search";
    search.value = this.paletteQuery;
    const list = document.createElement("ul");
    const fill = () => {
      list.replaceChildren();
      for (const item of paletteMatches(this.content.pack.items, this.paletteQuery)) {
        const li = document.createElement("li");
        li.title = item.name;
        li.append(this.stackEl(item, 1));
        li.addEventListener("click", () => this.actions.creative?.(item.key));
        list.append(li);
      }
    };
    search.addEventListener("input", () => {
      this.paletteQuery = search.value;
      fill();
    });
    fill();
    box.append(heading, search, list);
    return box;
  }

  private recipeBook(size: number): HTMLElement {
    const state = this.state!;
    const book = document.createElement("div");
    book.className = "recipe-book";
    const heading = document.createElement("h3");
    heading.textContent = "Recipes";
    book.append(heading);
    const owned = new Map<string, number>();
    state.slots.slice(state.inventoryStart).forEach((s) => {
      const item = s ? this.content.itemsById.get(s.item) : undefined;
      if (item && s) owned.set(item.key, (owned.get(item.key) ?? 0) + s.count);
    });
    const list = document.createElement("ul");
    for (const recipe of this.content.pack.recipes) {
      if (!recipeFits(recipe, size)) continue;
      const result = this.content.itemsByKey.get(recipe.result.item);
      if (!result) continue;
      const needs = this.content.recipeNeeds(recipe);
      const ready = [...needs].every(([k, n]) => (owned.get(k) ?? 0) >= n);
      const li = document.createElement("li");
      li.className = ready ? "ready" : "";
      li.title = [...needs].map(([k, n]) => `${n}× ${this.content.itemsByKey.get(k)?.name ?? k}`).join(", ");
      li.append(this.stackEl(result, recipe.result.count ?? 1));
      li.addEventListener("click", (e) => this.actions.fill(recipe.key, e.shiftKey));
      list.append(li);
    }
    book.append(list);
    return book;
  }
}
