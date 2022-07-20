uniform vec3 uFogColor;
uniform vec3 uCloudColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uCloudAlpha;

varying vec4 vWorldPosition;

void main() {
  gl_FragColor = vec4(uCloudColor, uCloudAlpha);

  // fog
  vec3 fogOrigin = cameraPosition;
  float depth = sqrt(pow(vWorldPosition.x - fogOrigin.x, 2.0) + pow(vWorldPosition.z - fogOrigin.z, 2.0)) / 8.0;

  float fogFactor = smoothstep(uFogNear, uFogFar, depth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
}
