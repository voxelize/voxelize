// Heads-up display: hotbar, mining progress, status line, toasts and the
// crafting panel. Pure DOM; the game feeds it server state.

import { Content, ItemDef } from "./content";
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

  icon(item: ItemDef): string {
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

}

export type Vitals = {
  health: number;
  food: number;
  air: number;
  maxAir: number;
  dead: boolean;
  cause: string | null;
  realm: string;
};

const CAUSES: Record<string, string> = {
  fall: "You fell from a high place.",
  drowning: "You ran out of air.",
  lava: "You tried to swim in lava.",
  starvation: "You starved.",
};

function pips(id: string, value: number, count: number, perPip: number, reverse = false) {
  const box = document.getElementById(id) as HTMLElement;
  box.replaceChildren();
  for (let i = 0; i < count; i++) {
    const index = reverse ? count - 1 - i : i;
    const fill = value - index * perPip;
    const pip = document.createElement("i");
    pip.className = "pip" + (fill >= perPip ? " full" : fill > 0 ? " half" : "");
    box.append(pip);
  }
}

export class VitalsHud {
  private last: Vitals | null = null;
  onRespawn: () => void = () => {};

  constructor() {
    document.getElementById("respawn")?.addEventListener("click", () => this.onRespawn());
  }

  set(v: Vitals) {
    const survival = v.realm === "survival";
    (document.getElementById("vitals") as HTMLElement).hidden = !survival;
    pips("health", v.health, 10, 2);
    pips("food", v.food, 10, 2, true);
    const air = document.getElementById("air") as HTMLElement;
    air.hidden = v.air >= v.maxAir;
    pips("air", v.air, 10, v.maxAir / 10, true);

    if (this.last && v.health < this.last.health) {
      const hurt = document.getElementById("hurt") as HTMLElement;
      hurt.classList.add("on");
      setTimeout(() => hurt.classList.remove("on"), 120);
    }
    const death = document.getElementById("death") as HTMLElement;
    death.hidden = !v.dead;
    if (v.dead) {
      (document.getElementById("death-cause") as HTMLElement).textContent =
        (v.cause && CAUSES[v.cause]) || "";
    }
    this.last = v;
  }

  get dead() {
    return this.last?.dead ?? false;
  }
}
