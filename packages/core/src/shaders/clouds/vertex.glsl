varying vec4 vWorldPosition;
varying vec3 vCloudNormal;

void main() {
  vWorldPosition = modelMatrix * vec4(position, 1.0);
  vCloudNormal = normalize(mat3(modelMatrix) * normal);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
