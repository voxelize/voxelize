import {
    HalfFloatType,
    Mesh,
    NearestFilter,
    OrthographicCamera,
    PlaneGeometry,
    RGBAFormat,
    Scene,
    ShaderMaterial,
    WebGLRenderer,
    WebGLRenderTarget,
} from "three";

const OIT_COMPOSITE_VERTEX = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const OIT_COMPOSITE_FRAGMENT = `
uniform sampler2D uAccum;
uniform sampler2D uReveal;
varying vec2 vUv;

void main() {
  vec4 accum = texture2D(uAccum, vUv);
  float reveal = texture2D(uReveal, vUv).r;
  
  if (reveal >= 0.999) {
    discard;
  }
  
  vec3 color = accum.rgb / max(accum.a, 0.00001);
  gl_FragColor = vec4(color, 1.0 - reveal);
}
`;

export type OITManagerOptions = {
  enabled: boolean;
  width: number;
  height: number;
};

export class OITManager {
  public enabled: boolean;
  public accumTarget: WebGLRenderTarget;
  public revealTarget: WebGLRenderTarget;

  private compositeScene: Scene;
  private compositeCamera: OrthographicCamera;
  private compositeMaterial: ShaderMaterial;
  private compositeMesh: Mesh;

  constructor(private renderer: WebGLRenderer, options: OITManagerOptions) {
    this.enabled = options.enabled;

    const { width, height } = options;

    this.accumTarget = new WebGLRenderTarget(width, height, {
      format: RGBAFormat,
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.revealTarget = new WebGLRenderTarget(width, height, {
      format: RGBAFormat,
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.compositeScene = new Scene();
    this.compositeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.compositeMaterial = new ShaderMaterial({
      vertexShader: OIT_COMPOSITE_VERTEX,
      fragmentShader: OIT_COMPOSITE_FRAGMENT,
      uniforms: {
        uAccum: { value: this.accumTarget.texture },
        uReveal: { value: this.revealTarget.texture },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const geometry = new PlaneGeometry(2, 2);
    this.compositeMesh = new Mesh(geometry, this.compositeMaterial);
    this.compositeScene.add(this.compositeMesh);
  }

  setSize(width: number, height: number) {
    this.accumTarget.setSize(width, height);
    this.revealTarget.setSize(width, height);
  }

  prepareTransparentPass() {
    if (!this.enabled) return;

    this.renderer.setRenderTarget(this.accumTarget);
    this.renderer.clear(true, true, false);

    this.renderer.setRenderTarget(this.revealTarget);
    this.renderer.clear(true, true, false);
  }

  composite(target: WebGLRenderTarget | null = null) {
    if (!this.enabled) return;

    this.renderer.setRenderTarget(target);
    this.renderer.render(this.compositeScene, this.compositeCamera);
  }

  dispose() {
    this.accumTarget.dispose();
    this.revealTarget.dispose();
    this.compositeMaterial.dispose();
    this.compositeMesh.geometry.dispose();
  }
}
