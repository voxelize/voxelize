---
sidebar_position: 6
---

# Create the Client

Now that we have a running server, it's time for us to create our client. 

![](../assets/server-vs-client.png)

As seen again in this diagram, the client will:

1. Connect to the server
2. Join a world within the server
3. Start rendering the game

## Voxelize and ThreeJS

On the client-side, Voxelize is closely tied to ThreeJS, a 3D rendering library. For instance, the Voxelize `World` extends the ThreeJS `Scene`, and `RigidControls` move around the ThreeJS `PerspectiveCamera`.

Therefore, to fully understand Voxelize, it is best to understand ThreeJS as well. Here are some of the resources I found most helpful in learning ThreeJS:
- [ThreeJS Journey](https://threejs-journey.com/)
- [Official ThreeJS Docs](https://threejs.org/manual/#en/fundamentals)

The ThreeJS community is very welcome, and you will definitely have a great time learning!

## Setting Up the Canvas

Right now, when running `npm run dev`, we see nothing. The page is empty, so let's start by creating our `canvas` that ThreeJS will draw on.

```html title="index.html"
<body>
    <div id="app">
        <canvas id="canvas" />
    </div>
    <script type="module" src="/main.js"></script>
</body>
```

Set the canvas as full screen:

```css title="style.css"
html,
body {
  height: 100%;
  overflow: hidden;
}

#canvas {
  width: 100%;
  height: 100%;
}
```

Finally, get the canvas in JavaScript to use later:

```javascript title="main.js"
const canvas = document.getElementById("canvas");
```

## Creating the World

The Voxelize world on the client side is essentially the ThreeJS `Scene` object with additional chunking features. It request chunks, handles chunk updates, and also handles anything ThreeJS related. 

```javascript title="main.js"
import * as VOXELIZE from '@voxelize/core';
import * as THREE from 'three';

const world = new VOXELIZE.World({
    textureUnitDimension: 16,
});
```

Here, we set the texture unit dimension to 16 (defaults to 8) for a higher resolution texture.

## ThreeJS Setup

Next, we setup the ThreeJS related stuff:

```javascript title="main.js"
const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 3000,
);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    canvas,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace; // Voxelize uses the SRGB color space.

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
```

With these in place, we're ready to implement the networking and the main game loop in the next chapter.
