---
sidebar_position: 2
---

# Block Textures

Apply textures to blocks on the client using images, colors, canvas, or animated sources. Blocks must be registered on the server first—see [Block Registry](./block-registry.md) for server-side configuration.

## Two Texturing APIs

Voxelize provides two methods for applying textures:

| Method                | Use Case                       | Face Type Required      |
| --------------------- | ------------------------------ | ----------------------- |
| `applyBlockTexture`   | Same texture on all instances  | Standard or Independent |
| `applyBlockTextureAt` | Different texture per instance | **Isolated only**       |

Understanding this distinction is critical—using the wrong method will silently fail or produce unexpected results.

## Standard Texturing

Use `applyBlockTexture` for blocks where every instance looks identical:

```ts title="Basic Usage"
import * as VOXELIZE from "@voxelize/core";
import { Color } from "three";

// Single face
await world.applyBlockTexture("Grass Block", "py", "/textures/grass_top.png");

// Multiple faces
await world.applyBlockTexture(
  "Stone",
  ["px", "nx", "py", "ny", "pz", "nz"],
  "/textures/stone.png"
);

// All faces with wildcard
await world.applyBlockTexture("Dirt", "*", "/textures/dirt.png");

// Solid color
world.applyBlockTexture("Gold Block", "*", new Color("#FFD700"));

// Batch multiple blocks
await world.applyBlockTextures([
  { idOrName: "Dirt", faceNames: "*", source: "/textures/dirt.png" },
  { idOrName: "Stone", faceNames: "*", source: "/textures/stone.png" },
  { idOrName: "Sand", faceNames: "*", source: "/textures/sand.png" },
]);
```

**Face names:** Standard blocks use `px`, `nx`, `py`, `ny`, `pz`, `nz`. Diagonal plants use `one` and `two`. Compound blocks use prefixed names like `stem-px`, `frame-py`.

### Multi-Face Blocks

```ts title="Blocks with Different Textures per Face"
// Grass block: different top, sides, and bottom
await world.applyBlockTexture("Grass Block", "py", "/textures/grass_top.png");
await world.applyBlockTexture("Grass Block", "ny", "/textures/dirt.png");
await world.applyBlockTexture(
  "Grass Block",
  ["px", "nx", "pz", "nz"],
  "/textures/grass_side.png"
);

// Log: top/bottom rings, bark on sides
await world.applyBlockTexture(
  "Oak Log",
  ["py", "ny"],
  "/textures/oak_log_top.png"
);
await world.applyBlockTexture(
  "Oak Log",
  ["px", "nx", "pz", "nz"],
  "/textures/oak_log_side.png"
);
```

## Per-Instance Texturing (Isolated Faces)

Use `applyBlockTextureAt` when each placed block shows different content—signs with custom text, picture frames with different images, screens with unique displays.

**Requirements:**

1. The face must be marked `.isolated_at()` on the server
2. The block must have `.is_entity(true)` on the server
3. You must specify the exact voxel position

```ts title="Per-Instance Texture"
world.applyBlockTextureAt(
  "Sign", // Block name
  "pz", // Face name (must be isolated)
  canvasTexture, // Your texture
  [10, 5, 20] // Voxel position of this specific sign
);
```

Calling `applyBlockTexture` on an isolated face **silently skips it**—isolated faces can only be textured per-instance.

### Example: Sign Renderer

Signs store custom text as block entity metadata. When a sign is placed or updated, the client renders the text to a canvas and applies it to that specific sign:

```ts title="Sign Entity Handler"
import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";

type SignData = { type: "sign"; text: string; color?: string };

class SignRenderer {
  private textures = new Map<string, THREE.CanvasTexture>();

  constructor(private world: VOXELIZE.World) {
    world.addBlockEntityUpdateListener(this.handleUpdate);
  }

  handleUpdate = (args: VOXELIZE.BlockEntityUpdateData<SignData>) => {
    const { id, operation, newValue, voxel } = args;
    if (newValue?.type !== "sign") return;

    if (operation === "CREATE" || operation === "UPDATE") {
      this.renderSign(id, voxel, newValue);
    } else if (operation === "DELETE") {
      this.disposeSign(id);
    }
  };

  private renderSign(id: string, voxel: number[], data: SignData) {
    this.disposeSign(id);

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#8B4513";
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = data.color || "#FFFFFF";
    ctx.font = "bold 24px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(data.text, 128, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    this.textures.set(id, texture);

    this.world.applyBlockTextureAt(
      "Sign",
      "pz",
      texture,
      voxel as [number, number, number]
    );
  }

  private disposeSign(id: string) {
    this.textures.get(id)?.dispose();
    this.textures.delete(id);
  }
}
```

### Example: Picture Frame with Mixed Face Types

Picture frames combine standard faces (the wooden border) with an isolated face (the inner display):

```ts title="Picture Frame Texturing"
// All picture frames share the same wooden border texture (standard faces)
world.applyBlockTexture(
  "Picture Frame 1x1",
  "frame*",
  "/textures/oak_planks.png"
);

// Each frame's inner display is set individually (isolated face)
world.applyBlockTextureAt(
  "Picture Frame 1x1",
  "innerpz", // The isolated inner face
  userUploadedImage,
  [10, 5, 20] // This specific frame
);
```

See [Block Registry - Face Texture Types](./block-registry.md#face-texture-types) for server-side configuration.

## Animated Textures

### GIF Animation

```ts title="Lava Animation"
await world.applyBlockGif(
  "Lava",
  ["px", "nx", "py", "ny", "pz", "nz"],
  "/textures/lava.gif",
  100 // Frame interval in ms
);
```

### Custom Keyframes

```ts title="Portal Animation"
await world.applyBlockFrames(
  "Portal",
  ["px", "nx"],
  [
    [500, "/textures/portal_1.png"],
    [500, "/textures/portal_2.png"],
    [500, "/textures/portal_3.png"],
  ],
  10 // Fade frames between keyframes
);
```

### Color Animation

```ts title="Beacon Pulse"
import { Color } from "three";

await world.applyBlockFrames(
  "Beacon",
  "py",
  [
    [1000, new Color("#FF0000")],
    [1000, new Color("#00FF00")],
    [1000, new Color("#0000FF")],
  ],
  30 // Smooth fade
);
```

## Canvas Textures

Create textures programmatically:

```ts title="Dynamic Canvas"
import { CanvasTexture, NearestFilter, SRGBColorSpace } from "three";

const canvas = document.createElement("canvas");
canvas.width = 64;
canvas.height = 64;
const ctx = canvas.getContext("2d")!;

ctx.fillStyle = "#8B4513";
ctx.fillRect(0, 0, 64, 64);
ctx.fillStyle = "#FFFFFF";
ctx.font = "16px monospace";
ctx.textAlign = "center";
ctx.fillText("Hello", 32, 32);

const texture = new CanvasTexture(canvas);
texture.magFilter = NearestFilter;
texture.minFilter = NearestFilter;
texture.colorSpace = SRGBColorSpace;

// For standard/independent faces
world.applyBlockTexture("Display", "pz", texture);

// For isolated faces (per-instance)
world.applyBlockTextureAt("Sign", "pz", texture, [10, 5, 20]);
```

### Updating Canvas

```ts title="Live Clock"
function updateClock() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0F0";
  ctx.fillText(new Date().toLocaleTimeString(), 32, 32);
  texture.needsUpdate = true;
}

setInterval(updateClock, 1000);
```

## Material Customization

### Access Material

```ts title="Get Material"
const material = world.getBlockFaceMaterial("Water", "py");
```

### Transparency

For blocks configured as `is_see_through` on the server, Voxelize auto-sets `transparent = true` and `side = DoubleSide`. Override if needed:

```ts title="Transparent Material"
import * as THREE from "three";

const material = world.getBlockFaceMaterial("Water", "py");
material.transparent = true;
material.opacity = 0.7;
material.depthWrite = false; // Prevents z-fighting
material.side = THREE.DoubleSide;
```

| Property      | Effect                                   |
| ------------- | ---------------------------------------- |
| `transparent` | Enable alpha blending                    |
| `opacity`     | 0 = invisible, 1 = opaque                |
| `depthWrite`  | Set `false` for layered transparency     |
| `side`        | `FrontSide`, `BackSide`, or `DoubleSide` |

### Custom Shaders

```ts title="Swaying Vegetation"
import * as VOXELIZE from "@voxelize/core";

world.customizeMaterialShaders("Tall Grass", null, {
  ...VOXELIZE.customShaders.sway({ rooted: true }),
});
```

```ts title="Sway Options"
VOXELIZE.customShaders.sway({
  speed: 1, // Animation speed
  amplitude: 0.1, // Sway distance
  scale: 1, // Overall scale
  rooted: true, // Bottom stays fixed
  yScale: 1, // Y-axis influence
});
```

## Troubleshooting

**Texture shows "?" pattern:**

- Check block name matches server registration
- Verify face name exists on block
- Confirm image path is accessible

**Texture not appearing on isolated face:**

- Make sure you're using `applyBlockTextureAt`, not `applyBlockTexture`
- Verify the face is marked `.isolated_at()` on the server
- Verify the block has `.is_entity(true)` on the server

**Texture appears blurry:**

```ts
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestFilter;
```

**Canvas texture not updating:**

```ts
texture.needsUpdate = true;
```

**Transparent blocks hide objects behind them:**

```ts
material.depthWrite = false;
```

**Can't see back side of transparent block:**

```ts
material.side = THREE.DoubleSide;
```

## Related Pages

- [Block Registry](./block-registry.md) - Server-side block configuration and face types
- [Custom Block Rendering](./custom-block-rendering.md) - Block entity rendering patterns
- [Chunk Meshing](./chunk-meshing.md) - How blocks become geometry
