uniform vec3 uTopColor;
uniform vec3 uMiddleColor;
uniform vec3 uBottomColor;
uniform float uSkyOffset;
uniform float uVoidOffset;
uniform float uExponent;
uniform float uExponent2;
uniform vec3 uUnderwaterAmbient;
uniform float uUnderwaterFade;

varying vec3 vWorldPosition;

void main() {
  // Sky colors are view-relative. Sampling absolute world coordinates makes
  // the gradient collapse around the origin when a camera-centered dome
  // crosses it, producing a radial seam far from (0, 0, 0).
  vec3 skyPosition = vWorldPosition - cameraPosition;
  float h = normalize(skyPosition + uSkyOffset).y;
  float h2 = normalize(skyPosition + uVoidOffset).y;
  vec3 color = mix(uMiddleColor, uTopColor, max(pow(max(h, 0.0), uExponent), 0.0));
  color = mix(color, uBottomColor, max(pow(max(-h2, 0.0), uExponent2), 0.0));
  // From under water, sky reaches the eye mostly from overhead. Any ray
  // that meets no geometry near the horizon runs through water forever —
  // past the loaded surface, over a drop-off — and must read as the water,
  // not as a pale band of horizon with a hard edge where the surface mesh
  // ends. The fade follows the ceiling's own slope (the surface shows the
  // sky in proportion to the cosine to straight up), with no window edge,
  // so no disc of sky shows through a translucent ceiling. It is only
  // non-zero while submerged, so a sliver of it stands in for "under water".
  float submerged = clamp(uUnderwaterFade * 40.0, 0.0, 1.0);
  float outsideWindow = 1.0 - clamp(normalize(skyPosition).y, 0.0, 1.0);
  color = mix(color, uUnderwaterAmbient, max(uUnderwaterFade, outsideWindow * submerged));
  gl_FragColor = vec4(color, 1.0);
}
