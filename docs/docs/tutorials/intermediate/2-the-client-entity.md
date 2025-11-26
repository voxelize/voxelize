---
sidebar_position: 2
---

# The Client Entity

On the client side, entities are Three.js objects that represent server-side ECS entities. They receive data updates from the server and render accordingly.

## The Entity Base Class

Every client entity extends `VOXELIZE.Entity<T>`, where `T` is the type of data received from the server:

```ts title="Basic Entity Structure"
import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";

type MyEntityData = {
  position: VOXELIZE.Coords3;
  health: number;
};

class MyEntity extends VOXELIZE.Entity<MyEntityData> {
  constructor(id: string) {
    super(id);

    this.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xff0000 })
      )
    );
  }

  onCreate = (data: MyEntityData) => {
    this.position.set(...data.position);
  };

  onUpdate = (data: MyEntityData) => {
    this.position.set(...data.position);
  };

  onDelete = () => {
    // Cleanup resources if needed
  };

  update = () => {
    // Called each frame for animations
  };
}
```

## Lifecycle Hooks

Entities have four lifecycle hooks:

| Hook       | When Called           | Purpose                                |
| ---------- | --------------------- | -------------------------------------- |
| `onCreate` | Entity first appears  | Initial setup, position, spawn effects |
| `onUpdate` | Server sends new data | Update position, state, animations     |
| `onDelete` | Entity removed        | Cleanup, despawn effects               |
| `update`   | Every animation frame | Continuous animations, interpolation   |

## Registering Entity Classes

Register your entity class with the `Entities` manager:

```ts title="Entity Registration"
const entities = new VOXELIZE.Entities();

entities.setClass("my-entity", MyEntity);

network.register(entities);
```

The type string must match the server's `ETypeComp` (case-insensitive).

## Position Interpolation

For smooth movement, interpolate positions in `onUpdate` and `update`:

```ts title="Smooth Position Updates"
class SmoothEntity extends VOXELIZE.Entity<{ position: VOXELIZE.Coords3 }> {
  private targetPosition = new THREE.Vector3();

  onUpdate = (data: { position: VOXELIZE.Coords3 }) => {
    this.targetPosition.set(...data.position);
  };

  update = () => {
    this.position.lerp(this.targetPosition, 0.1);
  };
}
```

## Using Characters for Entities

For humanoid entities, use `VOXELIZE.Character`:

```ts title="Character-Based Entity"
import * as VOXELIZE from "@voxelize/core";

type BotData = {
  position: VOXELIZE.Coords3;
  direction: number[];
};

class Bot extends VOXELIZE.Entity<BotData> {
  public character: VOXELIZE.Character;

  constructor(id: string) {
    super(id);

    this.character = new VOXELIZE.Character({
      nameTagOptions: {
        fontFace: "monospace",
        yOffset: 0.2,
      },
    });
    this.add(this.character);
  }

  onCreate = (data: BotData) => {
    this.character.set(data.position, data.direction);
  };

  onUpdate = (data: BotData) => {
    this.character.set(data.position, data.direction);
  };

  update = () => {
    this.character.update();
  };
}
```

## Extending with Mixins

Use mixins to add reusable functionality:

```ts title="Mixin Pattern"
export const HoldingMixin = <
  T extends new (...args: any[]) => VOXELIZE.Character
>(
  Base: T
) => {
  return class extends Base {
    public holdingObjectId = 0;

    setHoldingObjectId = (id: number, world?: VOXELIZE.World) => {
      if (id === this.holdingObjectId) return;

      const mesh = world?.makeBlockMesh(id, { material: "basic" });
      this.setArmHoldingObject(mesh);
      this.holdingObjectId = id;
    };
  };
};

class HoldingCharacter extends HoldingMixin(VOXELIZE.Character) {}
```

## Loading 3D Models

For entities with custom 3D models:

```ts title="Model-Based Entity"
import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type ModelData = {
  position: VOXELIZE.Coords3;
  rotation: number[];
  modelUrl: string;
};

class ModelEntity extends VOXELIZE.Entity<ModelData> {
  private loader = new GLTFLoader();
  private model: THREE.Object3D | null = null;
  private targetPosition = new THREE.Vector3();
  private targetRotation = new THREE.Euler();

  onCreate = (data: ModelData) => {
    this.targetPosition.set(...data.position);
    this.position.copy(this.targetPosition);

    this.loader.load(data.modelUrl, (gltf) => {
      this.model = gltf.scene;
      this.add(this.model);
    });
  };

  onUpdate = (data: ModelData) => {
    this.targetPosition.set(...data.position);
    this.targetRotation.set(
      data.rotation[0],
      data.rotation[1],
      data.rotation[2]
    );
  };

  update = () => {
    this.position.lerp(this.targetPosition, 0.1);
    this.rotation.x += (this.targetRotation.x - this.rotation.x) * 0.1;
    this.rotation.y += (this.targetRotation.y - this.rotation.y) * 0.1;
    this.rotation.z += (this.targetRotation.z - this.rotation.z) * 0.1;
  };
}
```

## Debug Visualization

Add debug helpers to visualize entity state:

```ts title="Debug Helpers"
class DebugBot extends VOXELIZE.Entity<BotData> {
  private pathLine: THREE.Line | null = null;

  onUpdate = (data: BotData & { path?: VOXELIZE.Coords3[] }) => {
    if (data.path && data.path.length > 0) {
      this.updatePathVisualization(data.path);
    }
  };

  private updatePathVisualization(path: VOXELIZE.Coords3[]) {
    if (this.pathLine) {
      this.remove(this.pathLine);
    }

    const points = path.map(
      (p) => new THREE.Vector3(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5)
    );
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00 });
    this.pathLine = new THREE.Line(geometry, material);
    this.add(this.pathLine);
  }
}
```

## Custom Entities Manager

Extend the base `Entities` class for additional functionality:

```ts title="Custom Entities Manager"
import * as VOXELIZE from "@voxelize/core";
import { EntityProtocol } from "@voxelize/protocol";

class GameEntities extends VOXELIZE.Entities {
  public lastEntity: EntityProtocol<any> | null = null;

  onEntity = (entity: EntityProtocol<any>) => {
    this.lastEntity = entity;

    if (entity.type === "scoreboard") {
      this.handleScoreboard(entity);
    }
  };

  private handleScoreboard(entity: EntityProtocol<any>) {
    // Handle scoreboard updates
  }
}
```

## Adding Entities to the Scene

The `Entities` manager is a Three.js `Group`. Add it to your world:

```ts title="Adding to Scene"
const entities = new VOXELIZE.Entities();

entities.setClass("bot", Bot);
entities.setClass("drop", Drop);

network.register(entities);

world.add(entities);
```

Call `update()` in your render loop:

```ts title="Render Loop"
function animate() {
  requestAnimationFrame(animate);

  entities.update();

  renderer.render(scene, camera);
}
```

Read on to learn about [creating entities on the server](./custom-entity-creation).
