#include <sky_fog_pars_fragment>

uniform vec3 uCloudColor;
uniform float uCloudAlpha;
uniform float uCloudFogDistanceScale;
uniform float uCloudEndFadeNear;
uniform float uCloudEndFadeFar;
uniform float uCloudSideShade;
uniform float uCloudBottomShade;
uniform float uCloudSunTint;

varying vec4 vWorldPosition;
varying vec3 vCloudNormal;

void main() {
  // Cloud faces are axis aligned, so splitting three ways by facing is enough
  // to give a bank of cloud a top, a shadowed underside, and flanks. Without
  // it every face renders at exactly one brightness and even a deeply
  // billowed deck reads as a flat sheet of paper.
  float shade = vCloudNormal.y > 0.5
    ? 1.0
    : (vCloudNormal.y < -0.5 ? uCloudBottomShade : uCloudSideShade);

  // Flanks turned away from the sun lose some brightness, which is what
  // separates the lit side of a billow from the shaded one. Applied as a
  // darkening rather than a boost: cloud colours sit close to white already,
  // and anything that scales above 1.0 clips flat and erases the shading it
  // was added to create.
  float towardSun = max(0.0, dot(vCloudNormal, normalize(uSunDirection)));
  shade *= mix(1.0 - uCloudSunTint, 1.0, towardSun);

  gl_FragColor = vec4(uCloudColor * shade, uCloudAlpha);

  #include <sky_fog_fragment>

  float cloudEndDistance = sqrt(dot(vWorldPosition.xz - cameraPosition.xz, vWorldPosition.xz - cameraPosition.xz));
  float cloudEndDepth = cloudEndDistance / max(uCloudFogDistanceScale, 0.001);
  float cloudEndFade = smoothstep(uCloudEndFadeNear, uCloudEndFadeFar, cloudEndDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, cloudEndFade);
  gl_FragColor.a *= 1.0 - cloudEndFade;
}
