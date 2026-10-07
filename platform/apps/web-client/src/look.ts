// What players wear, as data: the colours a look paints, checking looks
// that come over the network, and wardrobe lines. No engine code here, so
// it is tested without a browser.

import type { Cosmetic, Look, Wardrobe } from "./api";

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

/** A cosmetic's line in the wardrobe: "Crown · 250 CRN". */
export function cosmeticLine(c: Cosmetic, w: Pick<Wardrobe, "owned" | "equipped" | "currency">): string {
  if (w.equipped[c.slot] === c.key) return `${c.name} · worn`;
  if (w.owned.includes(c.key)) return `${c.name} · owned`;
  return `${c.name} · ${c.price} ${w.currency}`;
}

