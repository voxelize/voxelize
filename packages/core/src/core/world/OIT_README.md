# Order Independent Transparency (OIT) for Voxelize Chunks

## Overview

This implementation uses **Weighted Blended Order Independent Transparency** to solve transparency sorting artifacts in voxel chunk rendering. Traditional alpha blending requires depth-sorted rendering, which fails when transparent faces overlap within a single chunk mesh.

## How It Works

### 1. **Dual Render Target Approach**
- **Accumulation Buffer**: Stores weighted color contributions
- **Revealage Buffer**: Tracks transparency coverage

### 2. **Weight Function**
The weight is calculated per-fragment based on:
- Alpha value (transparency)
- Depth (distance from camera)
- Formula: `weight = clamp(α³ × 3000 × (1-z)³, 0.01, 3000)`

This ensures:
- Closer fragments have more influence
- More opaque fragments dominate
- Stable blending across overlapping geometry

### 3. **Shader Integration**
Transparent chunk shaders write to two targets:
- `gl_FragData[0]`: Weighted premultiplied color
- `gl_FragData[1]`: Revealage (alpha)

### 4. **Composition Pass**
A fullscreen quad blends the buffers:
```glsl
color = accum.rgb / max(accum.a, 0.00001)
alpha = 1.0 - reveal
```

## Integration

### Example: Using OIT with Voxelize World

```typescript
import { OITManager } from "@voxelize/core";

class MyRenderer {
  private oitManager: OITManager;
  
  constructor(renderer: WebGLRenderer, width: number, height: number) {
    this.oitManager = new OITManager(renderer, {
      enabled: true,
      width,
      height,
    });
  }
  
  render(world: World, camera: Camera) {
    const gl = this.renderer.getContext();
    
    // 1. Render opaque geometry normally
    world.chunks.loaded.forEach((chunk) => {
      // Render opaque meshes
    });
    
    // 2. Enable OIT mode for transparent chunks
    world.chunks.loaded.forEach((chunk) => {
      chunk.setOITMode(true);
    });
    
    // 3. Prepare OIT buffers
    this.oitManager.prepareTransparentPass();
    
    // 4. Configure blend state for accumulation
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.ONE, gl.ONE,
      gl.ZERO, gl.ONE_MINUS_SRC_ALPHA
    );
    
    // 5. Render to accumulation buffer
    this.renderer.setRenderTarget(this.oitManager.accumTarget);
    // Render transparent meshes
    
    // 6. Configure blend state for revealage
    gl.blendFuncSeparate(
      gl.ZERO, gl.ONE_MINUS_SRC_COLOR,
      gl.ZERO, gl.ONE_MINUS_SRC_ALPHA
    );
    
    // 7. Render to revealage buffer
    this.renderer.setRenderTarget(this.oitManager.revealTarget);
    // Render transparent meshes again
    
    // 8. Restore blend state
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // 9. Composite OIT result
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
```

## Performance Considerations

- **Memory**: Adds two fullscreen render targets (half-float RGBA)
- **Fill Rate**: Transparent fragments are written twice
- **No Sorting**: Eliminates CPU overhead of depth sorting
- **Single Pass**: Each mesh rendered once per target

## Limitations

- Requires WebGL2 or `WEBGL_draw_buffers` extension
- Works best with moderate transparency (0.2 - 0.8 alpha)
- Very transparent surfaces (< 0.1 alpha) may appear darker

## Shader Requirements

Your transparent chunk materials must:
1. Have `USE_OIT` define when OIT is enabled
2. Include `uUseOIT` uniform (boolean)
3. Write to `gl_FragData[0]` and `gl_FragData[1]` instead of `gl_FragColor`

This is automatically handled by `chunk.setOITMode(true)`.

## References

- [Weighted Blended OIT Paper](http://casual-effects.blogspot.com/2015/03/implemented-weighted-blended-order.html)
- [Three.js Multiple Render Targets](https://threejs.org/docs/#api/en/renderers/WebGLRenderTarget)


