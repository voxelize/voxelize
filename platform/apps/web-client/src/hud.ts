// Heads-up display: hotbar, mining progress, status line, toasts and the
// crafting panel. Pure DOM; the game feeds it server state.

import { Content, ItemDef, RecipeDef } from "./content";
import { textureCanvas } from "./textures";

export type Slot = { item: number; count: number; durability?: number } | null;
export type InventorySnapshot = { slots: Slot[]; selected: number; realm: string };

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export class Hud {
  private iconCache = new Map<number, string>();
  inventory: InventorySnapshot = { slots: [], selected: 0, realm: "survival" };

  constructor(private readonly content: Content) {}

  show() {
    $("hud").hidden = false;
  }

  private icon(item: ItemDef): string {
    const cached = this.iconCache.get(item.id);
    if (cached) return cached;
    let url: string;
    const block = item.placesBlock ? this.content.pack.blocks.find((b) => b.key === item.placesBlock) : undefined;
    if (block) {
      url = textureCanvas(block.texture.side ?? block.texture.all).toDataURL();
    } else {
      // Non-block items: an original glyph tile from the item key.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext("2d")!;
      let h = 0;
      for (const ch of item.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      ctx.fillStyle = `hsl(${h % 360} 45% 38%)`;
      ctx.fillRect(2, 2, 28, 28);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(item.name.split(" ").map((w) => w[0]).join("").slice(0, 3), 16, 17);
      url = canvas.toDataURL();
    }
    this.iconCache.set(item.id, url);
    return url;
  }

  setInventory(snapshot: InventorySnapshot) {
    this.inventory = snapshot;
    const bar = $("hotbar");
    bar.replaceChildren();
    for (let i = 0; i < 9; i++) {
      const slot = snapshot.slots[i] ?? null;
      const cell = document.createElement("div");
      cell.className = "slot" + (i === snapshot.selected ? " selected" : "");
      const item = slot ? this.content.itemsById.get(slot.item) : undefined;
      if (slot && item) {
        const img = document.createElement("img");
        img.src = this.icon(item);
        img.alt = item.name;
        cell.title = item.name;
        cell.append(img);
        if (slot.count > 1) {
          const count = document.createElement("span");
          count.className = "count";
          count.textContent = String(slot.count);
          cell.append(count);
        }
        if (slot.durability !== undefined && item.durability) {
          const wear = document.createElement("i");
          wear.className = "wear";
          wear.style.width = `${(slot.durability / item.durability) * 100}%`;
          cell.append(wear);
        }
      }
      bar.append(cell);
    }
    this.renderRecipes();
  }

  heldItem(): ItemDef | undefined {
    const slot = this.inventory.slots[this.inventory.selected];
    return slot ? this.content.itemsById.get(slot.item) : undefined;
  }

  setMining(progress: number | null) {
    const box = $("mining");
    box.style.opacity = progress === null ? "0" : "1";
    $("mining-bar").style.width = `${Math.min(1, progress ?? 0) * 100}%`;
  }

  setStatus(text: string) {
    $("status").textContent = text;
  }

  toast(text: string) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = text;
    $("toasts").append(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  // ---- crafting -----------------------------------------------------------

  onCraft: (recipe: RecipeDef) => void = () => {};

  get craftingOpen() {
    return !$("crafting").hidden;
  }

  toggleCrafting(open = !this.craftingOpen) {
    $("crafting").hidden = !open;
    if (open) this.renderRecipes();
  }

  private owned(key: string): number {
    const item = this.content.itemsByKey.get(key);
    if (!item) return 0;
    return this.inventory.slots.reduce((n, s) => n + (s && s.item === item.id ? s.count : 0), 0);
  }

  private renderRecipes() {
    if (!this.craftingOpen) return;
    const list = $("recipes");
    list.replaceChildren();
    for (const recipe of this.content.pack.recipes) {
      const needs = this.content.recipeNeeds(recipe);
      const result = this.content.itemsByKey.get(recipe.result.item);
      if (!result) continue;
      const ready = [...needs].every(([key, n]) => this.owned(key) >= n);
      const li = document.createElement("li");
      li.className = ready ? "ready" : "";
      const label = [...needs]
        .map(([key, n]) => `${n}× ${this.content.itemsByKey.get(key)?.name ?? key}`)
        .join(", ");
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !ready;
      button.textContent = `${result.name}${(recipe.result.count ?? 1) > 1 ? ` ×${recipe.result.count}` : ""}`;
      button.addEventListener("click", () => this.onCraft(recipe));
      const needsText = document.createElement("span");
      needsText.textContent = label;
      li.append(button, needsText);
      list.append(li);
    }
  }
}
