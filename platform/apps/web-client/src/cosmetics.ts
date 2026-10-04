// Cosmetics: the wardrobe (K) to buy and wear outfits and hats, and painting
// what players wear onto their characters. The backend sells and equips;
// the look reaches the game server in a fresh game ticket, and the server
// tells everyone (`platform.look`).

import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";

import { api, ApiError, type Cosmetic, type CosmeticSlot, type Look, type Wardrobe } from "./api";

/** The engine's default character colours, worn when nothing is. */
export const BASE_LOOK = { head: "#96baff", face: "#f99999", body: "#2b2e42", arms: "#548ca8", legs: "#96baff" } as const;

/** The colours a character is painted with for a look. */
export function lookColors(look: Look | null | undefined) {
  return {
    body: look?.outfit?.body ?? BASE_LOOK.body,
    arms: look?.outfit?.arms ?? BASE_LOOK.arms,
    legs: look?.outfit?.legs ?? BASE_LOOK.legs,
    hat: look?.hat ?? null,
  };
}

const colour = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);

/** A look from the network, keeping only what is well formed. */
export function sanitizeLook(raw: unknown): Look | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { outfit?: Record<string, unknown>; hat?: Record<string, unknown> };
  const look: Look = {};
  if (r.outfit && colour(r.outfit.body) && colour(r.outfit.arms) && colour(r.outfit.legs)) {
    look.outfit = { body: r.outfit.body, arms: r.outfit.arms, legs: r.outfit.legs };
  }
  if (r.hat && (r.hat.art === "crown" || colour(r.hat.color))) {
    look.hat = r.hat.art === "crown" ? { art: "crown" } : { color: r.hat.color as string };
  }
  return look.outfit || look.hat ? look : null;
}

/** A band of colour round the top of the head, and its top: a cap. */
const capArt =
  (color: string): VOXELIZE.ArtFunction =>
  (context, canvas) => {
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, Math.max(1, Math.round(canvas.height * 0.3)));
  };

/** The engine's 8-pixel crown, stretched across a face of the head. */
const crownArt: VOXELIZE.ArtFunction = (context, canvas) => {
  context.save();
  context.scale(canvas.width / 8, canvas.width / 8);
  VOXELIZE.artFunctions.drawCrown(context, canvas);
  context.restore();
};

/** Paint a look onto a character (or what it wore back to the defaults). */
export function applyLook(character: VOXELIZE.Character, look: Look | null | undefined) {
  const c = lookColors(look);
  character.bodyColor = c.body;
  character.armColor = c.arms;
  character.legColor = c.legs;
  character.headColor = BASE_LOOK.head;
  character.faceColor = BASE_LOOK.face;
  if (c.hat?.art === "crown") {
    character.head.paint("sides", crownArt);
    character.head.paint("top", new THREE.Color("#f7ea00"));
  } else if (c.hat?.color) {
    character.head.paint("sides", capArt(c.hat.color));
    character.head.paint("top", new THREE.Color(c.hat.color));
  }
}

/** A cosmetic's line in the wardrobe: "Crown · 250 CRN". */
export function cosmeticLine(c: Cosmetic, w: Pick<Wardrobe, "owned" | "equipped" | "currency">): string {
  if (w.equipped[c.slot] === c.key) return `${c.name} · worn`;
  if (w.owned.includes(c.key)) return `${c.name} · owned`;
  return `${c.name} · ${c.price} ${w.currency}`;
}

const WARDROBE_ERRORS: Record<string, string> = {
  insufficient_funds: "Not enough Crowns",
  not_owned: "Buy it first",
  bad_ticket: "Could not change your look; try again",
};

export class WardrobePanel {
  readonly root: HTMLElement;
  private wardrobe: Wardrobe | null = null;

  constructor(private readonly actions: { notify: (text: string) => void; dressed: (look: Look | null) => Promise<void> }) {
    this.root = document.createElement("section");
    this.root.id = "wardrobe";
    this.root.className = "panel";
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (this.isOpen) void this.refresh();
  }

  private async refresh() {
    try {
      this.wardrobe = await api.cosmetics.get();
    } catch {
      this.actions.notify("The wardrobe is closed: the server cannot be reached");
    }
    this.render();
  }

  private async act(run: () => Promise<Wardrobe>, dress: boolean, done?: string) {
    try {
      this.wardrobe = await run();
      if (dress) await this.actions.dressed(this.wardrobe.look);
      if (done) this.actions.notify(done);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : (e as { code?: string })?.code ?? "";
      this.actions.notify(WARDROBE_ERRORS[code] ?? "Could not reach the server");
    }
    this.render();
  }

  private render() {
    const h = (tag: string, text: string) => Object.assign(document.createElement(tag), { textContent: text });
    const button = (text: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.addEventListener("click", onClick);
      return b;
    };
    const w = this.wardrobe;
    const nodes: Node[] = [h("h2", "Wardrobe")];
    for (const [slot, title] of [
      ["outfit", "Outfits"],
      ["hat", "Hats"],
    ] as [CosmeticSlot, string][]) {
      nodes.push(h("h3", title));
      const list = document.createElement("ul");
      list.className = "cosmetic-list";
      for (const c of w?.catalog.filter((c) => c.slot === slot) ?? []) {
        const li = document.createElement("li");
        const swatch = h("span", "");
        swatch.className = "swatch";
        swatch.style.background = "body" in c.look ? c.look.body : (c.look.color ?? "#f7ea00");
        li.append(swatch, cosmeticLine(c, w!), " ");
        if (w!.equipped[slot] === c.key) li.append(button("Take off", () => void this.act(() => api.cosmetics.wear(slot, null), true)));
        else if (w!.owned.includes(c.key)) li.append(button("Wear", () => void this.act(() => api.cosmetics.wear(slot, c.key), true)));
        else li.append(button("Buy", () => void this.act(() => api.cosmetics.buy(c.key), false, `Bought: ${c.name}`)));
        list.append(li);
      }
      nodes.push(list);
    }
    nodes.push(button("Done", () => (this.root.hidden = true)));
    this.root.replaceChildren(...nodes);
  }
}
