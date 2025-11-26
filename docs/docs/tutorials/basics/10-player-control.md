---
sidebar_position: 10
---

# Player Control

Voxelize provides `RigidControls`, a physics-based controller for walking, running, jumping, and flying around voxel worlds. It wraps ThreeJS's PointerLockControls and adds collision detection.

## Setting Up Controls

```javascript title="main.js"
const inputs = new VOXELIZE.Inputs();

const rigidControls = new VOXELIZE.RigidControls(
  camera,
  renderer.domElement,
  world,
  {
    initialPosition: [0, 40, 0],
  }
);

rigidControls.connect(inputs);
```

The `inputs` manager handles keybindings. Calling `connect` registers the default movement keys (WASD, Space, Shift).

## Update Loop

Add the controls update to your animation loop:

```javascript title="main.js"
function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    rigidControls.update();
  }

  renderer.render(world, camera);
}
```

With this, you can navigate the world:

![](../assets/rigid-controls-basic.png)

## Adding Fly and Ghost Mode

Bind keys to toggle flying and ghost mode (no-clip through blocks):

```javascript title="main.js"
inputs.bind("g", rigidControls.toggleGhostMode);
inputs.bind("f", rigidControls.toggleFly);
```

## Full Implementation

Here's the complete player control setup:

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
  {
    initialPosition: [0, 40, 0],
  }
);

rigidControls.connect(inputs);

inputs.bind("g", rigidControls.toggleGhostMode);
inputs.bind("f", rigidControls.toggleFly);

function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    rigidControls.update();
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

See `examples/client/src/main.ts` for a more complete example with additional features like perspective switching and voxel interaction.
