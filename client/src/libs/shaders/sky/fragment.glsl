uniform vec3 uTopColor;
uniform vec3 uMiddleColor;
uniform vec3 uBottomColor;
uniform float uSkyOffset;
uniform float uVoidOffset;
uniform float uExponent;
uniform float uExponent2;

varying vec3 vWorldPosition;

void main() {
  float h = normalize(vWorldPosition + uSkyOffset).y;
  float h2 = normalize(vWorldPosition + uVoidOffset).y;
  vec3 color = mix(uMiddleColor, uTopColor, max(pow(max(h, 0.0), uExponent), 0.0));
  gl_FragColor = vec4(mix(color, uBottomColor, max(pow(max(-h2, 0.0), uExponent2), 0.0)), 1.0);
}
