---
sidebar_position: 8
---

# Initialize the World

Upon connecting to the server, the voxelize world receives a `INIT` packet since it's registered onto the network. We need to use that packet and initialize the world so that `world.isInitialized` would be true.

```javascript title="main.js"
function animate() {
    // ...

    if (world.isInitialized) {
        // Do in-game updates here
    }

    // ...
}

async function start() {
    // ...
    await network.join('tutorial');

    await world.initialize(); // Process the `INIT` packet
}
```

The world initialization retrieves the server-side chunking options (such as chunk size, registry blocks, etc), loads in the chunk materials, sets up the render radius, and starts the client-side meshing workers. If everything goes correctly, you should see something like below, where only the clouds are rendered:

![](../assets/empty-sky.png)

## Update the World

Once the world is initialized, we can now update the world in our game loop. This process requests and meshes the chunks.

```javascript title="main.js"
function animate() {
    // ...

    if (world.isInitialized) {
        world.update(
            camera.getWorldPosition(new THREE.Vector3()), 
            camera.getWorldDirection(new THREE.Vector3()),
        );
    }

    // ...
}
```

The first argument to `update` is the center position to request chunks from. For instance, say the player is at `(0, 0, 0)` and has a render radius of 8 chunks, the world would request all the chunks within 8 chunks from the origin. Here, we pass in the camera's position.

The second argument is for the direction of where the player is looking at. The world then uses it to frustum cull the chunks within the radius. This culls out the chunks that are "behind" the player, so we can prioritize on loading the chunks that can actually be seen.

![](../assets/frustum-cull.png)

As can be seen in the screenshot above, purple cells in the bottom right represents the chunks loaded, and red represents chunks within radius. The Voxelize world only loads in the chunks that the player is facing.

# Draw the Sky

Currently, the sky is plain black. Let's add some arts and colors to the sky.

```javascript title="main.js"
world.sky.setShadingPhases([
    // start of sunrise
    {
        name: "sunrise",
        color: {
            top: new THREE.Color("#7694CF"),
            middle: new THREE.Color("#B0483A"),
            bottom: new THREE.Color("#222"),
        },
        skyOffset: 0.05,
        voidOffset: 0.6,
        start: 0.2,
    },
    // end of sunrise
    {
        name: "daylight",
        color: {
            top: new THREE.Color("#73A3FB"),
            middle: new THREE.Color("#B1CCFD"),
            bottom: new THREE.Color("#222"),
        },
        skyOffset: 0,
        voidOffset: 0.6,
        start: 0.25,
    },
    // start of sunset
    {
        name: "sunset",
        color: {
            top: new THREE.Color("#A57A59"),
            middle: new THREE.Color("#FC5935"),
            bottom: new THREE.Color("#222"),
        },
        skyOffset: 0.05,
        voidOffset: 0.6,
        start: 0.7,
    },
    // end of sunset
    {
        name: "night",
        color: {
            top: new THREE.Color("#000"),
            middle: new THREE.Color("#000"),
            bottom: new THREE.Color("#000"),
        },
        skyOffset: 0.1,
        voidOffset: 0.6,
        start: 0.75,
    },
]);

world.sky.paint("bottom", VOXELIZE.artFunctions.drawSun());
world.sky.paint("top", VOXELIZE.artFunctions.drawStars());
world.sky.paint("top", VOXELIZE.artFunctions.drawMoon());
world.sky.paint("sides", VOXELIZE.artFunctions.drawStars());
```

`setShadingPhases` defines the different phases that the sky interpolates to throughout the day. The Voxelize world's sky interpolates naturally between these phases as time progresses. 

`world.sky.paint` works as the sky is actually a inwards [`CanvasBox`](/api/client/classes/CanvasBox), and the preset art functions draws simple shapes onto the sky box.

In an upcoming tutorial, I will teach how to change the time of the day, so you can experience different shades of the sky.