---
sidebar_position: 14
---

# Multiplayer

Voxelize uses WebSockets for real-time multiplayer. The `Peers` class manages other players' positions and renders their characters.

## Setting Up Peers

```javascript title="main.js"
const peers = new VOXELIZE.Peers(rigidControls.object);

network.register(peers);
world.add(peers);
```

The `rigidControls.object` (the camera) is used to broadcast your position to other players.

## Creating Peer Characters

Define how to create a character mesh for each connected player:

```javascript title="main.js"
function createCharacter() {
  const character = new VOXELIZE.Character();
  return character;
}

peers.createPeer = createCharacter;
```

## Handling Peer Updates

When another player moves, update their character:

```javascript title="main.js"
peers.onPeerUpdate = (peer, data) => {
  peer.set(data.position, data.direction);
};
```

The `set` method smoothly interpolates the character to the new position and direction.

## Update Loop

Add peer updates to your animation loop:

```javascript title="main.js"
function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    rigidControls.update();
    peers.update();
  }

  renderer.render(world, camera);
}
```

![](../assets/multiplayer.png)

## Full Implementation

Here's the complete multiplayer setup:

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

function createCharacter() {
  const character = new VOXELIZE.Character();
  return character;
}

const peers = new VOXELIZE.Peers(rigidControls.object);

peers.createPeer = createCharacter;

peers.onPeerUpdate = (peer, data) => {
  peer.set(data.position, data.direction);
};

network.register(world);
network.register(peers);

world.add(peers);

function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    rigidControls.update();
    peers.update();
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

For a more advanced example with custom peer metadata (like held items), see `examples/client/src/main.ts` and the [Custom Peers](/wiki/entities/custom-peers) wiki page.
