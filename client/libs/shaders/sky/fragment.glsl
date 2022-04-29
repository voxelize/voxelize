uniform vec3 topColor;
uniform vec3 middleColor;
uniform vec3 bottomColor;
uniform float skyOffset;
uniform float voidOffset;
uniform float exponent;
uniform float exponent2;

varying vec3 vWorldPosition;

void main() {
  float h = normalize(vWorldPosition + skyOffset).y;
  float h2 = normalize(vWorldPosition + voidOffset).y;
  vec3 color = mix(middleColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
  gl_FragColor = vec4(mix(color, bottomColor, max(pow(max(-h2, 0.0), exponent2), 0.0)), 1.0);
}
