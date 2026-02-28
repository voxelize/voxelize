import { Scene, Mesh, PerspectiveCamera, BufferGeometry } from "three";
import { WebGPURenderer, MeshBasicNodeMaterial } from "three/webgpu";

export interface TestContext {
  renderer: InstanceType<typeof WebGPURenderer>;
  scene: Scene;
  camera: PerspectiveCamera;
  dispose: () => void;
}

export async function createTestContext(): Promise<TestContext> {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  document.body.appendChild(canvas);

  const renderer = new WebGPURenderer({ canvas, forceWebGL: true });
  await renderer.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.1, 10);
  camera.position.z = 3;

  return {
    renderer,
    scene,
    camera,
    dispose() {
      renderer.dispose();
      canvas.remove();
    },
  };
}

export function renderWithMaterial(
  ctx: TestContext,
  geometry: BufferGeometry,
  material: InstanceType<typeof MeshBasicNodeMaterial>,
) {
  const mesh = new Mesh(geometry, material);
  ctx.scene.add(mesh);
  ctx.renderer.render(ctx.scene, ctx.camera);
  ctx.scene.remove(mesh);
  mesh.geometry.dispose();
}
