/**
 * The viewer's own shading: the sky sphere behind each view and the
 * composite that puts one or two views on screen with the overlays, the
 * grid, the contours, the split and the output encoding in one pass.
 */
import {
  type ChunkRenderer,
  type FloatNode,
  ownUniform,
  textureSlot,
  type Vec2Node,
  type Vec3Node,
  type Vec4Node,
} from "@voxelize/core";
import {
  BackSide,
  Matrix4,
  NodeMaterial,
  type Texture,
  Vector2,
  Vector4,
  WebGLCoordinateSystem,
} from "three/webgpu";
import {
  abs,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  If,
  max,
  min,
  mix,
  mod,
  normalize,
  positionWorld,
  pow,
  screenUV,
  select,
  step,
  vec2,
  vec3,
  vec4,
} from "three/tsl";


/**
 * The gradient the chunk fog fades into, plus a soft sun, on a sphere
 * around the camera: what the far edge of a view hazes toward.
 */
export function createViewerSkyMaterial(
  chunkRenderer: ChunkRenderer,
): NodeMaterial {
  const u = chunkRenderer.uniforms;
  const l = chunkRenderer.shaderLightingUniforms;
  const material = new NodeMaterial();
  material.name = "viewer-sky";
  material.side = BackSide;
  material.depthWrite = false;
  material.fog = false;
  material.lights = false;
  material.fragmentNode = Fn(() => {
    const ray = normalize(positionWorld.sub(cameraPosition)).toVar("skyRay");
    const dome = ray.mul(u.skyFogDimension);
    const h = normalize(dome.add(u.skyFogOffset)).y;
    const h2 = normalize(dome.add(u.skyFogVoidOffset)).y;
    const upper = mix(
      u.skyFogMiddleColor,
      u.skyFogTopColor,
      max(pow(max(h, 0), u.skyFogExponent), 0),
    );
    const color = mix(
      upper,
      u.skyFogBottomColor,
      max(pow(max(h2.negate(), 0), u.skyFogExponent2), 0),
    ).add(
      l.sunColor
        .mul(pow(max(dot(ray, l.sunDirection), 0), 6))
        .mul(l.sunlightIntensity)
        .mul(0.35),
    );
    return vec4(color, 1);
  })();
  return material;
}

/** One view's inputs to the composite. */
export type CompositeSide = ReturnType<typeof createSide>;

function createSide() {
  return {
    color: textureSlot("color"),
    depth: textureSlot("depth"),
    /** Camera world matrix times inverse projection: clip back to world. */
    inverse: ownUniform(new Matrix4()),
    overlay: textureSlot("color"),
    /** (x0, z0, 1 / width, 1 / depth) of the overlay raster, in blocks. */
    overlayRect: ownUniform(new Vector4()),
    hasOverlay: ownUniform(0),
    height: textureSlot("float"),
    hasHeight: ownUniform(0),
  };
}

const toLinear = (c: Vec3Node): Vec3Node =>
  mix(
    c.div(12.92),
    pow(c.add(0.055).div(1.055), vec3(2.4)),
    step(vec3(0.04045), c),
  );

const toSrgb = (color: Vec3Node): Vec3Node => {
  const c = max(color, vec3(0));
  return mix(
    c.mul(12.92),
    pow(c, vec3(1 / 2.4)).mul(1.055).sub(0.055),
    step(vec3(0.0031308), c),
  );
};

/** The composite's inputs and the material that draws them. */
export function createViewerComposite() {
  const uniforms = {
    sides: [createSide(), createSide()] as const,
    overlayOpacity: ownUniform(0.6),
    grid: ownUniform(0),
    gridSize: ownUniform(16),
    contours: ownUniform(0),
    contourStep: ownUniform(8),
    /** 0 one view, 1 side by side, 2 swipe. */
    split: ownUniform(0),
    swipe: ownUniform(0.5),
    resolution: ownUniform(new Vector2(1, 1)),
  };

  /**
   * One view's colour at `uv` with its overlays. Every derivative is taken
   * before a branch, where each pixel of a quad runs it.
   */
  const shade = (side: CompositeSide, uv: Vec2Node, tag: string): Vec3Node =>
    Fn((builder) => {
      const c = side.color.sample(uv).level(float(0)).rgb.toVar(`viewColor${tag}`);
      const depth = side.depth.sample(uv).level(float(0)).r.toVar(`viewDepth${tag}`);
      const clipZ =
        builder.renderer.coordinateSystem === WebGLCoordinateSystem
          ? depth.mul(2).sub(1)
          : depth;
      // A render target's uv runs down from its top row; clip y runs up.
      const ndc = vec4(uv.x.mul(2).sub(1), uv.y.mul(-2).add(1), clipZ, 1);
      const world4 = side.inverse.mul(ndc);
      const world = world4.xyz.div(world4.w).toVar(`viewWorld${tag}`);
      const r = side.overlayRect;
      const o = world.xz.sub(r.xy).mul(r.zw).toVar(`viewOverlayUv${tag}`);
      const isInRaster = o.x
        .greaterThanEqual(0)
        .and(o.y.greaterThanEqual(0))
        .and(o.x.lessThan(1))
        .and(o.y.lessThan(1));
      const cell = world.xz.div(uniforms.gridSize).toVar(`viewGridCell${tag}`);
      const gridWidth = fwidth(cell).toVar(`viewGridWidth${tag}`);
      const h = side.height
        .sample(o)
        .level(float(0))
        .r.div(uniforms.contourStep)
        .toVar(`viewContour${tag}`);
      const contourWidth = fwidth(h).toVar(`viewContourWidth${tag}`);
      If(depth.lessThan(1), () => {
        If(side.hasOverlay.greaterThan(0.5).and(isInRaster), () => {
          const ov = side.overlay.sample(o).level(float(0));
          c.assign(mix(c, toLinear(ov.rgb), ov.a.mul(uniforms.overlayOpacity)));
        });
        // Lines are drawn only where the surface is continuous across the
        // pixel: at a silhouette the derivatives jump and would outline
        // every block.
        If(
          uniforms.grid
            .greaterThan(0.5)
            .and(max(gridWidth.x, gridWidth.y).lessThan(0.06)),
          () => {
            const d = abs(fract(cell.add(0.5)).sub(0.5)).div(
              max(gridWidth, vec2(1e-4)),
            );
            const line = clamp(min(d.x, d.y).sub(0.5), 0, 1).oneMinus();
            c.assign(mix(c, vec3(1, 0.85, 0.2), line.mul(0.6)));
          },
        );
        // Contours of the filtered height map, so they run as smooth lines
        // over blocky ground and read the same from above as from the side.
        If(
          uniforms.contours
            .greaterThan(0.5)
            .and(side.hasHeight.greaterThan(0.5))
            .and(isInRaster)
            .and(h.greaterThan(0))
            .and(contourWidth.lessThan(0.5)),
          () => {
            const d = abs(fract(h.add(0.5)).sub(0.5)).div(max(contourWidth, 1e-4));
            const line = clamp(d.sub(0.5), 0, 1).oneMinus();
            const major = step(0.5, abs(mod(floor(h.add(0.5)), 5)).oneMinus());
            c.assign(
              mix(
                c,
                mix(vec3(0.16, 0.1, 0.05), vec3(0.04, 0.02, 0), major),
                line.mul(major.mul(0.35).add(0.55)),
              ),
            );
          },
        );
      });
      return c;
    })() as unknown as Vec3Node;

  const material = new NodeMaterial();
  material.name = "viewer-composite";
  material.depthTest = false;
  material.depthWrite = false;
  material.fragmentNode = Fn(() => {
    const uv = screenUV;
    const [a, b] = uniforms.sides;
    const isSide = uniforms.split.greaterThan(0.5).and(uniforms.split.lessThan(1.5));
    const isLeft = uv.x.lessThan(0.5);
    // Side by side, each half shows its view squeezed into it.
    const sideUv = vec2(
      select(isLeft, uv.x.mul(2), uv.x.sub(0.5).mul(2)),
      uv.y,
    );
    const viewUv = select(isSide, sideUv, uv).toVar("compositeUv");
    // Both views shade every pixel: the choice between them must not split
    // a quad that takes derivatives.
    const colorA = shade(a, viewUv, "A").toVar("compositeA");
    const colorB = shade(b, viewUv, "B").toVar("compositeB");
    const boundary = select(isSide, float(0.5), uniforms.swipe);
    const showsA = select(isSide, isLeft, uv.x.lessThan(uniforms.swipe));
    const color = select(
      uniforms.split.lessThan(0.5).or(showsA),
      colorA,
      colorB,
    ).toVar("compositeColor");
    If(
      uniforms.split
        .greaterThan(0.5)
        .and(abs(uv.x.sub(boundary)).mul(uniforms.resolution.x).lessThan(1.5)),
      () => {
        color.assign(vec3(1));
      },
    );
    return vec4(toSrgb(color), 1);
  })() as unknown as Vec4Node;

  const setSide = (
    index: 0 | 1,
    inputs: {
      color: Texture;
      depth: Texture | null;
      inverse: Matrix4;
      overlay: Texture | null;
      overlayRect: Vector4;
      hasOverlay: boolean;
      height: Texture | null;
      hasHeight: boolean;
    },
  ) => {
    const side = uniforms.sides[index];
    side.color.value = inputs.color;
    if (inputs.depth) side.depth.value = inputs.depth;
    side.inverse.value.copy(inputs.inverse);
    if (inputs.overlay) side.overlay.value = inputs.overlay;
    side.overlayRect.value.copy(inputs.overlayRect);
    side.hasOverlay.value = inputs.hasOverlay && inputs.overlay ? 1 : 0;
    if (inputs.height) side.height.value = inputs.height;
    side.hasHeight.value = inputs.hasHeight && inputs.height ? 1 : 0;
  };

  return { material, uniforms, setSide };
}

