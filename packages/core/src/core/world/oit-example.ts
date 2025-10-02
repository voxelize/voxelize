import { Camera, Mesh, Vector2, WebGLRenderer } from "three";

import { OITManager } from "./oit-manager";

import { World } from "./index";

export class OITRenderer {
  private oitManager: OITManager;
  private world: World;
  private renderer: WebGLRenderer;

  constructor(world: World, renderer: WebGLRenderer) {
    this.world = world;
    this.renderer = renderer;

    const { width, height } = renderer.getSize(new Vector2());
    this.oitManager = new OITManager(renderer, {
      enabled: true,
      width,
      height,
    });

    this.enableOITForTransparentChunks();
  }

  private enableOITForTransparentChunks() {
    this.world.chunks.loaded.forEach((chunk) => {
      chunk.setOITMode(true);
    });
  }

  private getTransparentMeshes() {
    const transparentMeshes: Mesh[] = [];
    this.world.chunks.loaded.forEach((chunk) => {
      transparentMeshes.push(...chunk.getTransparentMeshes());
    });
    return transparentMeshes;
  }

  render(camera: Camera) {
    const gl = this.renderer.getContext();

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.world, camera);

    const transparentMeshes = this.getTransparentMeshes();
    if (transparentMeshes.length === 0) return;

    this.oitManager.prepareTransparentPass();

    gl.enable(gl.BLEND);
    gl.depthMask(false);

    this.renderer.setRenderTarget(this.oitManager.accumTarget);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquation(gl.FUNC_ADD);

    transparentMeshes.forEach((mesh) => {
      if (mesh.parent) {
        mesh.parent.remove(mesh);
        this.world.add(mesh);
      }
    });
    this.renderer.render(this.world, camera);

    this.renderer.setRenderTarget(this.oitManager.revealTarget);
    gl.blendFuncSeparate(
      gl.ZERO,
      gl.ONE_MINUS_SRC_COLOR,
      gl.ZERO,
      gl.ONE_MINUS_SRC_ALPHA
    );

    this.renderer.render(this.world, camera);

    transparentMeshes.forEach((mesh) => {
      this.world.remove(mesh);
      const chunks = Array.from(this.world.chunks.loaded.values());
      const chunk = chunks.find((c) => c.getTransparentMeshes().includes(mesh));
      if (chunk) {
        chunk.group.add(mesh);
      }
    });

    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.renderer.setRenderTarget(null);
    this.oitManager.composite();
  }

  onResize(width: number, height: number) {
    this.oitManager.setSize(width, height);
  }

  dispose() {
    this.oitManager.dispose();
  }
}
