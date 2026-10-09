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
  forkChunkMaterial,
  isOwnTextureFace,
  LightCones,
  loadChunkMaterials,
  LocalLights,
  makeChunkMaterialKey,
  makeOwnFaceTexture,
  Registry,
  setOwnFaceTexture,
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHARED_OPAQUE_MATERIAL_KEY,
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

/** An atlas slot nothing painted, and every block face that samples it. */
export type UnpaintedSlot = {
  block: string;
  face: string;
  group: string | null;
  faces: string[];
};

/** A face with a texture of its own that nothing painted. */
export type UnpaintedFace = {
  block: string;
  face: string;
  group: string | null;
};

/**
 * What the host's texture setup left on the unknown checker, counted the
 * way the game's `World.textureCensus` counts it: atlas slots once each,
 * and own-texture faces (independent faces, isolated faces' defaults).
 */
export type TextureCensus = {
  /** Distinct atlas slots non-empty blocks sample. */
  slots: number;
  painted: number;
  unpainted: number;
  unpaintedSlots: UnpaintedSlot[];
  ownFaces: number;
  unpaintedOwnFaces: UnpaintedFace[];
  /** Paints whose source never loaded, each with its call and error. */
  failures: string[];
  /** Texture calls that named no block, face or texture group the source has. */
  misses: string[];
  /** World members the host's setup used that the facade only absorbs, with call counts. */
  absorbed: Record<string, number>;
};

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

  /** World members the host's setup reached for that the facade does not have, with call counts. */
  readonly absorbed = new Map<string, number>();

  /** Paints whose source never loaded, for the census. */
  readonly failures: string[] = [];

  /** Paints still loading their image: a setup may fire them without awaiting. */
  private inFlight = new Set<Promise<unknown>>();

  /** Blocks a block-level shader took out of their shared material bucket. */
  private customBlockIds = new Set<number>();

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

  hasCustomBlockMaterial(id: number): boolean {
    return this.customBlockIds.has(id);
  }

  /**
   * The game's own block and face shaders (a frame strip that shows one
   * flame, cross-shaded plants, a glow mask), installed the way `World`
   * installs them. Their clocks hold still here, so an animated one shows
   * its first frame.
   */
  customizeMaterialShaders(
    idOrName: number | string,
    faceName: string | null = null,
    data: {
      vertexShader?: string;
      fragmentShader?: string;
      uniforms?: Record<string, Uniform>;
    } = {},
  ) {
    const block = this.getBlockOf(idOrName);
    // Opting out precedes the lookup: a block-level shader lands on the
    // block's own material, never on the bucket it shares.
    if (faceName === null) this.customBlockIds.add(block.id);
    let material = this.getBlockFaceMaterial(block.id, faceName ?? undefined);
    if (!material) {
      throw new Error(
        `Could not find material for block ${block.name} and face ${faceName}`,
      );
    }
    if (
      faceName === null &&
      material === this.chunkRenderer.materials.get(SHARED_OPAQUE_MATERIAL_KEY)
    ) {
      material = forkChunkMaterial(material);
      this.chunkRenderer.materials.set(`${block.id}`, material);
    }
    material.vertexShader =
      data.vertexShader ?? SHADER_LIGHTING_CHUNK_SHADERS.vertex;
    material.fragmentShader =
      data.fragmentShader ?? SHADER_LIGHTING_CHUNK_SHADERS.fragment;
    material.uniforms = { ...material.uniforms, ...data.uniforms };
    material.needsUpdate = true;
    return material;
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

  applyTextureGroup(groupName: string, source: TextureSource) {
    return this.track(
      `applyTextureGroup(${groupName})`,
      this.paintGroup(groupName, source),
    );
  }

  private async paintGroup(groupName: string, source: TextureSource) {
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

  applyBlockTexture(
    idOrName: number | string,
    faceNames: string | string[],
    source: TextureSource,
  ) {
    return this.track(
      `applyBlockTexture(${idOrName}, ${String(faceNames)})`,
      this.paintBlock(idOrName, faceNames, source),
    );
  }

  private async paintBlock(
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
    if (faces.length === 0) {
      this.misses.push(`face ${block.name}:${String(faceNames)}`);
      return;
    }
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
   * Remembers a paint until it lands. One whose source fails is recorded by
   * its call (the game's fire-and-forget paints would leave the checker), so
   * it reaches the census instead of an unhandled rejection; a caller that
   * awaits the paint still sees it reject.
   */
  private track<T>(call: string, paint: Promise<T>): Promise<T> {
    this.inFlight.add(paint);
    void paint
      .catch((error: unknown) => {
        this.failures.push(
          `${call}: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => this.inFlight.delete(paint));
    return paint;
  }

  /**
   * Resolves once every paint the setup started has landed or failed,
   * including those it fired without awaiting.
   */
  async settled() {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /**
   * A stand-in for the game's `World` during its registry setup: the
   * texture calls, shader customizations and lookups above are real,
   * anything else it touches is absorbed (a light profile, a sway table, a
   * clock) and counted, since the viewer neither animates nor lights
   * locally.
   */
  worldFacade(): unknown {
    const absorbed = this.absorbed;
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
      "customizeMaterialShaders",
      "hasCustomBlockMaterial",
    ]);
    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (known.has(property)) {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
        if (typeof property === "string") {
          absorbed.set(property, (absorbed.get(property) ?? 0) + 1);
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
   * How many atlas slots and own-texture faces the setup painted, and every
   * one it left on the unknown checker (they render magenta and black),
   * with the faces that read it.
   */
  textureCensus(): TextureCensus {
    const unknown = AtlasTexture.makeUnknownTexture(
      this.options.textureUnitDimension,
    );
    let painted = 0;
    let ownFaces = 0;
    const unpainted = new Map<string, UnpaintedSlot>();
    const unpaintedOwnFaces: UnpaintedFace[] = [];
    const seen = new Set<string>();
    for (const block of this.registry.blocksById.values()) {
      if (block.isEmpty) continue;
      // The same faces the game's World census walks, so the counts compare.
      for (const face of block.faces) {
        if (isOwnTextureFace(face)) {
          ownFaces += 1;
          const map = this.getBlockFaceMaterial(block.id, face.name)?.map;
          if (!map || map === unknown) {
            unpaintedOwnFaces.push({
              block: block.name,
              face: face.name,
              group: face.textureGroup ?? null,
            });
          }
          continue;
        }
        const key = `${face.range.startU}|${face.range.startV}`;
        const slot = unpainted.get(key);
        if (slot) {
          slot.faces.push(`${block.name}:${face.name}`);
          continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        if (this.atlas?.isRangePainted(face.range)) painted += 1;
        else {
          unpainted.set(key, {
            block: block.name,
            face: face.name,
            group: face.textureGroup ?? null,
            faces: [`${block.name}:${face.name}`],
          });
        }
      }
    }
    return {
      slots: seen.size,
      painted,
      unpainted: unpainted.size,
      unpaintedSlots: [...unpainted.values()],
      ownFaces,
      unpaintedOwnFaces,
      failures: [...this.failures],
      misses: [...this.misses],
      absorbed: Object.fromEntries(this.absorbed),
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
