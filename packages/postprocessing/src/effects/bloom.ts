import {
  type ComputeNode,
  HalfFloatType,
  NodeMaterial,
  QuadMesh,
  type Renderer,
  RenderTarget,
  StorageTexture,
  type Texture,
} from "three/webgpu";
import {
  clamp,
  Fn,
  float,
  globalId,
  If,
  int,
  mix,
  screenUV,
  smoothstep,
  texture,
  textureStore,
  uvec2,
  vec2,
  vec4,
} from "three/tsl";

import { Effect, type EffectInputs } from "../effect";
import {
  floatUniform,
  luminance,
  textureInput,
  vec2Uniform,
  type Vec2Node,
  type Vec4Node,
} from "../nodes";

type TextureNode = ReturnType<typeof textureInput>;

export type BloomOptions = {
  /** Luminance below which nothing blooms. */
  luminanceThreshold: number;
  /** The ramp above the threshold over which a pixel blooms in. */
  luminanceSmoothing: number;
  /** Scale on the bloom added. */
  intensity: number;
  /** How far the blur spreads, 0..1: each level's share of the coarser one. */
  radius: number;
  /** Mip levels of the blur, each half the size of the one before. */
  levels: number;
};

const DEFAULT_BLOOM: BloomOptions = {
  luminanceThreshold: 0.9,
  luminanceSmoothing: 0.025,
  intensity: 1,
  radius: 0.85,
  levels: 8,
};

type BlurLevel = { target: RenderTarget; storage: StorageTexture };

/** Threads a side of a compute level's workgroup. */
const TILE = 8;

/** One compute level: its kernel and the sizes it is dispatched for. */
type ComputeLevel = {
  kernel: ComputeNode;
  /** The written level's size in texels. */
  size: ReturnType<typeof vec2Uniform>;
  /** One texel of the level it reads. */
  texel: ReturnType<typeof vec2Uniform>;
  output: StorageTexture;
  /** The level it reads (null: the frame, `luminanceInput`). */
  input: StorageTexture | null;
};

/**
 * Bloom by mipmap blur (pmndrs postprocessing's `BloomEffect` with
 * `mipmapBlur`, ported): the frame's bright part (a luminance high pass at
 * full size), downsampled level by level with a 13-tap filter, then
 * upsampled back with a 9-tap tent, each level mixed into the finer one by
 * `radius`; the half-size result is screened onto the frame.
 *
 * On WebGPU every level is a compute kernel writing a storage texture, the
 * whole chain dispatched in one `compute` call: one queue submission where
 * a full-screen draw per level was sixteen, each ~0.1 ms of the GPU
 * process's time (`Queue::Submit`), which bound light scenes' frames. A
 * backend without compute draws the levels as before.
 */
export class BloomEffect extends Effect {
  readonly threshold: ReturnType<typeof floatUniform>;
  readonly smoothing: ReturnType<typeof floatUniform>;
  readonly intensity: ReturnType<typeof floatUniform>;
  readonly radius: ReturnType<typeof floatUniform>;

  private readonly luminanceTarget: RenderTarget;
  private readonly luminanceStorage: StorageTexture;
  /** The chain as compute kernels, made on the first WebGPU update. */
  private computeChain: ComputeLevel[] | null = null;
  private isComputeChecked = false;
  private size = { width: 1, height: 1 };
  private readonly down: BlurLevel[] = [];
  private readonly up: BlurLevel[] = [];

  private readonly luminanceInput = textureInput();
  private readonly downInput = textureInput();
  private readonly upInput = textureInput();
  private readonly upSupport = textureInput();
  private readonly downTexel = vec2Uniform();
  private readonly upTexel = vec2Uniform();
  private readonly bloom = textureInput();

  private readonly luminancePass: QuadMesh;
  private readonly downPass: QuadMesh;
  private readonly upPass: QuadMesh;

  constructor(options: Partial<BloomOptions> = {}) {
    super("bloom", "screen");
    const o = { ...DEFAULT_BLOOM, ...options };
    this.threshold = floatUniform(o.luminanceThreshold);
    this.smoothing = floatUniform(o.luminanceSmoothing);
    this.intensity = floatUniform(o.intensity);
    this.radius = floatUniform(o.radius);

    const target = (name: string) => {
      const t = new RenderTarget(1, 1, {
        type: HalfFloatType,
        depthBuffer: false,
        generateMipmaps: false,
      });
      t.texture.name = name;
      return t;
    };
    const storage = (name: string) => {
      const t = new StorageTexture(1, 1);
      t.type = HalfFloatType;
      t.generateMipmaps = false;
      t.name = name;
      return t;
    };
    this.luminanceTarget = target("Bloom.luminance");
    this.luminanceStorage = storage("Bloom.luminance");
    for (let i = 0; i < o.levels; i++) {
      this.down.push({
        target: target(`Bloom.down${i}`),
        storage: storage(`Bloom.down${i}`),
      });
    }
    for (let i = 0; i < o.levels - 1; i++) {
      this.up.push({
        target: target(`Bloom.up${i}`),
        storage: storage(`Bloom.up${i}`),
      });
    }

    const fragmentRead = (input: TextureNode): Read => (uv) =>
      input.sample(uv) as unknown as Vec4Node;
    this.luminancePass = fullscreen("Bloom.luminance", () =>
      this.highPass(fragmentRead(this.luminanceInput), screenUV),
    );
    this.downPass = fullscreen("Bloom.downsample", () =>
      downsample(fragmentRead(this.downInput), screenUV, this.downTexel),
    );
    this.upPass = fullscreen("Bloom.upsample", () =>
      upsample(
        fragmentRead(this.upInput),
        fragmentRead(this.upSupport),
        screenUV,
        this.upTexel,
        this.radius,
      ),
    );
  }

  /** The frame's bright part: a luminance high pass. */
  private highPass(read: Read, uv: Vec2Node): Vec4Node {
    const texel = read(uv);
    const raw = luminance(texel.rgb);
    const l = smoothstep(this.threshold, this.threshold.add(this.smoothing), raw).mul(raw);
    return vec4(texel.rgb.mul(clamp(l, 0, 1)), l);
  }

  /**
   * The chain as compute kernels, or null on a backend without compute
   * (WebGL 2), which draws the levels.
   */
  private computeLevels(renderer: Renderer): ComputeLevel[] | null {
    if (this.isComputeChecked) return this.computeChain;
    this.isComputeChecked = true;
    const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean } })
      .backend;
    if (!backend?.isWebGPUBackend) return null;

    const levels: ComputeLevel[] = [];
    const level = (
      output: StorageTexture,
      input: StorageTexture | null,
      body: (uv: Vec2Node, texel: Vec2Node) => Vec4Node,
    ) => {
      const size = vec2Uniform();
      const texel = vec2Uniform();
      const kernel = (
        Fn(() => {
          const x = globalId.x;
          const y = globalId.y;
          If(x.lessThan(int(size.x)).and(y.lessThan(int(size.y))), () => {
            const uv = vec2(float(x).add(0.5), float(y).add(0.5)).div(size);
            textureStore(output, uvec2(x, y), body(uv as unknown as Vec2Node, texel as unknown as Vec2Node));
          });
        })() as unknown as { computeKernel(workgroup: number[]): ComputeNode }
      ).computeKernel([TILE, TILE, 1]);
      kernel.name = output.name;
      levels.push({ kernel, size, texel, output, input });
    };
    // Sampled at level 0: compute has no derivatives to pick a mip from.
    const computeRead = (source: TextureNode | Texture): Read => {
      const node = ((source as TextureNode).isNode
        ? source
        : texture(source as Texture)) as TextureNode;
      return (uv) => node.sample(uv).level(int(0)) as unknown as Vec4Node;
    };

    level(this.luminanceStorage, null, (uv) =>
      this.highPass(computeRead(this.luminanceInput), uv),
    );
    let previous = this.luminanceStorage;
    for (const { storage } of this.down) {
      const read = computeRead(previous);
      level(storage, previous, (uv, texel) => downsample(read, uv, texel));
      previous = storage;
    }
    for (let i = this.up.length - 1; i >= 0; i--) {
      const { storage } = this.up[i];
      const read = computeRead(previous);
      const support = computeRead(this.down[i].storage);
      level(storage, previous, (uv, texel) =>
        upsample(read, support, uv, texel, this.radius),
      );
      previous = storage;
    }
    this.computeChain = levels;
    this.sizeCompute();
    return levels;
  }

  /** Each compute level's sizes and workgroups, from its textures. */
  private sizeCompute() {
    if (!this.computeChain) return;
    const { width, height } = this.size;
    for (const level of this.computeChain) {
      const { width: w, height: h } = level.output.image as { width: number; height: number };
      const input = (level.input?.image as { width: number; height: number } | undefined) ?? {
        width,
        height,
      };
      level.size.value.set(w, h);
      level.texel.value.set(1 / input.width, 1 / input.height);
      (level.kernel as unknown as { dispatchSize: number[] }).dispatchSize = [
        Math.ceil(w / TILE),
        Math.ceil(h / TILE),
        1,
      ];
    }
  }

  fragment({ uv }: EffectInputs): Vec4Node {
    const texel = this.bloom.sample(uv) as unknown as Vec4Node;
    return vec4(texel.rgb.mul(this.intensity), texel.a);
  }

  update(renderer: Renderer, input: RenderTarget) {
    this.luminanceInput.value = input.texture;
    const chain = this.computeLevels(renderer);
    if (chain) {
      renderer.compute(chain.map((level) => level.kernel));
      this.bloom.value = (this.up[0] ?? this.down[0]).storage;
      return;
    }
    renderer.setRenderTarget(this.luminanceTarget);
    this.luminancePass.render(renderer);

    let previous = this.luminanceTarget;
    for (const { target } of this.down) {
      this.downTexel.value.set(1 / previous.width, 1 / previous.height);
      this.downInput.value = previous.texture;
      renderer.setRenderTarget(target);
      this.downPass.render(renderer);
      previous = target;
    }
    for (let i = this.up.length - 1; i >= 0; i--) {
      const { target } = this.up[i];
      this.upTexel.value.set(1 / previous.width, 1 / previous.height);
      this.upInput.value = previous.texture;
      this.upSupport.value = this.down[i].target.texture;
      renderer.setRenderTarget(target);
      this.upPass.render(renderer);
      previous = target;
    }
    this.bloom.value = (this.up[0] ?? this.down[0]).target.texture;
  }

  setSize(width: number, height: number) {
    this.size = { width, height };
    this.luminanceTarget.setSize(width, height);
    this.luminanceStorage.setSize(width, height, 1);
    let w = width;
    let h = height;
    for (let i = 0; i < this.down.length; i++) {
      w = Math.max(1, Math.round(w * 0.5));
      h = Math.max(1, Math.round(h * 0.5));
      this.down[i].target.setSize(w, h);
      this.down[i].storage.setSize(w, h, 1);
      if (i < this.up.length) {
        this.up[i].target.setSize(w, h);
        this.up[i].storage.setSize(w, h, 1);
      }
    }
    this.sizeCompute();
  }

  dispose() {
    this.luminanceTarget.dispose();
    this.luminanceStorage.dispose();
    for (const level of [...this.down, ...this.up]) {
      level.target.dispose();
      level.storage.dispose();
    }
    for (const level of this.computeChain ?? []) level.kernel.dispose();
    for (const pass of [this.luminancePass, this.downPass, this.upPass]) {
      (pass.material as NodeMaterial).dispose();
    }
  }
}

/** Reads a level at a uv. */
type Read = (uv: Vec2Node) => Vec4Node;

/** 13-tap downsample; taps outside the frame weigh nothing (clamp to border). */
function downsample(read: Read, uv: Vec2Node, texel: Vec2Node): Vec4Node {
  const tap = (offset: [number, number], weight: number) => {
    const p = uv.add(texel.mul(vec2(offset[0], offset[1]))) as unknown as Vec2Node;
    const inside = p.x
      .greaterThanEqual(0)
      .and(p.x.lessThanEqual(1))
      .and(p.y.greaterThanEqual(0))
      .and(p.y.lessThanEqual(1));
    return read(p).mul(inside.select(float(weight), float(0)));
  };
  const inner = 0.125;
  const outer = 0.0555555;
  return tap([-1, 1], inner)
    .add(tap([1, 1], inner))
    .add(tap([-1, -1], inner))
    .add(tap([1, -1], inner))
    .add(tap([-2, 2], outer))
    .add(tap([0, 2], outer))
    .add(tap([2, 2], outer))
    .add(tap([-2, 0], outer))
    .add(tap([2, 0], outer))
    .add(tap([-2, -2], outer))
    .add(tap([0, -2], outer))
    .add(tap([2, -2], outer))
    .add(read(uv).mul(outer)) as unknown as Vec4Node;
}

/** 9-tap tent upsample of the coarser level, mixed into the finer by `radius`. */
function upsample(
  read: Read,
  support: Read,
  uv: Vec2Node,
  texel: Vec2Node,
  radius: ReturnType<typeof floatUniform>,
): Vec4Node {
  const tap = (x: number, y: number, weight: number) =>
    read(uv.add(texel.mul(vec2(x, y))) as unknown as Vec2Node).mul(weight);
  const blurred = tap(-1, 1, 0.0625)
    .add(tap(0, 1, 0.125))
    .add(tap(1, 1, 0.0625))
    .add(tap(-1, 0, 0.125))
    .add(tap(0, 0, 0.25))
    .add(tap(1, 0, 0.125))
    .add(tap(-1, -1, 0.0625))
    .add(tap(0, -1, 0.125))
    .add(tap(1, -1, 0.0625));
  return mix(support(uv), blurred, radius) as unknown as Vec4Node;
}

/** A full-screen draw of `color`, opaque, no depth. */
function fullscreen(name: string, color: () => Vec4Node): QuadMesh {
  const material = new NodeMaterial();
  material.name = name;
  material.depthTest = false;
  material.depthWrite = false;
  material.fragmentNode = Fn(color)();
  return new QuadMesh(material);
}

export { fullscreen };
