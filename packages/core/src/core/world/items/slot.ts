import { JsonValue } from "../../../types";

export const DEFAULT_BLOCK_MAX_STACK = 64;

export type SlotContent =
  | { type: "empty" }
  | { type: "block"; id: number; count: number }
  | {
      type: "item";
      id: number;
      count: number;
      data?: Record<string, JsonValue>;
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
  data: Record<string, JsonValue> = {}
): SlotContent => ({
  type: "item",
  id,
  count,
  data,
});

export const itemSlotWithDurability = (
  id: number,
  count: number,
  durability: number
): SlotContent => ({
  type: "item",
  id,
  count,
  data: { durability },
});

export function getSlotData<T extends JsonValue>(
  slot: SlotContent,
  key: string
): T | undefined {
  if (slot.type !== "item") return undefined;
  if (!slot.data) return undefined;
  return slot.data[key] as T | undefined;
}

export function setSlotData<T extends JsonValue>(
  slot: SlotContent,
  key: string,
  value: T
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
