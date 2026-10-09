/**
 * The engine's own chunk materials, built without a `World`: a
 * `ChunkMaterialHost` over the backend's registry, the atlas laid out from
 * the server's face ranges, and the texture calls a game makes while it
 * sets its registry up (`applyTextureGroups`, `applyBlockTexture`, ...),
 * so a host can run its unchanged setup code against the viewer and get the
 * game's pixels.
 */
import {
  AtlasTexture,
  type AtlasFilteringMode,
  type Block,
  ChunkRenderer,
  type CustomChunkShaderMaterial,
  isOwnTextureFace,
  LightCones,
  loadChunkMaterials,
  LocalLights,
  makeChunkMaterialKey,
  makeOwnFaceTexture,
  Registry,
  setOwnFaceTexture,
} from "@voxelize/core";
import { Color, type Texture, Uniform } from "three";

export type WorldShape = {
  chunkSize: number;
  maxHeight: number;
  subChunks: number;
  maxLightLevel: number;
};

export type MaterialOptions = {
  textureUnitDimension: number;
  blockTextureFiltering: AtlasFilteringMode;
  /** Per-world chunk uniform overrides, as a game's `World` takes them. */
  chunkUniformsOverwrite: Partial<ChunkRenderer["uniforms"]>;
  swayProfileCapacity: number;
};

const DEFAULT_MATERIAL_OPTIONS: MaterialOptions = {
  textureUnitDimension: 16,
  blockTextureFiltering: "nearest",
  chunkUniformsOverwrite: {},
  swayProfileCapacity: 64,
};

type TextureSource = string | Color | HTMLImageElement | Texture;

/** Normalizes the INIT `blocks` record exactly as `World.initialize` does. */
function normalizeBlock(raw: Record<string, unknown>): Block {
  const block = raw as unknown as Block & Record<string, unknown>;
  block.independentFaces = new Set();
  block.isolatedFaces = new Set();
  if (typeof block.lightAttenuation !== "number") block.lightAttenuation = 0;
  if (typeof block.stackGroup !== "number") block.stackGroup = 0;
  if (!Array.isArray(block.coupledParts)) block.coupledParts = [];
  block.isCoupledAnchor = block.isCoupledAnchor === true;
  block.isAnimated = block.isAnimated === true;
  if (typeof block.castsShadow !== "boolean") {
    (block as { castsShadow: boolean | null }).castsShadow = null;
  }
  for (const face of block.faces) {
    if (face.independent) block.independentFaces.add(face.name);
    if (face.isolated) block.isolatedFaces.add(face.name);
  }
  block.isLight =
    ((block.redLightLevel as number) ?? 0) > 0 ||
    ((block.greenLightLevel as number) ?? 0) > 0 ||
    ((block.blueLightLevel as number) ?? 0) > 0;
  return block;
}

export class ViewerMaterials {
  readonly chunkRenderer = new ChunkRenderer();

  readonly lightCones = new LightCones();

  readonly localLights: LocalLights;

  readonly swayProfileTable: Uniform;

  readonly registry = new Registry();

  readonly options: MaterialOptions & WorldShape;

  readonly loader = {
    loadImage: (source: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`could not load ${source}`));
        image.src = source;
      }),
  };

  /** Texture calls that named no known block or face, for the census. */
  readonly misses: string[] = [];

  private atlas: AtlasTexture | null = null;

  constructor(
    blocksByName: Record<string, Record<string, unknown>>,
    shape: WorldShape,
    options: Partial<MaterialOptions> = {},
  ) {
    this.options = { ...DEFAULT_MATERIAL_OPTIONS, ...options, ...shape };
    for (const [name, raw] of Object.entries(blocksByName)) {
      const block = normalizeBlock(raw);
      const lower = name.toLowerCase();
      this.registry.blocksByName.set(lower, block);
      this.registry.blocksById.set(block.id, block);
      this.registry.nameMap.set(lower, block.id);
      this.registry.idMap.set(block.id, lower);
    }
    this.localLights = new LocalLights(
      {},
      () => ({
        chunkSize: shape.chunkSize,
        maxHeight: shape.maxHeight,
        subChunks: shape.subChunks,
        maxLightLevel: shape.maxLightLevel,
      }),
      () => this.registry.blocksById.values(),
    );
    this.swayProfileTable = new Uniform(
      new Float32Array(this.options.swayProfileCapacity * 8),
    );
  }

  /**
   * Builds every chunk material and the atlas. Chunk geometry reaches the
   * viewer in block-space floats (it is merged across sections), so the
   * fixed-point position define is taken back off.
   */
  async build() {
    await loadChunkMaterials(this);
    for (const material of this.chunkRenderer.materials.values()) {
      // Lookup textures a World uploads on its first light pass (the light
      // grid is an integer texture: bound before its first upload, three
      // falls back to a float one and every chunk draw is refused).
      for (const uniform of Object.values(material.uniforms)) {
        const value = (
          uniform as {
            value?: {
              isDataTexture?: boolean;
              version?: number;
              needsUpdate?: boolean;
            };
          }
        ).value;
        if (value?.isDataTexture && value.version === 0)
          value.needsUpdate = true;
      }
      if (material.defines?.POSITION_UNITS_PER_BLOCK !== undefined) {
        const defines = { ...material.defines };
        delete defines.POSITION_UNITS_PER_BLOCK;
        material.defines = defines;
        material.needsUpdate = true;
      }
      if (!this.atlas && material.map instanceof AtlasTexture) {
        this.atlas = material.map;
      }
    }
  }

  hasCustomBlockMaterial(): boolean {
    return false;
  }

  getBlockById(id: number): Block {
    const block = this.registry.blocksById.get(id);
    if (!block) throw new Error(`no block with id ${id}`);
    return block;
  }

  getBlockByName(name: string): Block {
    const block = this.registry.blocksByName.get(name.toLowerCase());
    if (!block) throw new Error(`no block named ${name}`);
    return block;
  }

  getBlockOf(idOrName: number | string): Block {
    return typeof idOrName === "number"
      ? this.getBlockById(idOrName)
      : this.getBlockByName(idOrName);
  }

  private facesOf(block: Block): Block["faces"] {
    const faces = [...block.faces];
    const names = new Set(faces.map((f) => f.name));
    for (const pattern of block.dynamicPatterns ?? []) {
      for (const part of pattern.parts) {
        for (const face of part.faces) {
          if (!names.has(face.name)) {
            names.add(face.name);
            faces.push(face);
          }
        }
      }
    }
    return faces;
  }

  getBlockFacesByFaceNames(
    idOrName: number | string,
    faceNames: string | string[] | RegExp,
  ) {
    const faces = this.facesOf(this.getBlockOf(idOrName));
    if (faceNames === "*") return faces;
    const specs = Array.isArray(faceNames) ? faceNames : [faceNames];
    return faces.filter((face) =>
      specs.some((spec) => new RegExp(spec).test(face.name)),
    );
  }

  getBlockFaceMaterial(idOrName: number | string, faceName?: string) {
    const block = this.getBlockOf(idOrName);
    if (
      faceName &&
      (block.independentFaces.has(faceName) ||
        block.isolatedFaces.has(faceName))
    ) {
      return this.chunkRenderer.materials.get(
        makeChunkMaterialKey(this, block.id, faceName),
      );
    }
    return this.chunkRenderer.materials.get(
      makeChunkMaterialKey(this, block.id),
    );
  }

  private async resolve(
    source: TextureSource,
  ): Promise<Color | HTMLImageElement | Texture> {
    return typeof source === "string" ? this.loader.loadImage(source) : source;
  }

  private paint(
    block: Block,
    face: Block["faces"][number],
    data: Color | HTMLImageElement | Texture,
  ) {
    const material = this.getBlockFaceMaterial(block.id, face.name);
    if (!material) return;
    if (isOwnTextureFace(face)) {
      setOwnFaceTexture(material, makeOwnFaceTexture(data));
      return;
    }
    const atlas = material.map as AtlasTexture;
    atlas.drawImageToRange(face.range, data as never);
    atlas.needsUpdate = true;
  }

  async applyTextureGroup(groupName: string, source: TextureSource) {
    const members: { block: Block; face: Block["faces"][number] }[] = [];
    for (const block of this.registry.blocksById.values()) {
      for (const face of block.faces) {
        if (face.textureGroup === groupName) members.push({ block, face });
      }
    }
    if (members.length === 0) {
      this.misses.push(`group ${groupName}`);
      return;
    }
    const data = await this.resolve(source);
    const shared = members.find(({ face }) => !isOwnTextureFace(face));
    if (shared) this.paint(shared.block, shared.face, data);
    for (const { block, face } of members) {
      if (isOwnTextureFace(face)) this.paint(block, face, data);
    }
  }

  async applyTextureGroups(
    groups: { groupName: string; source: TextureSource }[],
  ) {
    await Promise.all(
      groups.map(({ groupName, source }) =>
        this.applyTextureGroup(groupName, source),
      ),
    );
  }

  async applyBlockTexture(
    idOrName: number | string,
    faceNames: string | string[],
    source: TextureSource,
  ) {
    let block: Block;
    try {
      block = this.getBlockOf(idOrName);
    } catch {
      this.misses.push(`block ${idOrName}`);
      return;
    }
    const faces = this.getBlockFacesByFaceNames(block.id, faceNames);
    if (faces.length === 0) return;
    const data = await this.resolve(source);
    for (const face of faces) this.paint(block, face, data);
  }

  async applyBlockTextures(
    entries: {
      idOrName: number | string;
      faceNames: string | string[];
      source: TextureSource;
    }[],
  ) {
    await Promise.all(
      entries.map((e) =>
        this.applyBlockTexture(e.idOrName, e.faceNames, e.source),
      ),
    );
  }

  /** An animated face shows its first frame: the viewer holds still. */
  async applyBlockFrames(
    idOrName: number | string,
    faceNames: string | string[],
    keyframes: [number, TextureSource][],
  ) {
    const first = keyframes[0]?.[1];
    if (first !== undefined)
      await this.applyBlockTexture(idOrName, faceNames, first);
  }

  /**
   * A stand-in for the game's `World` during its registry setup: the
   * texture calls and lookups above are real, anything else it touches is
   * absorbed (a light profile, a sway table, a shader hook), since the
   * viewer neither animates nor lights locally.
   */
  worldFacade(): unknown {
    const absorber: unknown = new Proxy(function absorbed() {}, {
      get(_, property) {
        if (property === "then") return undefined;
        if (property === Symbol.toPrimitive) return () => 0;
        if (property === Symbol.iterator) return function* () {};
        if (property === "size" || property === "length") return 0;
        return absorber;
      },
      apply: () => absorber,
      construct: () => absorber as object,
      set: () => true,
    });
    const known = new Set<string | symbol>([
      "loader",
      "registry",
      "chunkRenderer",
      "options",
      "applyTextureGroup",
      "applyTextureGroups",
      "applyBlockTexture",
      "applyBlockTextures",
      "applyBlockFrames",
      "getBlockById",
      "getBlockByName",
      "getBlockOf",
      "getBlockFacesByFaceNames",
      "getBlockFaceMaterial",
    ]);
    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (known.has(property)) {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return absorber;
      },
    });
  }

  /** The material a geometry of block `id` (and own-texture `face`) renders with. */
  materialFor(key: string): CustomChunkShaderMaterial | undefined {
    return this.chunkRenderer.materials.get(key);
  }

  /** Material keys for the mesh worker: per block, and per own-texture face. */
  keyTables() {
    const blockKeys: Record<number, string> = {};
    const faceKeys: Record<string, string> = {};
    for (const block of this.registry.blocksById.values()) {
      blockKeys[block.id] = makeChunkMaterialKey(this, block.id);
      for (const face of block.faces) {
        if (isOwnTextureFace(face)) {
          faceKeys[`${block.id}:${face.name}`] = makeChunkMaterialKey(
            this,
            block.id,
            face.name,
          );
        }
      }
    }
    return { blockKeys, faceKeys };
  }

  /**
   * How many atlas slots the setup painted, and which blocks it left on the
   * unknown checker (they render magenta and black).
   */
  textureCensus(): {
    painted: number;
    unpainted: number;
    unpaintedBlocks: string[];
    misses: string[];
  } {
    let painted = 0;
    let unpainted = 0;
    const names = new Set<string>();
    const seen = new Set<string>();
    for (const block of this.registry.blocksById.values()) {
      if (block.isEmpty) continue;
      for (const face of block.faces) {
        if (isOwnTextureFace(face)) continue;
        const key = `${face.range.startU}|${face.range.startV}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (this.atlas?.isRangePainted(face.range)) painted += 1;
        else {
          unpainted += 1;
          names.add(block.name);
        }
      }
    }
    return {
      painted,
      unpainted,
      unpaintedBlocks: [...names].slice(0, 24),
      misses: this.misses.slice(0, 24),
    };
  }

  /** Whether a material draws plants or leaves (the cutout buckets). */
  isCutout(key: string): boolean {
    return key.startsWith("shared-cutout");
  }

  isFluid(key: string): boolean {
    return this.chunkRenderer.materials.get(key)?.userData.isFluid === true;
  }

  /**
   * Linear RGB of each block's top face, averaged over its atlas slot (or
   * its own texture): the colour a column reads as from far away.
   */
  topColors(): Map<number, [number, number, number]> {
    const out = new Map<number, [number, number, number]>();
    const atlas = this.atlas;
    const canvas = atlas?.canvas;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    const pixels =
      canvas && context
        ? context.getImageData(0, 0, canvas.width, canvas.height)
        : null;
    const linear = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    for (const block of this.registry.blocksById.values()) {
      if (block.isEmpty) continue;
      const face =
        block.faces.find(
          (f) => f.dir[1] === 1 && f.dir[0] === 0 && f.dir[2] === 0,
        ) ?? block.faces[0];
      if (!face || !pixels || !canvas || isOwnTextureFace(face)) continue;
      const { startU, endU, startV, endV } = face.range;
      const x0 = Math.floor(startU * canvas.width);
      const x1 = Math.ceil(endU * canvas.width);
      // The atlas is drawn with v up; canvas rows run down.
      const y0 = Math.floor((1 - endV) * canvas.height);
      const y1 = Math.ceil((1 - startV) * canvas.height);
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * canvas.width + x) * 4;
          const a = pixels.data[i + 3] / 255;
          if (a < 0.1) continue;
          r += linear(pixels.data[i]) * a;
          g += linear(pixels.data[i + 1]) * a;
          b += linear(pixels.data[i + 2]) * a;
          w += a;
        }
      }
      if (w > 0) out.set(block.id, [r / w, g / w, b / w]);
    }
    return out;
  }
}
