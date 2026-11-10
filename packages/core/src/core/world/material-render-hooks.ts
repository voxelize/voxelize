import { Material, Renderer } from "three/webgpu";

const INSTALLED = Symbol.for("voxelize.materialRenderHooks");

type RenderObject = Renderer["renderObject"];

/**
 * Gives every WebGPU draw the `material.onBeforeRender` call three's WebGL
 * renderer made and its WebGPU renderer dropped: `Renderer.renderObject`
 * calls only the object's hook. Hooks the engine and games hang on a
 * material — a lazily animated face texture advancing while it is on screen,
 * held and dropped copies of a block following their face material
 * (`forwardDraws`), an instanced body measuring the geometry it draws — fire
 * again, once per draw, in every renderer (the world's, thumbnails', canvas
 * views'). A material without its own hook costs one comparison.
 *
 * Patches `Renderer.prototype` once; three reads `this.renderObject` on every
 * render, and direct `renderer.renderObject` calls (transparency passes) go
 * through it too.
 */
export function installMaterialRenderHooks(): void {
  const proto = Renderer.prototype as Renderer & { [INSTALLED]?: true };
  if (proto[INSTALLED]) return;
  const renderObject = proto.renderObject;
  const noHook = Material.prototype.onBeforeRender;
  proto.renderObject = function (
    this: Renderer,
    object,
    scene,
    camera,
    geometry,
    material,
    group,
    ...rest
  ) {
    if (material.onBeforeRender !== noHook) {
      material.onBeforeRender(
        this as never,
        scene,
        camera,
        geometry,
        object,
        group as never,
      );
    }
    return renderObject.call(
      this,
      object,
      scene,
      camera,
      geometry,
      material,
      group,
      ...rest,
    );
  } as RenderObject;
  proto[INSTALLED] = true;
}
