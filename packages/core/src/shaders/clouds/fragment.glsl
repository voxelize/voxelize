#include <sky_fog_pars_fragment>

uniform vec3 uCloudColor;
uniform float uCloudAlpha;
uniform float uCloudFogDistanceScale;
uniform float uCloudEndFadeNear;
uniform float uCloudEndFadeFar;

varying vec4 vWorldPosition;

void main() {
  gl_FragColor = vec4(uCloudColor, uCloudAlpha);

  #include <sky_fog_fragment>

  float cloudEndDistance = sqrt(dot(vWorldPosition.xz - cameraPosition.xz, vWorldPosition.xz - cameraPosition.xz));
  float cloudEndDepth = cloudEndDistance / max(uCloudFogDistanceScale, 0.001);
  float cloudEndFade = smoothstep(uCloudEndFadeNear, uCloudEndFadeFar, cloudEndDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, cloudEndFade);
  gl_FragColor.a *= 1.0 - cloudEndFade;
}
