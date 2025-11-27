---
sidebar_position: 11
---

# Debug UI

Voxelize includes a built-in debug panel. For more control, use `lil-gui`.

## Built-in Debug Panel

```javascript title="main.js"
import "@voxelize/core/dist/styles.css";

const debug = new VOXELIZE.Debug(document.body);

debug.registerDisplay("Current time", world, "time", (time) => time.toFixed(2));

inputs.bind("j", debug.toggle);

function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    world.update(
      camera.getWorldPosition(new THREE.Vector3()),
      camera.getWorldDirection(new THREE.Vector3())
    );

    rigidControls.update();
    debug.update();
  }

  renderer.render(world, camera);
}
```

Press `J` to toggle the debug panel. It displays the current world time (and any other properties you register).

## Adding lil-gui

Install it:

```bash
npm install lil-gui
```

Add a time slider:

```javascript title="main.js"
import { GUI } from "lil-gui";

const gui = new GUI();
gui.domElement.style.top = "10px";

async function start() {
  animate();

  await network.connect("http://localhost:4000");
  await network.join("tutorial");
  await world.initialize();

  gui
    .add({ time: world.time }, "time", 0, world.options.timePerDay, 0.01)
    .onFinishChange((time) => {
      world.time = time;
    });

  // ... rest of initialization
}
```

Setting `world.time` calls the built-in `vox-builtin:set-time` method on the server.

![](../assets/time-setter.png)

For more on methods, see [Calling Methods](/wiki/networking/calling-methods).
