---
sidebar_position: 7
---

# Voxelize Networking

The network manager connects your client to the Voxelize server over WebSockets. It handles sending and receiving all game data - chunks, player positions, chat messages, and custom events.

## Creating the Network

```javascript title="main.js"
const network = new VOXELIZE.Network();

network.register(world);
```

Registering the world allows it to receive chunk data and world updates from the server.

## Network Interceptors

Anything registered with `network.register()` can intercept messages. An interceptor has two hooks:

### `onMessage`

Called for every message received when `network.sync()` runs (called automatically each frame):

```javascript title="Custom Logger"
const debugInterceptor = {
  onMessage(message) {
    console.log("Received:", message.type);
  },
};

network.register(debugInterceptor);
```

### `packets`

An array of outgoing messages. The network flushes these to the server each frame:

```javascript title="Custom Packet Sender"
const customSender = {
  packets: [],

  sendCustomData(data) {
    this.packets.push({
      type: "TRANSPORT",
      json: JSON.stringify(data),
    });
  },
};

network.register(customSender);
```

## Connecting to the Server

```javascript title="main.js"
async function start() {
  await network.connect("http://localhost:4000");
  await network.join("tutorial");

  await world.initialize();
}
```

The `connect` call establishes a WebSocket connection. The `join` call enters a specific world on the server.

:::tip
`network.connect` automatically converts the protocol to WebSockets (`ws://` or `wss://`).
:::

## Full Implementation

Here's the complete networking setup from this tutorial:

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

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const network = new VOXELIZE.Network();
network.register(world);

function animate() {
  requestAnimationFrame(animate);
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

See the full example at `examples/client/src/main.ts` in the Voxelize repository.
