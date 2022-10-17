uniform vec3 overlay;
uniform float opacity;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(mix(inputColor.rgb, overlay, opacity), inputColor.a);
}