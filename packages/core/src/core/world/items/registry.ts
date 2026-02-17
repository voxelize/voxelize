import type { World } from "../index";

import { getImageComp, getItemComponent, ImageComp, ItemDef } from "./item";
import {
  ImageItemRenderer,
  ItemRenderer,
  ItemRendererFactory,
} from "./renderer";
import { DEFAULT_BLOCK_MAX_STACK, SlotContent } from "./slot";

export type ImageResolver = (name: string) => string;

function dataEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

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

    for (const item of items) {
      this.itemsById.set(item.id, item);
      this.itemsByName.set(item.name.toLowerCase(), item);
    }
  }

  setRenderer(name: string, factory: ItemRendererFactory): void {
    const normalizedName = name.toLowerCase().replace(/ /g, "-");
    this.rendererFactories.set(normalizedName, factory);
  }

  getRenderer(itemId: number): ItemRenderer | null {
    if (!this.world) return null;

    const existing = this.renderers.get(itemId);
    if (existing) return existing;

    const itemDef = this.itemsById.get(itemId);
    if (!itemDef) return null;

    const normalizedName = itemDef.name.toLowerCase().replace(/ /g, "-");
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
    for (const [id] of this.itemsById) {
      const renderer = this.getRenderer(id);
      if (renderer instanceof ImageItemRenderer) {
        promises.push(renderer.waitForLoad());
      }
    }
    await Promise.all(promises);
  }

  getById(id: number): ItemDef | undefined {
    return this.itemsById.get(id);
  }

  getByName(name: string): ItemDef | undefined {
    return this.itemsByName.get(name.toLowerCase());
  }

  getAll(): ItemDef[] {
    return Array.from(this.itemsById.values());
  }

  getMaxStack(slot: SlotContent): number {
    if (slot.type === "block") return DEFAULT_BLOCK_MAX_STACK;
    if (slot.type === "item") {
      const item = this.getById(slot.id);
      const stackable = getItemComponent<{ maxStack: number }>(
        item,
        "stackable",
      );
      return stackable?.maxStack ?? 1;
    }
    return 0;
  }

  getMaxDurability(itemId: number): number | undefined {
    const item = this.getById(itemId);
    const durable = getItemComponent<{ maxDurability: number }>(
      item,
      "durable",
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
      const aData = a.data;
      const bData = b.data;
      const aHasData = aData && Object.keys(aData).length > 0;
      const bHasData = bData && Object.keys(bData).length > 0;
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
    for (const renderer of this.renderers.values()) {
      renderer.dispose?.();
    }
    this.renderers.clear();
  }
}
