import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
  Vector3,
  Vector4,
} from "three";

import { meanLinearRgb } from "./far-terrain-tiles";

/**
 * Weather on surfaces: what rain and snow leave on the world, drawn by the
 * terrain shaders themselves. Rain darkens open ground and gives it a calm
 * sky sheen, and pocks open ground with pixel splashes and still water with
 * rings while it falls. Snow near the
 * player is the host's to lay as blocks; only the far layer, which has no
 * blocks to lay it on, wears a coat that grows from patches to white.
 *
 * The host drives it with a handful of uniforms (`SurfaceWeatherUniforms`)
 * the chunk materials and the far layer share by reference. At their
 * defaults (all of `surfaceWeather` zero) every term is skipped by a uniform
 * branch, so a world without weather renders exactly as before and pays
 * nothing.
 *
 * Every ground effect lives on the 1/16 block texel grid, so it belongs to
 * the block art, and every per-texel pattern hands over to its average as
 * texels shrink under a pixel, so the distance never sparkles.
 */

/** Texels per block side: the grid every ground effect snaps to. */
export const SURFACE_WEATHER_TEXELS = 16;

/** The tuning of every surface-weather term, shared by the GLSL and its TypeScript twins. */
export const SURFACE_WEATHER = {
  /** World normal y over which a face counts as facing up. */
  upFrom: 0.55,
  upTo: 0.9,
  /** Albedo scale of fully wet porous ground, and its saturation lift. */
  wetDarken: 0.65,
  wetSaturation: 0.15,
  /** Wetness a wall keeps, and what facing into the wind adds. */
  sideWet: 0.25,
  windwardWet: 0.6,
  /** Fresnel scale of the wet sheen, and its ceiling: glossy, never a mirror. */
  sheenReflectivity: 0.35,
  sheenMax: 0.15,
  /** Per-texel sheen variation (porosity), and its mean once texels are subpixel. */
  sheenGrainFloor: 0.75,
  /** The wet sun glint: its sharpness, and its strength on wet ground. */
  glintExponent: 120,
  glintWet: 0.3,
  /** The coat's drift field: two octaves (blocks per cell), weights, contrast. */
  driftScaleLarge: 3.5,
  driftScaleSmall: 1.3,
  driftWeightLarge: 0.7,
  driftContrast: 1.45,
  /**
   * Half-width of the coat's drift edge; the even speckle a fresh coat
   * starts with (single texels, the first minute); and the coat past which
   * the drifts begin to fill.
   */
  driftSoftness: 0.12,
  coatSpeckle: 0.2,
  driftStart: 0.2,
  /**
   * The share of ground the coat covers on average at coat `c`, as
   * `speckle + (1 - speckle) smoothstep(from, to, drifts)` (fit to the drift
   * field, within about 1%): what a coat seen from too far to resolve its
   * drifts is drawn as.
   */
  coatMean: { from: -0.02, to: 1.04 },
  /** Blocks per pixel over which the drift patches hand over to their mean. */
  driftFadeFrom: 0.35,
  driftFadeTo: 1.0,
  /** The roughening of the snow line, blocks: two octaves of (cell, swing). */
  lineJitterLarge: { cell: 23, swing: 6 },
  lineJitterSmall: { cell: 7, swing: 2 },
  /** The default half-width of the band the coat fades in over, blocks. */
  lineBand: 6.25,
  /**
   * Drop pocks: texels per cell side (one splash at a time per cell), slots
   * per second per cell, the share of slots that splash at full rain, and
   * each frame's end (seconds) and brightness: a dot, a plus, a faint ring.
   */
  pockCellTexels: 4,
  pockRate: 0.8,
  pockChance: 0.6,
  pockFrames: [0.04, 0.09, 0.15],
  pockWeights: [1, 0.8, 0.35],
  /** What a pock adds: this much of the sky's light, and of the ground's own. */
  pockSky: 0.35,
  pockGround: 0.35,
  /** Pixels per texel over which a pock hands over to its average shimmer. */
  pockFadeFrom: 0.8,
  pockFadeTo: 2.0,
  /**
   * Rain rings on still water: three layers of one-block cells,
   * a ring's life (s), its widest radius (blocks), the wave's sharpness
   * (radians per block), the share of slots that ring, the slope it tilts
   * the surface by, and the distance (blocks) it fades over.
   */
  ringLayers: 3,
  ringLife: 0.75,
  ringRadius: 0.3,
  ringSharpness: 45,
  ringChance: 0.7,
  ringSlope: 0.25,
  ringFadeFrom: 14,
  ringFadeTo: 36,
  /** How far a ring's crest lifts the water toward the sky it mirrors. */
  ringCrest: 0.3,
} as const;

const S = SURFACE_WEATHER;
const f = (value: number, digits = 4) => value.toFixed(digits);

/** Uniforms the host writes; the chunk materials and the far layer share them by reference. */
export type SurfaceWeatherUniforms = {
  /**
   * x: rain falling now, 0..1 (pocks on open ground, rings on open water);
   * y, z: wetness and the far layer's coat gains, 0..1, each multiplying
   * its channel of `surfaceWeatherMap`. All zero skips every term.
   */
  surfaceWeather: { value: Vector3 };
  /** RGBA8, linear filtered: r coat, g wetness, b unused, a the coat line (see `surfaceWeatherLine`). */
  surfaceWeatherMap: { value: Texture };
  /** `(x0, z0, 1 / width, 1 / depth)` in blocks: the map's uv is `(xz - (x0, z0)) * (1 / width, 1 / depth)`. */
  surfaceWeatherWindow: { value: Vector4 };
  /**
   * `(offset, scale, halfBand, unused)`: the coat line sits at
   * `offset + a * scale`; the coat fades in, and wetness, pocks and rings
   * fade out, across `line ± halfBand`.
   */
  surfaceWeatherLine: { value: Vector4 };
  /** The far layer's coat colour (linear). */
  surfaceCoatColor: { value: Color };
  /** `(dirX, dirZ, strength 0..1, unused)`: walls facing into it get a little wetter. */
  surfaceWind: { value: Vector4 };
};

/** A 1x1 map holding nothing: no coat, no wetness. */
export function makeSurfaceWeatherMap(
  data: Uint8Array = new Uint8Array(4),
  width = 1,
  height = 1,
): DataTexture {
  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = NoColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** The defaults: everything off. */
export function createSurfaceWeatherUniforms(): SurfaceWeatherUniforms {
  return {
    surfaceWeather: { value: new Vector3(0, 0, 0) },
    surfaceWeatherMap: { value: makeSurfaceWeatherMap() },
    surfaceWeatherWindow: { value: new Vector4(0, 0, 1, 1) },
    surfaceWeatherLine: { value: new Vector4(0, 0, S.lineBand, 0) },
    surfaceCoatColor: { value: new Color().setRGB(0.86, 0.9, 0.95) },
    surfaceWind: { value: new Vector4(0, 0, 0, 0) },
  };
}

/** The shader names of the shared uniforms, bound by reference. */
export function bindSurfaceWeatherUniforms(uniforms: SurfaceWeatherUniforms) {
  return {
    uSurfaceWeather: uniforms.surfaceWeather,
    uSurfaceWeatherMap: uniforms.surfaceWeatherMap,
    uSurfaceWeatherWindow: uniforms.surfaceWeatherWindow,
    uSurfaceWeatherLine: uniforms.surfaceWeatherLine,
    uSurfaceCoatColor: uniforms.surfaceCoatColor,
    uSurfaceWind: uniforms.surfaceWind,
  };
}

/**
 * Colour the far layer's coat as a face's texels average (`pixels`, RGBA
 * bytes as the atlas holds them), so distant snow matches the blocks laid
 * near the player. Returns false, keeping the colour, while the texels are
 * not readable yet.
 */
export function applySurfaceCoatFace(
  uniforms: Pick<SurfaceWeatherUniforms, "surfaceCoatColor">,
  pixels: ArrayLike<number> | null,
): boolean {
  const mean = pixels ? meanLinearRgb(pixels) : null;
  if (!mean) return false;
  uniforms.surfaceCoatColor.value.setRGB(mean[0], mean[1], mean[2]);
  return true;
}

/**
 * How far a chunk material takes the weather (`uSurfaceResponse`, per
 * material): its wetness. Zero skips the material entirely.
 */
export const SURFACE_RESPONSE = {
  /** Solid ground and everything drawn like it. */
  solid: 1,
  /** Leaves and other cutouts. */
  cutout: 1,
  /** Blended see-through blocks (glass): never darkened. */
  seeThrough: 0,
  /** Fluids: their own rings, in the water's branch. */
  fluid: 0,
} as const satisfies Record<string, number>;

export const SURFACE_WEATHER_UNIFORM_DECLARATIONS = `
// Weather on surfaces (surface-weather.ts). x: rain now; y, z: wetness and
// the far coat gains. All zero skips every term.
uniform vec3 uSurfaceWeather;
uniform sampler2D uSurfaceWeatherMap;
uniform vec4 uSurfaceWeatherWindow;
uniform vec4 uSurfaceWeatherLine;
uniform vec4 uSurfaceWind;
`;

/**
 * The voxel sunlight (0..1) over which a material's faces count as open to
 * the sky (`uSurfaceOpenLight`, per material). A solid face carries the
 * light of the air in front of it, which only the open sky keeps at its
 * full level. A see-through block (leaves, glass, plants) carries its own
 * voxel's light instead, which its own attenuation has already lowered: a
 * canopy's top leaves read 13 of 15 under open sky and the leaves a block
 * deeper 11, so they open lower and sharper.
 */
export const SURFACE_OPEN_LIGHT = {
  solid: [0.85, 0.98],
  seeThrough: [12.2 / 15, 12.9 / 15],
} as const satisfies Record<string, readonly [number, number]>;

/** The chunk shader's own: the material's response and open light. */
export const SURFACE_WEATHER_CHUNK_UNIFORM_DECLARATIONS = `
uniform float uSurfaceResponse;
uniform vec2 uSurfaceOpenLight;
`;

const pockFrames = S.pockFrames.map((value) => f(value));
const pockWeights = S.pockWeights.map((value) => f(value));

/**
 * The mean brightness a pock adds to a texel over time at full chance:
 * what the pattern averages to once texels are too small to draw it.
 */
export const SURFACE_POCK_MEAN = (() => {
  // Texels each frame lights inside a 4x4 cell around a centre in its
  // middle 2x2: one, four, and the six of the eight ring texels that fit.
  const texels = [1, 4, 6];
  let lit = 0;
  let start = 0;
  S.pockFrames.forEach((end, index) => {
    lit += (end - start) * texels[index] * S.pockWeights[index];
    start = end;
  });
  return (S.pockRate * lit) / (S.pockCellTexels * S.pockCellTexels);
})();

/**
 * Functions both the chunk shader and the far layer use. Pure functions of
 * their arguments and the shared uniforms; the sky ramp needs the sky
 * fog's uniforms declared ahead of it.
 */
export const SURFACE_WEATHER_FUNCTIONS = `
uint surfaceWeatherMix(uint h) {
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}

// Hashes of the integer cell a point lies in, 0..1.
float surfaceWeatherHash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)));
  return float(surfaceWeatherMix(q.x + surfaceWeatherMix(q.y)) >> 8u) * (1.0 / 16777216.0);
}

float surfaceWeatherHash(vec3 p) {
  uvec3 q = uvec3(ivec3(floor(p)));
  return float(surfaceWeatherMix(q.x + surfaceWeatherMix(q.y + surfaceWeatherMix(q.z))) >> 8u)
    * (1.0 / 16777216.0);
}

float surfaceWeatherNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 t = p - i;
  t = t * t * (3.0 - 2.0 * t);
  float a = surfaceWeatherHash(i);
  float b = surfaceWeatherHash(i + vec2(1.0, 0.0));
  float c = surfaceWeatherHash(i + vec2(0.0, 1.0));
  float d = surfaceWeatherHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

// The weather map at a world xz: r coat, g wetness, a the line.
vec4 surfaceWeatherSample(vec2 xz) {
  return textureLod(
    uSurfaceWeatherMap,
    (xz - uSurfaceWeatherWindow.xy) * uSurfaceWeatherWindow.zw,
    0.0
  );
}

// 1 above the coat line (the coat), 0 below it (rain, wet ground), across
// its band; the line wanders a few blocks so it never reads as a contour.
float surfaceWeatherAbove(vec2 xz, float y, float lineCode) {
  float line = uSurfaceWeatherLine.x + lineCode * uSurfaceWeatherLine.y;
  float jitter =
    (surfaceWeatherNoise(xz * ${f(1 / S.lineJitterLarge.cell, 6)} + vec2(3.7, 9.1)) - 0.5)
      * ${f(S.lineJitterLarge.swing)}
    + (surfaceWeatherNoise(xz * ${f(1 / S.lineJitterSmall.cell, 6)} + vec2(11.3, 2.9)) - 0.5)
      * ${f(S.lineJitterSmall.swing)};
  float band = max(uSurfaceWeatherLine.z, 0.01);
  return smoothstep(line - band, line + band, y + jitter);
}

// How much of the sky a wet surface mirrors at this view: a Fresnel sheen,
// strongest at grazing angles, never past its ceiling.
float surfaceWeatherSheen(float nDotV, float porous) {
  float fresnel = 0.02 + 0.98 * pow(1.0 - clamp(nDotV, 0.0, 1.0), 5.0);
  return min(fresnel * ${f(S.sheenReflectivity)} * porous, ${f(S.sheenMax)});
}

// The sky dome along a ray, in the colours the sky and the haze are drawn
// with right now: the weather greys them, so wet ground under a storm
// mirrors a storm.
vec3 surfaceWeatherSkyAlong(vec3 dir) {
  float h = normalize(dir * uSkyFogDimension + uSkyFogOffset).y;
  return mix(uSkyFogMiddleColor, uSkyFogTopColor, pow(max(h, 0.0), uSkyFogExponent));
}

// Albedo of wet porous ground: darker, a little richer.
vec3 surfaceWeatherWetAlbedo(vec3 albedo, float wet) {
  vec3 darker = albedo * mix(1.0, ${f(S.wetDarken)}, wet);
  float luma = dot(darker, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(luma), darker, 1.0 + ${f(S.wetSaturation)} * wet), 0.0);
}

// How wet a face gets for its facing: tops wholly, walls a little, more
// facing into the wind; undersides not at all.
float surfaceWeatherFaceWet(vec3 normal) {
  vec2 windDir = uSurfaceWind.xy / max(length(uSurfaceWind.xy), 1e-4);
  float windward = max(dot(normal.xz, -windDir), 0.0) * clamp(uSurfaceWind.z, 0.0, 1.0);
  float up = smoothstep(${f(S.upFrom)}, ${f(S.upTo)}, normal.y);
  return max(up, (1.0 - abs(normal.y)) * (${f(S.sideWet)} + ${f(S.windwardWet)} * windward));
}

// A raindrop hitting open ground, drawn on the texel grid: in each 4x4
// texel cell one splash at a time, a dot, then a plus, then a faint ring.
float surfaceWeatherPock(vec2 texel, float seconds, float chance) {
  vec2 cell = floor(texel * ${f(1 / S.pockCellTexels)});
  vec2 local = texel - cell * ${f(S.pockCellTexels, 1)};
  float t = seconds * ${f(S.pockRate)} + surfaceWeatherHash(vec3(cell, -1.0)) * 31.0;
  float slot = floor(t);
  float age = (t - slot) * ${f(1 / S.pockRate)};
  float splashes = surfaceWeatherHash(vec3(cell, slot * 3.0)) < chance ? 1.0 : 0.0;
  vec2 centre = 1.0 + floor(vec2(
    surfaceWeatherHash(vec3(cell, slot * 3.0 + 1.0)),
    surfaceWeatherHash(vec3(cell, slot * 3.0 + 2.0))
  ) * 2.0);
  float reach = abs(local.x - centre.x) + abs(local.y - centre.y);
  float frame = age < ${pockFrames[0]} ? (reach < 0.5 ? ${pockWeights[0]} : 0.0)
    : age < ${pockFrames[1]} ? (abs(reach - 1.0) < 0.5 ? ${pockWeights[1]} : 0.0)
    : age < ${pockFrames[2]} ? (abs(reach - 2.0) < 0.5 ? ${pockWeights[2]} : 0.0)
    : 0.0;
  return frame * splashes;
}

// Rain rings on still water: up to three layers of one-block cells, each
// cell starting a ring at a hashed spot and time, the later layers joining
// as the rain thickens. xy: the slope the rings tilt the surface by; z: how
// much of a crest lies here.
vec3 surfaceWeatherRings(vec2 xz, float seconds, float rain) {
  vec3 rings = vec3(0.0);
  for (int layer = 0; layer < ${S.ringLayers}; layer++) {
    float index = float(layer);
    float share = clamp(rain * ${f(S.ringLayers, 1)} - index, 0.0, 1.0);
    vec2 p = xz + vec2(0.37, 0.71) * index;
    vec2 cell = floor(p);
    float t = seconds * ${f(1 / S.ringLife)} + surfaceWeatherHash(vec3(cell, index - 8.0));
    float slot = floor(t);
    float age = t - slot;
    float seed = slot * 8.0 + index * 2.0;
    float rings1 = surfaceWeatherHash(vec3(cell, seed)) < ${f(S.ringChance)} * share ? 1.0 : 0.0;
    vec2 centre = cell + 0.3 + 0.4 * vec2(
      surfaceWeatherHash(vec3(cell + vec2(7.0, 0.0), seed + 1.0)),
      surfaceWeatherHash(vec3(cell + vec2(0.0, 7.0), seed + 1.0))
    );
    vec2 away = p - centre;
    float r = length(away);
    float radius = ${f(S.ringRadius)} * (1.0 - (1.0 - age) * (1.0 - age));
    float fade = (1.0 - age) * (1.0 - age) * rings1;
    float wave = sin(clamp((r - radius) * ${f(S.ringSharpness, 1)}, -3.14159, 3.14159));
    rings.xy += away / max(r, 1e-4) * wave * fade;
    rings.z += (1.0 - smoothstep(0.03, 0.07, abs(r - radius))) * fade;
  }
  return rings;
}
`;

/**
 * The chunk fragment's albedo pass, right after the atlas sample: the
 * weather the ground holds (wetness), and what the
 * lighting pass after it needs to know. Declares its outputs at the top of
 * `main` so the later pass can read them.
 */
export const SURFACE_WEATHER_TERRAIN_OPEN =
  "if (uSurfaceWeather != vec3(0.0) && uSurfaceResponse > 0.0) {";

export const SURFACE_WEATHER_ALBEDO_FRAGMENT = `
// Weather on the ground (surface-weather.ts). Skipped whole while the host
// sets no weather, so a dry world renders exactly as it always has.
float surfaceWeatherRainHere = 0.0;
float surfaceWeatherWetUp = 0.0;
float surfaceWeatherGrain = 0.5;
float surfaceWeatherFootprint = 1.0;
${SURFACE_WEATHER_TERRAIN_OPEN}
  // The footprint first, while control flow is still uniform.
  vec3 swPos = vWorldPosition.xyz;
  surfaceWeatherFootprint = max(length(dFdx(swPos)), length(dFdy(swPos)));
  vec4 swLight = bilinearVoxelLight();
  // Open to the sky by the face's voxel sunlight, over the material's own
  // band (SURFACE_OPEN_LIGHT); fluids, faces under water and faces that
  // light themselves take no weather.
  float swGate = (1.0 - vIsFluid) * (1.0 - vWaterExposed) * (vEmissive > 0.0 ? 0.0 : 1.0);
  float swOpen = smoothstep(uSurfaceOpenLight.x, uSurfaceOpenLight.y, swLight.a) * swGate;
  if (swOpen > 0.0) {
    vec2 swTexel = floor(swPos.xz * ${f(SURFACE_WEATHER_TEXELS, 1)});
    vec2 swTexelCentre = (swTexel + 0.5) * ${f(1 / SURFACE_WEATHER_TEXELS)};
    surfaceWeatherGrain = surfaceWeatherHash(swTexel);
    vec4 swWeather = surfaceWeatherSample(swTexelCentre);
    float swAbove = surfaceWeatherAbove(swTexelCentre, swPos.y, swWeather.a);
    float swBelow = 1.0 - swAbove;
    float swUp = smoothstep(${f(S.upFrom)}, ${f(S.upTo)}, vWorldNormal.y);

    float swWet = clamp(swWeather.g * uSurfaceWeather.y, 0.0, 1.0) * swBelow * swOpen
      * surfaceWeatherFaceWet(vWorldNormal) * uSurfaceResponse;
    if (swWet > 0.0) {
      diffuseColor.rgb = surfaceWeatherWetAlbedo(diffuseColor.rgb, swWet);
    }
    surfaceWeatherWetUp = swWet * swUp;

    surfaceWeatherRainHere = clamp(uSurfaceWeather.x, 0.0, 1.0) * swBelow * swOpen * swUp;
  }
}
`;

/**
 * The chunk fragment's lighting pass, after the face is lit and before the
 * fog: the wet sheen's mirror of the sky, the sun's glint on it, and the
 * rain's pocks on open ground. All of it is light the sky or the sun puts
 * there, so nothing glows at night.
 */
export const SURFACE_WEATHER_LIGHT_FRAGMENT = `
${SURFACE_WEATHER_TERRAIN_OPEN}
  if (surfaceWeatherWetUp + surfaceWeatherRainHere > 0.0) {
    vec3 swPos = vWorldPosition.xyz;
    vec3 swView = normalize(cameraPosition - swPos);
    vec2 swTexel = floor(swPos.xz * ${f(SURFACE_WEATHER_TEXELS, 1)});
    float swSeconds = uTime * 0.001;
    float swTexelPixels = ${f(1 / SURFACE_WEATHER_TEXELS)} / max(surfaceWeatherFootprint, 1e-5);
    float swNear = smoothstep(${f(S.pockFadeFrom)}, ${f(S.pockFadeTo)}, swTexelPixels);

    if (surfaceWeatherWetUp > 0.0) {
      vec3 swReflectDir = reflect(-swView, vec3(0.0, 1.0, 0.0));
      float swPorous = mix(
        ${f((1 + S.sheenGrainFloor) / 2)},
        ${f(S.sheenGrainFloor)} + ${f(1 - S.sheenGrainFloor)} * surfaceWeatherGrain,
        swNear
      );
      outgoingLight.rgb = mix(
        outgoingLight.rgb,
        surfaceWeatherSkyAlong(swReflectDir),
        surfaceWeatherSheen(swView.y, swPorous) * surfaceWeatherWetUp
      );
      // The sun's glint, only where the beam reaches.
      float swGlint = pow(max(dot(swReflectDir, uCelestialDirection), 0.0), ${f(S.glintExponent, 1)})
        * shadow * uDirectSunlight * uSunlightIntensity;
      outgoingLight.rgb += uSunColor * swGlint * ${f(S.glintWet)} * surfaceWeatherWetUp;
    }

    // Drops landing: pixel splashes up close, their faint average shimmer
    // once texels shrink under a couple of pixels. Lit by the sky above and
    // the ground's own light, so they dim with the day.
    if (surfaceWeatherRainHere > 0.0) {
      float swChance = ${f(S.pockChance)} * surfaceWeatherRainHere;
      float swPock = mix(
        ${f(SURFACE_POCK_MEAN, 5)} * swChance,
        surfaceWeatherPock(swTexel, swSeconds, swChance),
        swNear
      );
      outgoingLight.rgb += swPock * (
        mix(uSkyFogMiddleColor, uSkyFogTopColor, 0.5) * ${f(S.pockSky)}
        + outgoingLight.rgb * ${f(S.pockGround)}
      );
    }
  }
}
`;

/** Declared beside the water's flow terms: the rain rings' crest, for the surface colour. */
export const SURFACE_WEATHER_WATER_DECLARATION = `
  float surfaceWeatherRingCrest = 0.0;
`;

/**
 * Rain rings on open water, inside the fluid branch's top-face normal: on
 * texel centres (`waterRippleXZ`) so they step like the block art, faded
 * with distance, and only where it rains rather than snows.
 */
export const SURFACE_WEATHER_WATER_RINGS_FRAGMENT = `
    if (uSurfaceWeather.x > 0.0) {
      vec4 swWeather = surfaceWeatherSample(wPos.xz);
      float swRingRain = clamp(uSurfaceWeather.x, 0.0, 1.0) * skyOpen
        * (1.0 - surfaceWeatherAbove(wPos.xz, wPos.y, swWeather.a))
        * (1.0 - smoothstep(${f(S.ringFadeFrom, 1)}, ${f(S.ringFadeTo, 1)}, distToCamera));
      if (swRingRain > 0.0) {
        vec3 swRings = surfaceWeatherRings(waterRippleXZ, waterSeconds, clamp(uSurfaceWeather.x, 0.0, 1.0));
        float swRingKeep = swRingRain / max(clamp(uSurfaceWeather.x, 0.0, 1.0), 1e-4);
        waterSlope += swRings.xy * ${f(S.ringSlope)} * swRingKeep;
        surfaceWeatherRingCrest = min(swRings.z, 1.0) * swRingKeep;
      }
    }
`;

/** After the water's colour is composed: a ring's crest catches the sky. */
export const SURFACE_WEATHER_WATER_CREST_FRAGMENT = `
  if (surfaceWeatherRingCrest > 0.0) {
    outgoingLight.rgb = mix(
      outgoingLight.rgb,
      surfaceWeatherSkyAlong(reflectDir) * 1.15,
      surfaceWeatherRingCrest * ${f(S.ringCrest)} * topWaterFace
    );
  }
`;

/**
 * The far layer's own: the coat it wears where snow near the player lies
 * as blocks, in drifts that fill in as the cover grows, averaged at the
 * footprint it is seen at.
 */
export const SURFACE_WEATHER_FAR_FUNCTIONS = `
uniform vec3 uSurfaceCoatColor;

// Where the coat drifts first (low) and last (high), 0..1, in patches of a
// few blocks.
float surfaceCoatDrift(vec2 xz) {
  float drift = surfaceWeatherNoise(xz * ${f(1 / S.driftScaleLarge, 6)}) * ${f(S.driftWeightLarge)}
    + surfaceWeatherNoise(xz * ${f(1 / S.driftScaleSmall, 6)} + vec2(17.3)) * ${f(1 - S.driftWeightLarge)};
  return clamp((drift - 0.5) * ${f(S.driftContrast)} + 0.5, 0.0, 1.0);
}

// The share of texels the coat covers at a drift: an even speckle at
// first, then drifts that fill in, then white ground with rare gaps.
float surfaceCoatDensity(float coat, float drift) {
  float drifts = (coat - ${f(S.driftStart)}) * ${f(1 / (1 - S.driftStart))};
  return max(
    smoothstep(drift - ${f(S.driftSoftness)}, drift + ${f(S.driftSoftness)}, drifts),
    coat * ${f(S.coatSpeckle)}
  ) * min(coat * 25.0, 1.0);
}

// The density averaged over the drifts.
float surfaceCoatMean(float coat) {
  float c = clamp(coat, 0.0, 1.0);
  float speckle = c * ${f(S.coatSpeckle)};
  float drifts = (c - ${f(S.driftStart)}) * ${f(1 / (1 - S.driftStart))};
  return speckle + (1.0 - speckle) * smoothstep(${f(S.coatMean.from)}, ${f(S.coatMean.to)}, drifts);
}

// The far layer's ground under the weather: the wet ground the chunks draw
// and the snow laid near the player as blocks, averaged at the footprint it
// is seen at (no texels, no pocks, no rings), so the two meet without a seam.
vec3 surfaceWeatherFarAlbedo(vec3 albedo, vec3 p, vec3 normal, float footprint, out float wetUp) {
  vec4 weather = surfaceWeatherSample(p.xz);
  float above = surfaceWeatherAbove(p.xz, p.y, weather.a);
  float up = smoothstep(${f(S.upFrom)}, ${f(S.upTo)}, normal.y);
  float wet = clamp(weather.g * uSurfaceWeather.y, 0.0, 1.0) * (1.0 - above) * surfaceWeatherFaceWet(normal);
  albedo = surfaceWeatherWetAlbedo(albedo, wet);
  float coat = clamp(weather.r * uSurfaceWeather.z, 0.0, 1.0) * above;
  float cover = up * mix(
    surfaceCoatDensity(coat, surfaceCoatDrift(p.xz)),
    surfaceCoatMean(coat),
    smoothstep(${f(S.driftFadeFrom)}, ${f(S.driftFadeTo)}, footprint)
  );
  wetUp = wet * up;
  return mix(albedo, uSurfaceCoatColor, cover);
}
`;

/** The far layer's land: declarations ahead of its `main`. */
export const SURFACE_WEATHER_FAR_DECLARATIONS = `
${SURFACE_WEATHER_UNIFORM_DECLARATIONS}
${SURFACE_WEATHER_FUNCTIONS}
${SURFACE_WEATHER_FAR_FUNCTIONS}
`;

/** The far land's albedo under the weather, after its face kinds pick the block. */
export const SURFACE_WEATHER_FAR_ALBEDO_FRAGMENT = `
  float surfaceWeatherFarWetUp = 0.0;
  if (uSurfaceWeather != vec3(0.0)) {
    albedo = surfaceWeatherFarAlbedo(albedo, p, normal, blockFootprint, surfaceWeatherFarWetUp);
  }
`;

/** The far land's wet sheen, once it is lit and before its fog. */
export const SURFACE_WEATHER_FAR_SHEEN_FRAGMENT = `
  if (surfaceWeatherFarWetUp > 0.0) {
    vec3 swView = normalize(cameraPosition - vWorldPosition);
    vec3 swSky = surfaceWeatherSkyAlong(reflect(-swView, vec3(0.0, 1.0, 0.0)));
    gl_FragColor.rgb = mix(
      gl_FragColor.rgb,
      swSky,
      surfaceWeatherSheen(swView.y, ${f((1 + S.sheenGrainFloor) / 2)}) * surfaceWeatherFarWetUp
    );
  }
`;

/**
 * Compile surface weather entirely out of a composed chunk fragment, for a
 * "never existed" program to compare the shipped one against at zero
 * weather (the same contract as `stripLocalLightsFromFragment`).
 */
export function stripSurfaceWeatherFromFragment(fragment: string): string {
  // The ground's passes as each variant carries them: compiled out of the
  // fluid variant.
  const forms = (pass: string) => [
    pass,
    pass.split(SURFACE_WEATHER_TERRAIN_OPEN).join("if (false) {"),
  ];
  let stripped = fragment;
  for (const pass of [
    SURFACE_WEATHER_UNIFORM_DECLARATIONS,
    SURFACE_WEATHER_CHUNK_UNIFORM_DECLARATIONS,
    SURFACE_WEATHER_FUNCTIONS,
    ...forms(SURFACE_WEATHER_ALBEDO_FRAGMENT),
    ...forms(SURFACE_WEATHER_LIGHT_FRAGMENT),
    SURFACE_WEATHER_WATER_DECLARATION,
    SURFACE_WEATHER_WATER_RINGS_FRAGMENT,
    SURFACE_WEATHER_WATER_CREST_FRAGMENT,
  ]) {
    stripped = stripped.replace(pass, "");
  }
  return stripped;
}

// ── TypeScript twins of the GLSL, for the tests that pin the look ─────────

const mix32 = (value: number) => {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
};

/** `surfaceWeatherHash(vec2)`. */
export function surfaceWeatherHash2(x: number, y: number): number {
  const qx = Math.floor(x) | 0;
  const qy = Math.floor(y) | 0;
  return (mix32((qx + mix32(qy)) >>> 0) >>> 8) / 16777216;
}

/** `surfaceWeatherHash(vec3)`. */
export function surfaceWeatherHash3(x: number, y: number, z: number): number {
  const qx = Math.floor(x) | 0;
  const qy = Math.floor(y) | 0;
  const qz = Math.floor(z) | 0;
  return (mix32((qx + mix32((qy + mix32(qz)) >>> 0)) >>> 0) >>> 8) / 16777216;
}

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** `surfaceWeatherNoise`. */
export function surfaceWeatherNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let tx = x - ix;
  let ty = y - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = surfaceWeatherHash2(ix, iy);
  const b = surfaceWeatherHash2(ix + 1, iy);
  const c = surfaceWeatherHash2(ix, iy + 1);
  const d = surfaceWeatherHash2(ix + 1, iy + 1);
  const bottom = a + (b - a) * tx;
  const top = c + (d - c) * tx;
  return bottom + (top - bottom) * ty;
}

/** `surfaceCoatDrift`. */
export function surfaceCoatDrift(x: number, z: number): number {
  const drift =
    surfaceWeatherNoise(x / S.driftScaleLarge, z / S.driftScaleLarge) *
      S.driftWeightLarge +
    surfaceWeatherNoise(
      x / S.driftScaleSmall + 17.3,
      z / S.driftScaleSmall + 17.3,
    ) *
      (1 - S.driftWeightLarge);
  return Math.min(1, Math.max(0, (drift - 0.5) * S.driftContrast + 0.5));
}

/** `surfaceCoatDensity`. */
export function surfaceCoatDensity(coat: number, drift: number): number {
  const drifts = (coat - S.driftStart) / (1 - S.driftStart);
  return (
    Math.max(
      smoothstep(drift - S.driftSoftness, drift + S.driftSoftness, drifts),
      coat * S.coatSpeckle,
    ) * Math.min(coat * 25, 1)
  );
}

/** `surfaceCoatMean`. */
export function surfaceCoatMean(coat: number): number {
  const c = Math.min(1, Math.max(0, coat));
  const speckle = c * S.coatSpeckle;
  const drifts = (c - S.driftStart) / (1 - S.driftStart);
  return (
    speckle + (1 - speckle) * smoothstep(S.coatMean.from, S.coatMean.to, drifts)
  );
}

/**
 * `surfaceWeatherPock`: the brightness a raindrop puts on a texel at a time
 * (0 when none), with the share of slots that splash.
 */
export function surfaceWeatherPock(
  texelX: number,
  texelZ: number,
  seconds: number,
  chance: number,
): number {
  const cellX = Math.floor(texelX / S.pockCellTexels);
  const cellZ = Math.floor(texelZ / S.pockCellTexels);
  const localX = texelX - cellX * S.pockCellTexels;
  const localZ = texelZ - cellZ * S.pockCellTexels;
  const t = seconds * S.pockRate + surfaceWeatherHash3(cellX, cellZ, -1) * 31;
  const slot = Math.floor(t);
  const age = (t - slot) / S.pockRate;
  if (!(surfaceWeatherHash3(cellX, cellZ, slot * 3) < chance)) return 0;
  const centreX =
    1 + Math.floor(surfaceWeatherHash3(cellX, cellZ, slot * 3 + 1) * 2);
  const centreZ =
    1 + Math.floor(surfaceWeatherHash3(cellX, cellZ, slot * 3 + 2) * 2);
  const reach = Math.abs(localX - centreX) + Math.abs(localZ - centreZ);
  const [dot, plus, ring] = S.pockFrames;
  if (age < dot) return reach < 0.5 ? S.pockWeights[0] : 0;
  if (age < plus) return Math.abs(reach - 1) < 0.5 ? S.pockWeights[1] : 0;
  if (age < ring) return Math.abs(reach - 2) < 0.5 ? S.pockWeights[2] : 0;
  return 0;
}

/** Splashes showing at once per square block at a time, with the share of slots that splash. */
export function surfacePocksShowing(
  cellX: number,
  cellZ: number,
  seconds: number,
  chance: number,
): boolean {
  const t = seconds * S.pockRate + surfaceWeatherHash3(cellX, cellZ, -1) * 31;
  const slot = Math.floor(t);
  const age = (t - slot) / S.pockRate;
  return (
    surfaceWeatherHash3(cellX, cellZ, slot * 3) < chance &&
    age < S.pockFrames[S.pockFrames.length - 1]
  );
}
