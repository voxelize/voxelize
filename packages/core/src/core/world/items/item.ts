import { JsonValue } from "../../../types";

export interface ItemDef {
  id: number;
  name: string;
  components: Record<string, JsonValue>;
}

export function getItemComponent<T>(
  item: ItemDef | undefined,
  key: string
): T | undefined {
  if (!item) return undefined;
  return item.components[key] as T | undefined;
}

export function hasItemComponent(
  item: ItemDef | undefined,
  key: string
): boolean {
  if (!item) return false;
  return key in item.components;
}

export interface ImageComp {
  src: string;
  altSrc?: string;
}

export function getImageComp(item: ItemDef | undefined): ImageComp | undefined {
  return getItemComponent<ImageComp>(item, "image");
}
