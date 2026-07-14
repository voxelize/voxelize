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
  float h = normalize(vWorldPosition + uSkyOffset).y;
  float h2 = normalize(vWorldPosition + uVoidOffset).y;
  vec3 color = mix(uMiddleColor, uTopColor, max(pow(max(h, 0.0), uExponent), 0.0));
  color = mix(color, uBottomColor, max(pow(max(-h2, 0.0), uExponent2), 0.0));
  color = mix(color, uUnderwaterAmbient, uUnderwaterFade);
  gl_FragColor = vec4(color, 1.0);
}
