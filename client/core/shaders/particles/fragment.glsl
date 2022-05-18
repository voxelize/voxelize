uniform sampler2D uTexture;
uniform float uSunlightIntensity;
uniform vec2 uRepeat;

varying vec2 vUv;
varying vec4 vLights;

void main() {
  vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
  gl_FragColor = texture2D(uTexture, uv * uRepeat + vUv);
  float s = max(vLights.w * uSunlightIntensity * 1.2, 0.3);
  gl_FragColor.rgb *= vec3(s + vLights.r, s + vLights.g, s + vLights.b);
}
