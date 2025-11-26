---
sidebar_position: 12
---

# Update Voxels

To modify voxels, we need to know which block the player is looking at. Voxelize uses a fast ray-voxel intersection algorithm based on [this paper](http://www.cse.yorku.ca/~amana/research/grid.pdf).

![](../assets/raycast.png)

## Setting Up Voxel Interaction

```javascript title="main.js"
const voxelInteract = new VOXELIZE.VoxelInteract(camera, world, {
  highlightType: "outline",
});

world.add(voxelInteract);
```

Add the update call to your animation loop:

```javascript title="main.js"
function animate() {
  if (world.isInitialized) {
    voxelInteract.update();
  }
}
```

Add a crosshair to your HTML:

```html title="index.html"
<div id="app">
  <canvas id="canvas"></canvas>
  <div id="crosshair"></div>
</div>
```

```css title="style.css"
#crosshair {
  width: 12px;
  height: 12px;
  border: 2px solid #fff3;
  border-radius: 6px;
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
```

![](../assets/voxel-interact.png)

## Breaking Blocks

Use `world.updateVoxel` to set a voxel to type 0 (air):

```javascript title="main.js"
inputs.click("left", () => {
  if (!voxelInteract.target) return;

  const [x, y, z] = voxelInteract.target;
  world.updateVoxel(x, y, z, 0);
});
```

## Placing Blocks

Use `voxelInteract.potential` for the position adjacent to the targeted face:

```javascript title="main.js"
let holdingBlockType = 1;

inputs.click("middle", () => {
  if (!voxelInteract.target) return;

  const [x, y, z] = voxelInteract.target;
  holdingBlockType = world.getVoxelAt(x, y, z);
});

inputs.click("right", () => {
  if (!voxelInteract.potential) return;

  const { voxel } = voxelInteract.potential;
  world.updateVoxel(...voxel, holdingBlockType);
});
```

![](../assets/block-placements.png)

Left click breaks, middle click picks the block type, right click places.

## Full Implementation

```javascript title="main.js"
import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";

const canvas = document.getElementById("canvas");

const world = new VOXELIZE.World({
  textureUnitDimension: 16,
});

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  3000
);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
  canvas,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const network = new VOXELIZE.Network();
network.register(world);

const inputs = new VOXELIZE.Inputs();

const rigidControls = new VOXELIZE.RigidControls(
  camera,
  renderer.domElement,
  world,
  { initialPosition: [0, 40, 0] }
);
rigidControls.connect(inputs);

const voxelInteract = new VOXELIZE.VoxelInteract(camera, world, {
  highlightType: "outline",
});
world.add(voxelInteract);

let holdingBlockType = 1;

inputs.click("left", () => {
  if (!voxelInteract.target) return;
  const [x, y, z] = voxelInteract.target;
  world.updateVoxel(x, y, z, 0);
});

inputs.click("middle", () => {
  if (!voxelInteract.target) return;
  const [x, y, z] = voxelInteract.target;
  holdingBlockType = world.getVoxelAt(x, y, z);
});

inputs.click("right", () => {
  if (!voxelInteract.potential) return;
  const { voxel } = voxelInteract.potential;
  world.updateVoxel(...voxel, holdingBlockType);
});

function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    rigidControls.update();
    voxelInteract.update();
    world.update(
      camera.getWorldPosition(new THREE.Vector3()),
      camera.getWorldDirection(new THREE.Vector3())
    );
  }

  renderer.render(world, camera);
}

async function start() {
  animate();

  await network.connect("http://localhost:4000");
  await network.join("tutorial");

  await world.initialize();
}

start();
```

For bulk voxel updates and radius-based operations, see `examples/client/src/main.ts`.
