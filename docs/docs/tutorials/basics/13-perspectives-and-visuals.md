---
sidebar_position: 13
---

# Perspectives and Visuals

Switch between first, second, and third person views. Add a character model and lighting effects.

## Add Perspective Switching

```javascript title="main.js"
const perspectives = new VOXELIZE.Perspective(rigidControls, world);
perspectives.connect(inputs);

function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    world.update(
      camera.getWorldPosition(new THREE.Vector3()),
      camera.getWorldDirection(new THREE.Vector3())
    );

    rigidControls.update();
    voxelInteract.update();
    perspectives.update();
  }

  renderer.render(world, camera);
}
```

Press `C` to cycle perspectives. But you won't see anything because there's no character model yet.

![](../assets/2nd-person.png)

## Add a Character

```javascript title="main.js"
function createCharacter() {
  const character = new VOXELIZE.Character();
  world.add(character);
  return character;
}

const mainCharacter = createCharacter();
rigidControls.attachCharacter(mainCharacter);
```

Now when you switch perspectives, you'll see your character:

![](../assets/main-character-2nd-perspective.png)

## Add Shadows and Lighting

```javascript title="main.js"
const shadows = new VOXELIZE.Shadows(world);
const lightShined = new VOXELIZE.LightShined(world);

function createCharacter() {
  const character = new VOXELIZE.Character();
  world.add(character);
  lightShined.add(character);
  shadows.add(character);
  return character;
}

function animate() {
  requestAnimationFrame(animate);

  if (world.isInitialized) {
    world.update(
      camera.getWorldPosition(new THREE.Vector3()),
      camera.getWorldDirection(new THREE.Vector3())
    );

    rigidControls.update();
    voxelInteract.update();
    perspectives.update();
    lightShined.update();
    shadows.update();
  }

  renderer.render(world, camera);
}
```

- `Shadows` - Adds a dark circle below objects that sticks to the ground
- `LightShined` - Updates object brightness based on surrounding voxel lighting

![](../assets/night-time-shadow-light-shined.png)

The character dims at night and has a shadow below.

Without `LightShined`, everything would stay bright (Voxelize uses `MeshBasicMaterial` which ignores lighting by default).
