uniform mat4 uInverseProjection;
uniform mat4 uCameraWorld;

varying vec3 vRay;

void main() {
  // One triangle covering the screen; the ray through each pixel is
  // rebuilt from the camera instead of rasterized from geometry.
  vec4 view = uInverseProjection * vec4(position.xy, 1.0, 1.0);
  view /= view.w;
  vRay = mat3(uCameraWorld) * view.xyz;

  gl_Position = vec4(position.xy, 0.0, 1.0);
}
