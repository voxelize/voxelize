export const DEFAULT_BLOCK_MAX_STACK = 64;

export type SlotContent =
  | { type: "empty" }
  | { type: "block"; id: number; count: number }
  | {
      type: "item";
      id: number;
      count: number;
      data?: Record<string, unknown>;
    };

export const emptySlot = (): SlotContent => ({ type: "empty" });

export const blockSlot = (id: number, count: number): SlotContent => ({
  type: "block",
  id,
  count,
});

export const itemSlot = (
  id: number,
  count: number,
  data: Record<string, unknown> = {},
): SlotContent => ({
  type: "item",
  id,
  count,
  data,
});

export const itemSlotWithDurability = (
  id: number,
  count: number,
  durability: number,
): SlotContent => ({
  type: "item",
  id,
  count,
  data: { durability },
});

export function getSlotData<T>(slot: SlotContent, key: string): T | undefined {
  if (slot.type !== "item") return undefined;
  if (!slot.data) return undefined;
  return slot.data[key] as T | undefined;
}

export function setSlotData<T>(
  slot: SlotContent,
  key: string,
  value: T,
): SlotContent {
  if (slot.type !== "item") return slot;
  return {
    ...slot,
    data: { ...(slot.data ?? {}), [key]: value },
  };
}

export function hasSlotData(slot: SlotContent, key: string): boolean {
  if (slot.type !== "item") return false;
  if (!slot.data) return false;
  return key in slot.data;
}

export function getSlotDurability(slot: SlotContent): number | undefined {
  return getSlotData<number>(slot, "durability");
}

/**
 * The part of a slot's data other players may see: only `keys`, and only
 * those it has, or `null` when there is nothing to show. A held object's id
 * says what it is; this says which one (a colour, a variant, a size).
 * Mirrors the server's `SlotContent::peer_data`.
 */
export const peerSlotData = (
  slot: SlotContent,
  keys: readonly string[],
): Record<string, unknown> | null => {
  if (slot.type !== "item" || !slot.data) return null;
  let shown: Record<string, unknown> | null = null;
  for (const key of keys) {
    if (!(key in slot.data)) continue;
    shown ??= {};
    shown[key] = slot.data[key];
  }
  return shown;
};

/** Whether two peer data objects show the same thing (key order aside). */
export const isSamePeerSlotData = (
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean => {
  if (!a || !b) return !a === !b;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) => key in b && JSON.stringify(a[key]) === JSON.stringify(b[key]),
  );
};

export const encodeHeldObject = (slot: SlotContent): number => {
  if (slot.type === "empty") return 0;
  if (slot.type === "block") return slot.id;
  return -slot.id;
};

export const decodeHeldObject = (raw: number): SlotContent => {
  if (raw === 0) return emptySlot();
  if (raw > 0) return blockSlot(raw, 1);
  return itemSlot(-raw, 1);
};
