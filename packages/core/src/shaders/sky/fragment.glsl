uniform vec3 uTopColor;
uniform vec3 uMiddleColor;
uniform vec3 uBottomColor;
uniform float uSkyOffset;
uniform float uVoidOffset;
uniform float uExponent;
uniform float uExponent2;
uniform vec3 uUnderwaterAmbient;
uniform float uUnderwaterFade;
// Whether the camera is under water (0 or 1), and the water's in-scatter
// tilt: brighter looking up, darker looking down (water-optics.ts).
uniform float uUnderwaterSubmerged;
uniform float uUnderwaterInScatterTilt;
// The celestial disc (sun by day, moon by night) and its light, for the
// disc the dome draws inside the Snell window while submerged.
uniform vec3 uCelestialDirection;
uniform vec3 uSunColor;
uniform float uSunlightIntensity;

varying vec3 vWorldPosition;

// The disc seen through the surface, drawn in square angular pixels so it
// reads as the same pixel sun, not a smooth blob.
const float SNELL_SUN_PIXEL = 0.0065;
const float SNELL_SUN_RADIUS_PIXELS = 5.0;

void main() {
  // Sky colors are view-relative. Sampling absolute world coordinates makes
  // the gradient collapse around the origin when a camera-centered dome
  // crosses it, producing a radial seam far from (0, 0, 0).
  vec3 skyPosition = vWorldPosition - cameraPosition;
  float h = normalize(skyPosition + uSkyOffset).y;
  float h2 = normalize(skyPosition + uVoidOffset).y;
  vec3 color = mix(uMiddleColor, uTopColor, max(pow(max(h, 0.0), uExponent), 0.0));
  color = mix(color, uBottomColor, max(pow(max(-h2, 0.0), uExponent2), 0.0));
  // From under water the sky only reaches the eye through the Snell
  // window: a ray within the critical angle of straight up leaves the
  // water bent away from the vertical, so the whole sky, horizon to
  // zenith, shows squeezed into that cone, with the sun at its refracted
  // place. Every other ray is reflected back down and sees only the
  // water's in-scatter, which is also what any ray that meets no geometry
  // near the horizon must read as (past the loaded surface, over a
  // drop-off), never a pale horizon band. Depth dims the window toward the
  // in-scatter.
  if (uUnderwaterSubmerged > 0.5) {
    vec3 viewDir = normalize(skyPosition);
    vec3 inScatter = uUnderwaterAmbient * (1.0 + uUnderwaterInScatterTilt * viewDir.y);
    vec3 underColor = inScatter;
    if (viewDir.y > 0.0) {
      vec3 airDir = refract(viewDir, vec3(0.0, -1.0, 0.0), 1.333);
      if (dot(airDir, airDir) > 0.5) {
        vec3 windowSky = mix(uMiddleColor, uTopColor, pow(max(airDir.y, 0.0), uExponent));
        vec3 sunSide = normalize(cross(uCelestialDirection, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
        vec3 sunUp = cross(sunSide, uCelestialDirection);
        vec2 sunPixel = floor(vec2(dot(airDir, sunSide), dot(airDir, sunUp)) / SNELL_SUN_PIXEL) + 0.5;
        float sunDisc = step(dot(sunPixel, sunPixel), SNELL_SUN_RADIUS_PIXELS * SNELL_SUN_RADIUS_PIXELS)
          * step(0.0, dot(airDir, uCelestialDirection));
        float sunGlow = pow(max(dot(airDir, uCelestialDirection), 0.0), 48.0);
        windowSky += uSunColor * uSunlightIntensity * (sunDisc * 2.2 + sunGlow * 0.35);
        float transmit = 1.0 - (0.02 + 0.98 * pow(1.0 - airDir.y, 5.0));
        underColor = mix(inScatter, windowSky, transmit);
      }
    }
    color = mix(underColor, inScatter, uUnderwaterFade);
  }
  gl_FragColor = vec4(color, 1.0);
}
