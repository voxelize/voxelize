import type { World } from "../index";
import { JsonValue } from "../../../types";

import { getImageComp, getItemComponent, ImageComp, ItemDef } from "./item";
import {
  ImageItemRenderer,
  ItemRenderer,
  ItemRendererFactory,
} from "./renderer";
import { DEFAULT_BLOCK_MAX_STACK, SlotContent } from "./slot";

export type ImageResolver = (name: string) => string;

function dataEqual(
  a: Record<string, JsonValue> | undefined,
  b: Record<string, JsonValue> | undefined
): boolean {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  const hasOwn = Object.prototype.hasOwnProperty;
  let keysInA = 0;
  for (const key in a) {
    if (!hasOwn.call(a, key)) {
      continue;
    }
    keysInA++;
    if (!hasOwn.call(b, key) || a[key] !== b[key]) return false;
  }
  let keysInB = 0;
  for (const key in b) {
    if (!hasOwn.call(b, key)) {
      continue;
    }
    keysInB++;
  }
  return keysInA === keysInB;
}

function hasData<T extends object>(data: T | undefined): boolean {
  if (!data) {
    return false;
  }

  const hasOwn = Object.prototype.hasOwnProperty;
  for (const key in data) {
    if (hasOwn.call(data, key)) {
      return true;
    }
  }

  return false;
}

const normalizeLookupName = (name: string): string => {
  const length = name.length;
  for (let index = 0; index < length; index++) {
    const code = name.charCodeAt(index);
    if (code >= 65 && code <= 90) {
      return name.toLowerCase();
    }
  }
  return name;
};

const normalizeRendererName = (name: string): string => {
  const length = name.length;
  let hasUppercase = false;
  let hasWhitespace = false;
  for (let index = 0; index < length; index++) {
    const code = name.charCodeAt(index);
    if (code >= 65 && code <= 90) {
      hasUppercase = true;
    } else if (code === 32) {
      hasWhitespace = true;
    }
  }

  if (!hasUppercase && !hasWhitespace) {
    return name;
  }

  const normalizedCase = hasUppercase ? name.toLowerCase() : name;
  return hasWhitespace ? normalizedCase.replaceAll(" ", "-") : normalizedCase;
};

export class ItemRegistry {
  private itemsById = new Map<number, ItemDef>();
  private itemsByName = new Map<string, ItemDef>();
  private rendererFactories = new Map<string, ItemRendererFactory>();
  private renderers = new Map<number, ItemRenderer>();
  private world: World | null = null;
  private imageResolver: ImageResolver | null = null;

  setWorld(world: World): void {
    this.world = world;
  }

  setImageResolver(resolver: ImageResolver): void {
    this.imageResolver = resolver;
  }

  resolveImage(name: string): string {
    if (this.imageResolver) {
      return this.imageResolver(name);
    }
    return name;
  }

  getResolvedImageComp(itemDef: ItemDef): ImageComp | undefined {
    const imageComp = getImageComp(itemDef);
    if (!imageComp) return undefined;
    return {
      src: this.resolveImage(imageComp.src),
      altSrc: imageComp.altSrc
        ? this.resolveImage(imageComp.altSrc)
        : undefined,
    };
  }

  initialize(items: ItemDef[]): void {
    this.itemsById.clear();
    this.itemsByName.clear();
    this.renderers.clear();

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      this.itemsById.set(item.id, item);
      this.itemsByName.set(normalizeLookupName(item.name), item);
    }
  }

  setRenderer(name: string, factory: ItemRendererFactory): void {
    const normalizedName = normalizeRendererName(name);
    this.rendererFactories.set(normalizedName, factory);
  }

  getRenderer(itemId: number): ItemRenderer | null {
    if (!this.world) return null;

    const existing = this.renderers.get(itemId);
    if (existing) return existing;

    const itemDef = this.itemsById.get(itemId);
    if (!itemDef) return null;

    const normalizedName = normalizeRendererName(itemDef.name);
    const factory = this.rendererFactories.get(normalizedName);

    let renderer: ItemRenderer;
    if (factory) {
      renderer = factory(itemDef, this.world);
    } else {
      renderer = new ImageItemRenderer(itemDef, this.world);
    }

    this.renderers.set(itemId, renderer);
    return renderer;
  }

  async waitForRenderers(): Promise<void> {
    const promises: Promise<void>[] = [];
    let itemIds = this.itemsById.keys();
    let itemId = itemIds.next();
    while (!itemId.done) {
      const renderer = this.getRenderer(itemId.value);
      if (renderer instanceof ImageItemRenderer) {
        promises.push(renderer.waitForLoad());
      }
      itemId = itemIds.next();
    }
    await Promise.all(promises);
  }

  getById(id: number): ItemDef | undefined {
    return this.itemsById.get(id);
  }

  getByName(name: string): ItemDef | undefined {
    return this.itemsByName.get(normalizeLookupName(name));
  }

  getAll(): ItemDef[] {
    const items = new Array<ItemDef>(this.itemsById.size);
    let index = 0;
    let itemEntries = this.itemsById.values();
    let itemEntry = itemEntries.next();
    while (!itemEntry.done) {
      items[index] = itemEntry.value;
      index++;
      itemEntry = itemEntries.next();
    }
    return items;
  }

  getMaxStack(slot: SlotContent): number {
    if (slot.type === "block") return DEFAULT_BLOCK_MAX_STACK;
    if (slot.type === "item") {
      const item = this.getById(slot.id);
      const stackable = getItemComponent<{ maxStack: number }>(
        item,
        "stackable"
      );
      return stackable?.maxStack ?? 1;
    }
    return 0;
  }

  getMaxDurability(itemId: number): number | undefined {
    const item = this.getById(itemId);
    const durable = getItemComponent<{ maxDurability: number }>(
      item,
      "durable"
    );
    return durable?.maxDurability;
  }

  canStack(a: SlotContent, b: SlotContent): boolean {
    if (a.type !== b.type) return false;
    if (a.type === "empty") return false;
    if (a.type === "block" && b.type === "block") return a.id === b.id;
    if (a.type === "item" && b.type === "item") {
      if (a.id !== b.id) return false;
      if (this.getMaxStack(a) <= 1) return false;
      const aHasData = hasData(a.data);
      const bHasData = hasData(b.data);
      if (aHasData || bHasData) return false;
      return true;
    }
    return false;
  }

  slotsEqual(a: SlotContent, b: SlotContent): boolean {
    if (a === b) return true;
    if (a.type !== b.type) return false;
    if (a.type === "empty") return true;
    if (a.type === "block" && b.type === "block") {
      return a.id === b.id && a.count === b.count;
    }
    if (a.type === "item" && b.type === "item") {
      return a.id === b.id && a.count === b.count && dataEqual(a.data, b.data);
    }
    return false;
  }

  disposeRenderers(): void {
    let rendererEntries = this.renderers.values();
    let rendererEntry = rendererEntries.next();
    while (!rendererEntry.done) {
      rendererEntry.value.dispose?.();
      rendererEntry = rendererEntries.next();
    }
    this.renderers.clear();
  }
}
