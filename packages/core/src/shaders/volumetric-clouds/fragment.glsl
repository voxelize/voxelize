precision highp sampler3D;

#include <sky_fog_pars_fragment>

#define MAX_LAYERS 2
#define VOXEL_STEPS 256
#define SOFT_STEPS 64

uniform sampler3D uCloudNoise;
uniform vec3 uNoiseSize;
uniform sampler2D uSceneDepth;
uniform float uSceneDepthReady;
uniform mat4 uInverseProjection;
uniform vec2 uResolution;
// The see-through layers (glass, portals, water, particles) composite over
// the scene in one pass, and nothing records where they stand, so a deck
// drawn after them would paint over a pane in front of it. With them in
// view the deck draws in two halves split at their distance: 1 marches the
// part behind them, under their composite; 2 the part in front, over it;
// 0 marches the whole ray. The split comes from the accumulation's weight
// target: its alpha-weighted sum (r) and that sum times each layer's view
// depth (g).
uniform float uBlendedSplit;
uniform sampler2D uBlendedLayers;

uniform vec3 uCloudColor;
uniform float uCloudFogDistanceScale;
uniform float uCloudSideShade;
uniform float uCloudBottomShade;
uniform float uCloudSunTint;

// 0: voxel (the deck is cubes, each one a texel of the volume), 1: soft.
uniform float uStyle;
uniform float uMaxDistance;
uniform float uFadeStart;
uniform int uLayerCount;
// bottom, top, coverage, extinction per block at full density
uniform vec4 uLayerSpan[MAX_LAYERS];
// cell size in blocks (x, y, z), coverage scale in tiles
uniform vec4 uLayerCell[MAX_LAYERS];
// bottom rounding, top rounding, shade floor, noise offset
uniform vec4 uLayerShape[MAX_LAYERS];
// The slab's drift, wrapped on the CPU so it stays small at any clock: the
// cell grid's shift within one cell (x, z), then the shift of the detail
// noise and of the coverage map, each in its own tiles (x, z, x, z). A raw
// drift is the shared clock times the speed, far past what a float32 can
// step smoothly.
uniform vec2 uLayerGridShift[MAX_LAYERS];
uniform vec4 uLayerNoiseShift[MAX_LAYERS];

varying vec3 vRay;
varying vec3 vViewRay;

// Density at p. `stepped` makes the voxel style's cells all-or-nothing, for
// deciding where a cube stands; unstepped, the filtered field is smooth,
// for light, which must never see the cell grid.
float layerDensity(int i, vec3 p, bool stepped) {
  vec4 span = uLayerSpan[i];
  vec4 cell = uLayerCell[i];
  vec4 shape = uLayerShape[i];

  float h = (p.y - span.x) / (span.y - span.x);
  if (h < 0.0 || h > 1.0) return 0.0;

  vec4 shift = uLayerNoiseShift[i];
  vec3 q = vec3(p.x, p.y - span.x, p.z) / cell.xyz;
  // Whole-texel offset, so voxel cell centres stay on texel centres.
  vec3 still = (q + vec3(shape.w, 0.0, floor(shape.w * 1.7))) / uNoiseSize;
  vec4 n = texture(uCloudNoise, still + vec3(shift.x, 0.0, shift.y));
  float coverageMap = texture(
    uCloudNoise,
    vec3(still.x / cell.w + shift.z + 0.31, 0.5, still.z / cell.w + shift.w + 0.17)
  ).b;

  // Rounded underside and top, so a bank is a billow and not a slab.
  float profile = smoothstep(0.0, shape.x, h) * (1.0 - smoothstep(1.0 - shape.y, 1.0, h));
  float coverage = clamp(span.z * (0.25 + 1.5 * coverageMap), 0.0, 1.0);
  float d = clamp((n.r * profile - (1.0 - coverage)) / max(coverage, 1e-3), 0.0, 1.0);

  if (uStyle > 0.5) {
    // The soft style frays its edges with the finer cells.
    d = clamp(d - (1.0 - n.g) * 0.35 * (1.0 - d), 0.0, 1.0);
  } else if (stepped) {
    d = d > 0.06 ? 1.0 : 0.0;
  }

  return d * span.w;
}

float henyeyGreenstein(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

vec3 sunDirection() {
  return normalize(uSunDirection);
}

// How much sun reaches p through the cloud toward it, through the smooth
// field so the shadow falls in gradients, not cell by cell.
float sunVisibility(int i, vec3 p, vec3 toSun) {
  vec4 cell = uLayerCell[i];
  float stepLength = max(cell.y, 3.0);
  float opticalDepth = 0.0;
  for (int k = 1; k <= 4; k++) {
    float along = stepLength * float(k * k) * 0.75;
    opticalDepth += layerDensity(i, p + toSun * along, false) * stepLength * float(2 * k - 1) * 0.75;
  }
  return exp(-opticalDepth * 0.5);
}

// Light leaving a cloud at p toward the eye. `thickness` is the optical
// depth of the cloud around p: thin cloud lets the sun through.
vec3 cloudLight(int i, vec3 p, vec3 normal, float hasNormal, vec3 rd, float thickness) {
  vec4 span = uLayerSpan[i];
  vec3 toSun = sunDirection();
  float h = clamp((p.y - span.x) / (span.y - span.x), 0.0, 1.0);

  // A whisper of the cube's faces, so the outline reads as voxels; the
  // light across a face is what carries the volume.
  float shade = 1.0;
  if (hasNormal > 0.5) {
    float face = normal.y > 0.5
      ? 1.0
      : (normal.y < -0.5 ? uCloudBottomShade : uCloudSideShade);
    shade = mix(1.0, face, 0.3);
  }

  // Skylight falls on the tops; the underside of a thick bank is greyer.
  float ambient = mix(uLayerShape[i].z, 1.0, smoothstep(0.0, 1.0, h));
  float sunVis = toSun.y > -0.05 ? sunVisibility(i, p + normal * hasNormal, toSun) : 0.0;
  float facing = hasNormal > 0.5 ? dot(normal, toSun) * 0.5 + 0.5 : 0.75;
  float direct = sunVis * mix(0.5, 1.0, facing);

  // What the sun does not reach is lit by the sky above: a touch cooler,
  // barely darker. Fair-weather cloud stays white underneath; a deep grey
  // underside reads as rain on the way.
  vec3 skyTint = uSkyFogTopColor / max(max(uSkyFogTopColor.r, max(uSkyFogTopColor.g, uSkyFogTopColor.b)), 1e-3);
  vec3 shadowColor = mix(vec3(1.0), skyTint, 0.12) * 0.9;
  vec3 lit = ambient * shade * mix(shadowColor, vec3(1.0), direct);

  vec3 sunLight = uSunColor * uSunlightIntensity * uDirectSunlight;
  float cosTheta = dot(rd, toSun);
  // Sun shining through: a cloud between the eye and the sun glows, the
  // thinner the brighter, and its sunlit rim silvers.
  float through = henyeyGreenstein(cosTheta, 0.72) * exp(-thickness * 0.45);
  float rim = henyeyGreenstein(cosTheta, 0.5) * sunVis;

  return uCloudColor * lit + sunLight * (through * 0.55 + rim * 0.3);
}

// Voxel style: the cells decide where cloud stands, so the outline is cubes;
// each surface the ray meets is lit and made see-through from the smooth
// field, so no cell edge shows across a face.
void marchVoxel(int i, vec3 ro, vec3 rd, float t0, float t1, bool resumed,
                inout vec3 color, inout float transmittance, inout float weightedDistance) {
  vec4 span = uLayerSpan[i];
  vec3 cell = uLayerCell[i].xyz;
  vec2 gridShift = uLayerGridShift[i];
  vec3 origin = vec3(-gridShift.x, span.x, -gridShift.y);

  vec3 og = (ro - origin) / cell;
  vec3 dg = rd / cell;
  vec3 safeDg = sign(dg) * max(abs(dg), vec3(1e-6));
  vec3 stepSign = sign(safeDg);

  float t = t0;
  vec3 idx = floor(og + dg * (t + 1e-3));
  vec3 tDelta = abs(1.0 / safeDg);
  vec3 nextBoundary = (idx + max(stepSign, 0.0) - og) / safeDg;

  vec3 normal = vec3(0.0, -sign(rd.y), 0.0);
  float hasNormal = t0 > 0.0 ? 1.0 : 0.0;
  // A march that picks up where the front half stopped, inside a bank, goes
  // on through its mist instead of meeting a face at the split.
  bool wasCloudy = resumed && layerDensity(i, (idx + 0.5) * cell + origin, true) > 0.0;
  float probe = min(cell.x, cell.y);

  for (int s = 0; s < VOXEL_STEPS; s++) {
    vec3 center = (idx + 0.5) * cell + origin;
    bool cloudy = layerDensity(i, center, true) > 0.0;

    // Only where the ray comes out of open air into cloud: the walls
    // between two cloudy cells are inside it.
    if (cloudy && !wasCloudy) {
      vec3 p = ro + rd * t;
      float thickness = (
        layerDensity(i, p + rd * probe, false) +
        layerDensity(i, p + rd * probe * 2.5, false) +
        layerDensity(i, p + rd * probe * 5.0, false)
      ) * probe * 1.7;
      // The outline stays a crisp cube: even a thin edge is mostly opaque,
      // and only a little of what is behind it shows through.
      float alpha = mix(0.8, 1.0, 1.0 - exp(-thickness));
      // A face right at the eye (walking into a bank) fades in, so the cloud
      // closes around you as mist instead of a wall.
      alpha *= smoothstep(1.0, 28.0, t);
      float absorbed = transmittance * alpha;
      color += absorbed * cloudLight(i, p, normal, hasNormal, rd, thickness);
      weightedDistance += absorbed * t;
      transmittance *= 1.0 - alpha;
      if (transmittance < 0.01) break;
    }
    float tExit = min(min(nextBoundary.x, nextBoundary.y), nextBoundary.z);

    // Inside the cloud the air is mist: thick, but seen through for a few
    // dozen blocks. Lit by the sky alone, which is cheap and close enough
    // in the grey of a cloud's interior.
    if (cloudy && wasCloudy) {
      float segment = min(tExit, t1) - t;
      vec3 p = ro + rd * (t + segment * 0.5);
      float mist = 1.0 - exp(-segment * 0.03);
      float h = clamp((p.y - span.x) / (span.y - span.x), 0.0, 1.0);
      vec3 skyTint = uSkyFogTopColor / max(max(uSkyFogTopColor.r, max(uSkyFogTopColor.g, uSkyFogTopColor.b)), 1e-3);
      vec3 mistColor = uCloudColor * mix(mix(vec3(1.0), skyTint, 0.12) * 0.9, vec3(0.97), h);
      float absorbed = transmittance * mist;
      color += absorbed * mistColor;
      weightedDistance += absorbed * (t + segment * 0.5);
      transmittance *= 1.0 - mist;
      if (transmittance < 0.01) break;
    }
    wasCloudy = cloudy;

    t = tExit;
    if (t >= t1) break;

    hasNormal = 1.0;
    if (nextBoundary.x <= nextBoundary.y && nextBoundary.x <= nextBoundary.z) {
      idx.x += stepSign.x;
      nextBoundary.x += tDelta.x;
      normal = vec3(-stepSign.x, 0.0, 0.0);
    } else if (nextBoundary.y <= nextBoundary.z) {
      idx.y += stepSign.y;
      nextBoundary.y += tDelta.y;
      normal = vec3(0.0, -stepSign.y, 0.0);
    } else {
      idx.z += stepSign.z;
      nextBoundary.z += tDelta.z;
      normal = vec3(0.0, 0.0, -stepSign.z);
    }
  }
}

void marchSoft(int i, vec3 ro, vec3 rd, float t0, float t1, float jitter,
               inout vec3 color, inout float transmittance, inout float weightedDistance) {
  float stepLength = max((t1 - t0) / float(SOFT_STEPS), 2.0);
  float t = t0 + stepLength * jitter;

  for (int s = 0; s < SOFT_STEPS; s++) {
    if (t >= t1) break;
    vec3 p = ro + rd * t;
    float d = layerDensity(i, p, false);
    if (d > 0.0) {
      float sampleTransmit = exp(-d * stepLength);
      float absorbed = transmittance * (1.0 - sampleTransmit);
      color += absorbed * cloudLight(i, p, vec3(0.0), 0.0, rd, d * stepLength * 4.0);
      weightedDistance += absorbed * t;
      transmittance *= sampleTransmit;
      if (transmittance < 0.01) break;
    }
    t += stepLength;
  }
}

vec2 layerSegment(int i, vec3 ro, vec3 rd, float start, float limit) {
  vec4 span = uLayerSpan[i];
  float inv = 1.0 / (abs(rd.y) > 1e-5 ? rd.y : 1e-5);
  float ta = (span.x - ro.y) * inv;
  float tb = (span.y - ro.y) * inv;
  float t0 = max(min(ta, tb), start);
  float t1 = min(max(ta, tb), limit);
  return vec2(t0, t1);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vRay);
  vec2 uv = gl_FragCoord.xy / uResolution;

  float limit = uMaxDistance;
  if (uSceneDepthReady > 0.5) {
    float z = texture(uSceneDepth, uv).r;
    if (z < 0.99999) {
      vec4 view = uInverseProjection * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      limit = min(limit, length(view.xyz / view.w));
    }
  }

  float start = 0.0;
  if (uBlendedSplit > 0.5) {
    vec2 layers = texelFetch(uBlendedLayers, ivec2(gl_FragCoord.xy), 0).rg;
    // Their mean view depth, weighted as the composite weighs them, as a
    // distance along this pixel's ray. None here: the front half is all.
    float split = limit;
    if (layers.r > 1e-6) {
      vec3 viewRay = normalize(vViewRay);
      split = (layers.g / layers.r) / max(-viewRay.z, 1e-4);
    }
    if (uBlendedSplit < 1.5) start = split;
    else limit = min(limit, split);
  }
  if (start >= limit) discard;

  // Interleaved gradient noise: steps start at a per-pixel offset so the
  // soft style's banding becomes a fine, fixed grain.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

  vec3 color = vec3(0.0);
  float transmittance = 1.0;
  float weightedDistance = 0.0;

  // Front to back: the layer the ray reaches first composites first.
  vec2 segA = uLayerCount > 0 ? layerSegment(0, ro, rd, start, limit) : vec2(1.0, 0.0);
  vec2 segB = uLayerCount > 1 ? layerSegment(1, ro, rd, start, limit) : vec2(1.0, 0.0);
  int first = segB.x < segA.x ? 1 : 0;

  for (int k = 0; k < MAX_LAYERS; k++) {
    int i = k == 0 ? first : 1 - first;
    vec2 seg = i == 0 ? segA : segB;
    if (seg.x >= seg.y || transmittance < 0.01) continue;
    if (uStyle > 0.5) {
      marchSoft(i, ro, rd, seg.x, seg.y, jitter, color, transmittance, weightedDistance);
    } else {
      marchVoxel(i, ro, rd, seg.x, seg.y, start > 0.0 && seg.x <= start, color, transmittance, weightedDistance);
    }
  }

  float alpha = 1.0 - transmittance;
  if (alpha < 0.003) discard;

  float meanDistance = weightedDistance / alpha;
  vec4 vWorldPosition = vec4(ro + rd * meanDistance, 1.0);

  gl_FragColor = vec4(color / alpha, alpha);

  #include <sky_fog_fragment>

  float endFade = smoothstep(uFadeStart, uMaxDistance, meanDistance);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, endFade);
  gl_FragColor.a *= 1.0 - endFade;
}
