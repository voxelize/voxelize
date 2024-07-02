---
id: "modules"
title: "@voxelize/core"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Enumerations

### BlockRuleLogic

• **BlockRuleLogic**: Enum BlockRuleLogic

## Core Classes

### Chat

• **Chat**: Class Chat\<T\>

A network interceptor that gives flexible control over the chat feature of
the game. This also allows for custom commands to be added.

# Example
```ts
const chat = new VOXELIZE.Chat();

// Listen to incoming chat messages.
chat.onChat = (chat: ChatMessage) => {
  console.log(chat);
};

// Sending a chat message.
chat.send({
  type: "CLIENT",
  sender: "Mr. Robot",
  body: "Hello world!",
});

// Register to the network.
network.register(chat);
```

![Chat](/img/docs/chat.png)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends ChatProtocol = ChatProtocol |

___

### Entities

• **Entities**: Class Entities

A network interceptor that can be used to handle `ENTITY` messages. This is useful
for creating custom entities that can be sent over the network.

TODO-DOCS

# Example
```ts
const entities = new VOXELIZE.Entities();

// Define an entity type.
class MyEntity extends VOXELIZE.Entity<{ position: VOXELIZE.Coords3 }> {
  onUpdate = (data) => {
    // Do something with `data.position`.
  };
}

// Register the entity type.
entities.setClass("my-entity", MyEntity);

// Register the interceptor with the network.
network.register(entities);
```

___

### Inputs

• **Inputs**: Class Inputs\<T\>

A key and mouse binding manager for Voxelize.

Inputs allow you to bind keys and mouse buttons to functions
and also gives an organized way to manage keyboard and mouse inputs using namespaces. Namespaces are used to
separate groups of inputs. For example, you can have a namespace for the main menu
and another namespace for the game. You can then bind keys and mouse buttons to functions for each namespace.

Another use of inputs is to bind keys and mouse buttons for some built-in functionality. As of now, the following
requires inputs to be bound:
- [RigidControls.connect](/api/client/classes/RigidControls#connect): <kbd>WASD</kbd> and <kbd>Space</kbd> for movement, <kbd>Shift</kbd> for going down and <kbd>R</kbd> for sprinting.
- [Perspective.connect](/api/client/classes/Perspective#connect): <kbd>C</kbd> for switching between perspectives.

You can change the above bindings by calling Inputs.remap with the corresponding input identifiers, namely
`RigidControls.INPUT_IDENTIFIER` and `Perspectives.INPUT_IDENTIFIER`.

## Example
```typescript
// Create a new inputs manager.
const inputs = new VOXELIZE.Inputs();

// Bind the space bar to a function.
inputs.bind(" ", (event) => {
  console.log("Space bar pressed!", event);
});

// Bind rigid controls to the inputs manager.
rigidControls.connect(inputs);
```

#### Type parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `T` | extends string = any | The list of input namespaces. For instance, `T` could be "menu" and "game". |

___

### Loader

• **Loader**: Class Loader

An asset loader that can load textures and audio files. This class is used internally by the world
and can be accessed via World.loader.

___

### Network

• **Network**: Class Network

A network connector to the Voxelize backend. Establishes a WebSocket connection to the backend
server and handles the Protocol Buffer encoding and decoding.

# Example
```ts
const network = new VOXELIZE.Network();

network
 .connect("ws://localhost:5000")
 .then(() => {
   network.join("my-world").then(() => {
     console.log("Joined world!");
   });
});
```

___

### Peers

• **Peers**: Class Peers\<C, T\>

A class that allows you to add multiplayer functionality to your Voxelize game. This implements
a NetIntercept that intercepts all peer-related messages and allows you to customize
the behavior of multiplayer functionality. This class also extends a `THREE.Group` that allows
you to dynamically turn on/off multiplayer visibility.

Override Peers.packInfo to customize the information that is sent to other peers.

TODO-DOC

# Example
```ts
// Create a peers manager.
const peers = new VOXELIZE.Peers<VOXELIZE.Character>();

// Add the peers group to the world.
world.add(peers);

// Define what a new peer looks like.
peers.createPeer = (id) => {
  const character = new VOXELIZE.Character();
  character.username = id;
  return character;
};

// Define what happens when a peer data is received.
peers.onPeerUpdate = (peer, data) => {
  peer.set(data.position, data.direction);
};

// In the render loop, update the peers manager.
peers.update();
```

![Example](/img/docs/peers.png)

#### Type parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `C` | extends Object3D = Object3D | The type of the character. Defaults to `Object3D`. |
| `T` | Object | The type of peer metadata. Defaults to `{ direction: number[], position: number[] }`. |

___

### RigidControls

• **RigidControls**: Class RigidControls

Inspired by THREE.JS's PointerLockControls, a rigid body based first person controls.

## Example
```ts
// Create the controls.
const controls = new RigidControls(
  camera,
  renderer.domElement,
  world
);

// Printing the voxel that the client is in.
console.log(controls.voxel);

// Call the controls update function in the render loop.
controls.update();
```

___

### World

• **World**: Class World\<T\>

A Voxelize world handles the chunk loading and rendering, as well as any 3D objects.
**This class extends the [ThreeJS `Scene` class](https://threejs.org/docs/#api/en/scenes/Scene).**
This means that you can add any ThreeJS objects to the world, and they will be rendered. The world
also implements NetIntercept, which means it intercepts chunk-related packets from the server
and constructs chunk meshes from them. You can optionally disable this by setting `shouldGenerateChunkMeshes` to `false`
in the options.

There are a couple components that are by default created by the world that holds data:
- World.registry: A block registry that handles block textures and block instances.
- World.chunks: A chunk manager that stores all the chunks in the world.
- World.physics: A physics engine that handles voxel AABB physics simulation of client-side physics.
- World.loader: An asset loader that handles loading textures and other assets.
- World.sky: A sky that can render the sky and the sun.
- World.clouds: A clouds that renders the cubical clouds.

One thing to keep in mind that there are no specific setters like `setVoxelByVoxel` or `setVoxelRotationByVoxel`.
This is because, instead, you should use `updateVoxel` and `updateVoxels` to update voxels.

# Example
```ts
const world = new VOXELIZE.World();

// Update the voxel at `(0, 0, 0)` to a voxel type `12` in the world across the network.
world.updateVoxel(0, 0, 0, 12)

// Register the interceptor with the network.
network.register(world);

// Register an image to block sides.
world.applyBlockTexture("Test", VOXELIZE.ALL_FACES, "https://example.com/test.png");

// Update the world every frame.
world.update(controls.position);
```

![World](/img/docs/world.png)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | any |

___

## Effects Classes

### BlockOverlayEffect

• **BlockOverlayEffect**: Class BlockOverlayEffect

The block overlay effect is used to add a color blend whenever the camera is inside certain types of blocks.

This module is dependent on the [`postprocessing`](https://github.com/pmndrs/postprocessing) package.

# Example
```ts
import { EffectComposer, RenderPass } from "postprocessing";

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(world, camera));

const overlayEffect = new VOXELIZE.BlockOverlayEffect(world, camera);
overlayEffect.addOverlay("water", new THREE.Color("#5F9DF7"), 0.05);

composer.addPass(
  new EffectPass(camera, overlayEffect)
);
```

![Block overlay effect](/img/docs/overlay.png)

___

### ColorText

• **ColorText**: Class ColorText

This module is used to separate plain text into colored text objects to be further rendered.

# Example
```ts
const text = "$green$Hello, world!$yellow$The rest is yellow.";

// Change the default splitter.
ColorText.SPLITTER = "$";

// Parse the text into colored text objects.
const splitted = ColorText.split(text);

// Expected:
// [
//   {
//     text: "Hello, world!",
//     color: "green"
//   },
//   {
//     text: "The rest is yellow.",
//     color: "yellow"
//   },
// ]
```

![ColorText](/img/docs/colortext.png)

___

### LightShined

• **LightShined**: Class LightShined

A class that allows mesh to dynamically change brightness based on the voxel light level at their position.

By default, `VOXELIZE.Shadow` and `VOXELIZE.NameTag` is ignored by this effect.

# Example
```ts
// Create a light shined effect manager.
const lightShined = new VOXELIZE.LightShined();

// Add the effect to a mesh.
lightShined.add(character);

// In the render loop, update the effect.
lightShined.update();
```

![Example](/img/docs/light-shined.png)

___

## Other Classes

### AnimationUtils

• **AnimationUtils**: Class AnimationUtils

___

### Arm

• **Arm**: Class Arm

___

### Arrow

• **Arrow**: Class Arrow

A helper for visualizing a direction. This is useful for debugging.

This arrow is essentially a Voxelize version of the [`ArrowHelper`](https://threejs.org/docs/#api/en/helpers/ArrowHelper) from Three.js.

# Example
```ts
const arrow = new VOXELIZE.Arrow();

arrow.position.set(10, 0, 10);
arrow.setDirection(new THREE.Vector3(1, 0, 0));

world.add(arrow);
```

![Arrow](/img/docs/arrow.png)

___

### AtlasTexture

• **AtlasTexture**: Class AtlasTexture

A texture atlas is a collection of textures that are packed into a single texture.
This is useful for reducing the number of draw calls required to render a scene, since
all block textures can be rendered with a single draw call.

By default, the texture atlas creates an additional border around each texture to prevent
texture bleeding.

![Texture bleeding](/img/docs/texture-bleeding.png)

___

### BlockRotation

• **BlockRotation**: Class BlockRotation

A block rotation consists of two rotations: one is the axis this block is pointing towards,
and the other is the rotation around that axis (y-rotation). Y-rotation is only applicable
to the positive and negative x-axis.

___

### BoxLayer

• **BoxLayer**: Class BoxLayer

A layer of a canvas box. This is a group of six canvases that are rendered as a single mesh.

___

### CanvasBox

• **CanvasBox**: Class CanvasBox

A canvas box is a group of `BoxLayer`s that are rendered as a single mesh.
Each box layer is a group of six canvases that are also rendered as a single mesh.
You can then paint on each canvas individually by calling `box.paint()`.

# Example
```ts
const box = new VOXELIZE.CanvasBox();

box.paint("all", (ctx, canvas) => {
  ctx.fillStyle = "red";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
});
```

![Bobby from King of the Hill](/img/docs/bobby-canvas-box.png)

___

### Character

• **Character**: Class Character

The default Voxelize character. This can be used in `Peers.createPeer` to apply characters onto
multiplayer peers. This can also be **attached** to a `RigidControls` instance to have a character
follow the controls.

When `character.set` is called, the character's head will be lerp to the new rotation first, then the
body will be lerp to the new rotation. This is to create a more natural looking of character rotation.

# Example
```ts
const character = new VOXELIZE.Character();

// Set the nametag content.
character.username = "<placeholder>";

// Load a texture to paint on the face.
world.loader.addTexture(FunnyImageSrc, (texture) => {
  character.head.paint("front", texture);
})

// Attach the character to a rigid controls.
controls.attachCharacter(character);
```

![Character](/img/docs/character.png)

___

### Chunk

• **Chunk**: Class Chunk

___

### Clouds

• **Clouds**: Class Clouds

A class that generates and manages clouds. Clouds are essentially a 2D grid of cells that contain further sub-grids of
cloud blocks. This 2D grid move altogether in the `+x` direction, and is generated at the start asynchronously using
web workers using simplex noise.

When using Clouds.update, new clouds will be generated if the center of the grid
does not match the passed in position.

![Clouds](/img/docs/clouds.png)

___

### Debug

• **Debug**: Class Debug

A class for general debugging purposes in Voxelize, including FPS, value tracking, and real-time value testing.

# Example
```ts
const debug = new VOXELIZE.Debug();

// Track the voxel property of `controls`.
debug.registerDisplay("Position", controls, "voxel");

// Add a function to track sunlight dynamically.
debug.registerDisplay("Sunlight", () => {
  return world.getSunlightByVoxel(...controls.voxel);
});

// In the game loop, trigger debug updates.
debug.update();
```

![Debug](/img/docs/debug.png)

___

### Entity

• **Entity**: Class Entity\<T\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | any |

___

### Events

• **Events**: Class Events

A manager for any events interacting with the Voxelize server. This is useful
for any defined game events that are sent from or needs to be broadcasted to
the server.

# Example
```ts
const events = new VOXELIZE.Events();

// Define the behavior to handle a game-over event. Keep in mind that this
// event is most likely sent from the server, so check out the documentations
// for creating and emitting custom events fullstack.
events.on("game-over", (payload) => {
  // Do something about the game over event.
});

// Register the interceptor with the network.
network.register(events);
```

TODO-DOC

___

### FaceAnimation

• **FaceAnimation**: Class FaceAnimation

The animation data that is used internally in an atlas texture. This holds the data and will be used to draw on the texture atlas.

___

### ItemSlot

• **ItemSlot**: Class ItemSlot\<T\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | number |

___

### ItemSlots

• **ItemSlots**: Class ItemSlots\<T\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | number |

___

### Method

• **Method**: Class Method

A caller for a method on the server.

TODO-DOC

# Example
```ts
const method = new VOXELIZE.Method();

// Register the method caller with the network.
network.register(method);

// Call a method on the server.
method.call("my-method", { hello: "world" });
```

___

### NameTag

• **NameTag**: Class NameTag

A class that allows you to create a name tag mesh. This name tag mesh also supports colored text
using the ColorText syntax. Name tags can be treated like any other mesh.

![Name tag](/img/docs/nametag.png)

___

### Perspective

• **Perspective**: Class Perspective

A class that allows you to switch between first, second and third person perspectives for
a RigidControls instance. By default, the key to switch between perspectives is <kbd>C</kbd>.

# Example
```ts
// Initialize the perspective with the rigid controls.
const perspective = new VOXELIZE.Perspective(controls, world);

// Bind the keyboard inputs to switch between perspectives.
perspective.connect(inputs, "in-game");

// Switch to the first person perspective.
perspective.state = "third";

// Update the perspective every frame.
perspective.update();
```

___

### Portrait

• **Portrait**: Class Portrait

This class allows you to render a single THREE.js object to a canvas element.
This is useful for generating images of objects for use in the game. However, there
are performance bottlenecks that you should be aware of:
- The THREE.js renderer is shared between all instances of this class. This is because
  there is a limit to how many webgl contexts can be created.
- Each individual portrait has their own render loop. This means that if you have a lto
  of portraits, you will be rendering a lot of frames per second. This can be mitigated
  by either using the renderOnce parameter or utilizing the ItemSlots class, which
  batch renders objects in a grid-like fashion.

# Example
```ts
const portrait = new Portrait(world.makeBlockMesh(5));
document.body.appendChild(portrait.canvas);
```

___

### Registry

• **Registry**: Class Registry

___

### Shadow

• **Shadow**: Class Shadow

A shadow that is just a circle underneath an object that scales smaller with distance. Shadows ignore fluids.

___

### Shadows

• **Shadows**: Class Shadows

A manager for all shadows in the world. Shadows should be updated every frame.

# Example
```ts
// Create a shadow manager.
const shadows = new VOXELIZE.Shadows(world);

// Add a shadow to an object managed by the shadow manager.
shadows.add(object);

// Update the shadows every frame.
shadows.update();
```

___

### SharedWorkerPool

• **SharedWorkerPool**: Class SharedWorkerPool

A pool of web workers that can be used to execute jobs. The pool will create
workers up to the maximum number of workers specified in the options.
When a job is queued, the pool will find the first available worker and
execute the job. If no workers are available, the job will be queued until
a worker becomes available.

___

### Sky

• **Sky**: Class Sky

Sky consists of both a large dodecahedron used to render the 3-leveled sky gradient and a CanvasBox that renders custom sky textures (
for a sky box) within the dodecahedron sky.

# Example
```ts
// Create the sky texture.
const sky = new VOXELIZE.Sky();

// Load a texture and paint it to the top of the sky.
world.loader.addTexture(ExampleImage, (texture) => {
  sky.paint("top", texture);
})

// Add the sky to the scene.
world.add(sky);

// Update the sky per frame.
sky.update(camera.position);
```

![Sky](/img/docs/sky.png)

___

### SpriteText

• **SpriteText**: Class SpriteText

A sprite that can be used to display text. This is highly inspired by the
[THREE.SpriteText](https://github.com/vasturiano/three-spritetext) library.

Sprite text uses ColorText internally to generate the texture that supports
multiple colors in the same text.

![Sprite text](/img/docs/sprite-text.png)

___

### VoxelInteract

• **VoxelInteract**: Class VoxelInteract

The VoxelInteract class is used to interact with voxels in the World instance. It consists of two main parts:

- VoxelInteract.potential: The potential block placement. This is the data of a block's orientation that can be placed.
- VoxelInteract.target: The targeted block. This is the voxel that the camera is looking at.

You can use these two properties to place blocks, remove blocks, and more.

# Example
```ts
// Create a new VoxelInteract instance.
const voxelInteract = new VoxelInteract(camera, world);

// Add the voxel interact to the scene.
world.add(voxelInteract);

// Set the target block to air.
if (voxelInteract.target) {
  const [vx, vy, vz] = voxelInteract.target;
  world.updateVoxel(vx, vy, vz, 0);
}

// Update the interaction every frame.
voxelInteract.update();
```

![VoxelInteract](/img/docs/voxel-interact.png)

___

### WorkerPool

• **WorkerPool**: Class WorkerPool

A pool of web workers that can be used to execute jobs. The pool will create
workers up to the maximum number of workers specified in the options.
When a job is queued, the pool will find the first available worker and
execute the job. If no workers are available, the job will be queued until
a worker becomes available.

___

## Utils Classes

### BlockUtils

• **BlockUtils**: Class BlockUtils

A utility class for extracting and inserting voxel data from and into numbers.

The voxel data is stored in the following format:
- Voxel type: `0x0000ffff`
- Rotation: `0x000f0000`
- Y-rotation: `0x00f00000`
- Stage: `0xff000000`

TODO-DOCS
For more information about voxel data, see [here](/)

# Example
```ts
// Insert a voxel type 13 into zero.
const number = VoxelUtils.insertID(0, 13);
```

___

### ChunkUtils

• **ChunkUtils**: Class ChunkUtils

A utility class for all things related to chunks and chunk coordinates.

# Example
```ts
// Get the chunk coordinates of a voxel, (0, 0) with `chunkSize=16`.
const chunkCoords = ChunkUtils.mapVoxelToChunk([1, 10, 12]);
```

___

### DOMUtils

• **DOMUtils**: Class DOMUtils

A utility class for doing DOM manipulation.

___

### LightUtils

• **LightUtils**: Class LightUtils

A utility class for extracting and inserting light data from and into numbers.

The light data is stored in the following format:
- Sunlight: `0xff000000`
- Red light: `0x00ff0000`
- Green light: `0x0000ff00`
- Blue light: `0x000000ff`

TODO-DOCS
For more information about lighting data, see [here](/)

# Example
```ts
// Insert a level 13 sunlight into zero.
const number = LightUtils.insertSunlight(0, 13);
```

___

### MathUtils

• **MathUtils**: Class MathUtils

A utility class for doing math operations.

## Interfaces

### BlockConditionalPart

• **BlockConditionalPart**: Interface BlockConditionalPart

___

### BlockDynamicPattern

• **BlockDynamicPattern**: Interface BlockDynamicPattern

___

### NetIntercept

• **NetIntercept**: Interface NetIntercept

An interceptor for the network layer. When registered to a network
instance, the network instance will run through all network packets
through the interceptor, and also allowing the interceptor to send
packets to the server.

## Type Aliases

### ArmOptions

Ƭ **ArmOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `armColor?` | string \| THREE.Color |
| `armObject?` | THREE.Object3D |
| `armObjectOptions` | ArmObjectOptions |
| `blockObjectOptions?` | ArmObjectOptions |
| `customObjectOptions?` | Record\<string, ArmObjectOptions\> |

___

### ArmsOptions

Ƭ **ArmsOptions**: ColorCanvasBoxOptions & Object

Parameters to create a character's arms.
Defaults to:
```ts
{
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: THREE.DoubleSide,
  width: 0.25 * CHARACTER_SCALE,
  widthSegments: 8,
  height: 0.5 * CHARACTER_SCALE,
  heightSegments: 16,
  depth: 0.25 * CHARACTER_SCALE,
  depthSegments: 8,
  shoulderGap: 0.05 * CHARACTER_SCALE,
  shoulderDrop: 0.25 * CHARACTER_SCALE,
}
```

___

### ArrowOptions

Ƭ **ArrowOptions**: `Object`

Parameters to create an arrow.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `color` | string \| Color | The color of the arrow. Defaults to `red`. |
| `coneHeight` | number | The height of the head of the arrow. Defaults to `0.2`. |
| `coneRadius` | number | The radius of the head of the arrow. Defaults to `0.2`. |
| `height` | number | The height of the body of the arrow. Defaults to `0.8`. |
| `radius` | number | The radius of the body of the arrow. Defaults to `0.1`. |

___

### ArtFunction

Ƭ **ArtFunction**: Function

#### Type declaration

▸ (`context`, `canvas`): void

A function to programmatically draw on a canvas.

##### Parameters

| Name | Type |
| :------ | :------ |
| `context` | CanvasRenderingContext2D |
| `canvas` | HTMLCanvasElement |

##### Returns

void

___

### Block

Ƭ **Block**: `Object`

A block type in the world. This is defined by the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `aabbs` | AABB[] | A list of axis-aligned bounding boxes that this block has. |
| `blueLightLevel` | number | The blue light level of the block. |
| `dynamicFn` | Function | - |
| `dynamicPatterns` | BlockDynamicPattern[] | - |
| `faces` | Object[] | A list of block face data that this block has. |
| `greenLightLevel` | number | The green light level of the block. |
| `id` | number | The block id. |
| `independentFaces` | Set\<string\> | A set of block face names that are independent (high resolution or animated). This is generated on the client side. |
| `isDynamic` | boolean | Whether or not does the block generate dynamic faces or AABB's. If this is true, the block will use `dynamicFn` to generate the faces and AABB's. |
| `isEmpty` | boolean | Whether or not is this block empty. By default, only "air" is empty. |
| `isEntity` | boolean | - |
| `isFluid` | boolean | Whether or not is the block a fluid block. |
| `isLight` | boolean | Whether or not is this block a light source. |
| `isOpaque` | boolean | Whether or not is this block opaque (not transparent). |
| `isPassable` | boolean | Whether or not should physics ignore this block. |
| `isSeeThrough` | boolean | Whether or not is this block see-through (can be opaque and see-through at the same time). |
| `isTransparent` | [boolean, boolean, boolean, boolean, boolean, boolean] | Whether or not is this block transparent viewing from all six sides. The sides are defined as PX, PY, PZ, NX, NY, NZ. |
| `isolatedFaces` | Set\<string\> | - |
| `lightReduce` | boolean | Whether or not should light reduce by 1 going through this block. |
| `name` | string | The name of the block. |
| `redLightLevel` | number | The red light level of the block. |
| `rotatable` | boolean | Whether or not is the block rotatable. |
| `transparentStandalone` | boolean | - |
| `yRotatable` | boolean | Whether or not the block is rotatable around the y-axis (has to face either PX or NX). |
| `yRotatableSegments` | "All" \| "Eight" \| "Four" | - |

___

### BlockEntityUpdateData

Ƭ **BlockEntityUpdateData**: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | string |
| `newValue` | T \| null |
| `oldValue` | T \| null |
| `operation` | EntityOperation |
| `voxel` | Coords3 |

___

### BlockEntityUpdateListener

Ƭ **BlockEntityUpdateListener**: Function

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

▸ (`args`): void

##### Parameters

| Name | Type |
| :------ | :------ |
| `args` | BlockEntityUpdateData\<T\> |

##### Returns

void

___

### BlockRule

Ƭ **BlockRule**: Object \| Object & BlockSimpleRule \| Object

___

### BlockSimpleRule

Ƭ **BlockSimpleRule**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id?` | number |
| `offset` | Coords3 |
| `rotation?` | BlockRotation |
| `stage?` | number |

___

### BlockUpdate

Ƭ **BlockUpdate**: `Object`

A block update to make on the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `rotation?` | number | The optional rotation of the updated block. |
| `stage?` | number | The optional stage of the updated block. |
| `type` | number | The voxel type. |
| `vx` | number | The voxel x-coordinate. |
| `vy` | number | The voxel y-coordinate. |
| `vz` | number | The voxel z-coordinate. |
| `yRotation?` | number | The optional y-rotation of the updated block. |

___

### BlockUpdateListener

Ƭ **BlockUpdateListener**: Function

#### Type declaration

▸ (`args`): void

##### Parameters

| Name | Type |
| :------ | :------ |
| `args` | Object |
| `args.newValue` | number |
| `args.oldValue` | number |
| `args.voxel` | Coords3 |

##### Returns

void

___

### BlockUpdateWithSource

Ƭ **BlockUpdateWithSource**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `source` | "client" \| "server" |
| `update` | BlockUpdate |

___

### BodyOptions

Ƭ **BodyOptions**: ColorCanvasBoxOptions

Parameters to create a character's body.
Defaults to:
```ts
{
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: THREE.DoubleSide,
  width: 1 * CHARACTER_SCALE,
  widthSegments: 16,
}
```
where `CHARACTER_SCALE` is 0.9.

___

### BoxSides

Ƭ **BoxSides**: "back" \| "front" \| "top" \| "bottom" \| "left" \| "right" \| "sides" \| "all"

The sides of a canvas box.

`"all"` means all six sides, and `"sides"` means all the sides except the top and bottom.

___

### CSSMeasurement

Ƭ **CSSMeasurement**: \`$\{number}$\{string}\`

A CSS measurement. E.g. "30px", "51em"

___

### CameraPerspective

Ƭ **CameraPerspective**: "px" \| "nx" \| "py" \| "ny" \| "pz" \| "nz" \| "pxy" \| "nxy" \| "pxz" \| "nxz" \| "pyz" \| "nyz" \| "pxyz" \| "nxyz"

___

### CanvasBoxOptions

Ƭ **CanvasBoxOptions**: `Object`

Parameters to create a canvas box.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `depth?` | number | The depth of the box. Defaults to whatever `width` is. |
| `depthSegments?` | number | The depth segments of the box, which is the number of pixels of the canvases along the depth. Defaults to whatever `widthSegments` is. |
| `gap` | number | The gap between the layers of the box. Defaults to `0`. |
| `height?` | number | The height of the box. Defaults to whatever `width` is. |
| `heightSegments?` | number | The height segments of the box, which is the number of pixels of the canvases along the height. Defaults to whatever `widthSegments` is. |
| `layers` | number | The number of layers of this box. Defaults to `1`. |
| `side` | Side | The side of the box to render. Defaults to `THREE.FrontSide`. |
| `transparent?` | boolean | Whether or not should this canvas box be rendered as transparent. Defaults to `false`. |
| `width` | number | THe width of the box. Defaults to `1`. |
| `widthSegments` | number | The width segments of the box, which is the number of pixels of the canvases along the width. Defaults to `8`. |

___

### CharacterOptions

Ƭ **CharacterOptions**: `Object`

Parameters to create a character.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `arms?` | Partial\<ArmsOptions\> | Parameters to create the character's arms. |
| `body?` | Partial\<BodyOptions\> | Parameters to create the character's body. |
| `head?` | Partial\<HeadOptions\> | Parameters to create the character's head. |
| `idleArmSwing?` | number | The speed at which the arms swing when the character is idle. Defaults to `0.06`. |
| `legs?` | Partial\<LegOptions\> | Parameters to create the character's legs. |
| `nameTagOptions?` | Partial\<NameTagOptions\> | - |
| `positionLerp?` | number | The lerp factor of the character's position change. Defaults to `0.7`. |
| `rotationLerp?` | number | The lerp factor of the character's rotation change. Defaults to `0.2`. |
| `swingLerp?` | number | The lerp factor of the swinging motion of the arms and legs. Defaults to `0.8`. |
| `walkingSpeed?` | number | The speed at which the arms swing when the character is moving. Defaults to `1.4`. |

___

### ClickType

Ƭ **ClickType**: "left" \| "middle" \| "right"

Three types of clicking for mouse input listening.

___

### CloudsOptions

Ƭ **CloudsOptions**: `Object`

Parameters used to create a new Clouds instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `alpha` | number | The opacity of the clouds. Defaults to `0.8`. |
| `cloudHeight` | number | The y-height at which the clouds are generated. Defaults to `256`. |
| `color` | string | The color of the clouds. Defaults to `#fff`. |
| `count` | number | The number of cloud cells to generate, `count` * `count`. Defaults to `16`. |
| `dimensions` | Coords3 | The dimension of each cloud block. Defaults to `[20, 20, 20]`. |
| `falloff` | number | The noise falloff factor used to generate the clouds. Defaults to `0.9`. |
| `height` | number | The vertical count of how many cloud blocks are in a cloud cell. This is also used to determine the overall count of cloud blocks of all the clouds. Defaults to `3`. |
| `lerpFactor` | number | The lerp factor used to translate cloud blocks from their original position to their new position. Defaults to `0.3`. |
| `noiseScale` | number | The scale of the noise used to generate the clouds. Defaults to `0.08`. |
| `octaves` | number | The number of octaves used to generate the noise. Defaults to `5`. |
| `seed` | number | The seed used to generate the clouds. Defaults to `-1`. |
| `speedFactor` | number | The speed at which the clouds move. Defaults to `8`. |
| `threshold` | number | The threshold at which noise values are considered to be "cloudy" and should generate a new cloud block. Defaults to `0.05`. |
| `uFogColor?` | Object | An object that is used as the uniform for the clouds fog color shader. |
| `uFogColor.value` | Color | - |
| `uFogFar?` | Object | An object that is used as the uniform for the clouds fog far shader. |
| `uFogFar.value` | number | - |
| `uFogNear?` | Object | An object that is used as the uniform for the clouds fog near shader. |
| `uFogNear.value` | number | - |
| `width` | number | The horizontal count of how many cloud blocks are in a cloud cell. Defaults to `8`. |

___

### CommandProcessor

Ƭ **CommandProcessor**: Function

#### Type declaration

▸ (`rest`): void

A process that gets run when a command is triggered.

##### Parameters

| Name | Type |
| :------ | :------ |
| `rest` | string |

##### Returns

void

___

### Coords2

Ƭ **Coords2**: [number, number]

___

### Coords3

Ƭ **Coords3**: [number, number, number]

___

### CullOptionsType

Ƭ **CullOptionsType**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `dimensions` | Coords3 |
| `max` | Coords3 |
| `min` | Coords3 |
| `realMax` | Coords3 |
| `realMin` | Coords3 |

___

### CustomChunkShaderMaterial

Ƭ **CustomChunkShaderMaterial**: ShaderMaterial & Object

Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture. Keep in mind that
if you want to change its map, you also have to change its `uniforms.map`.

___

### DebugOptions

Ƭ **DebugOptions**: `Object`

Parameters to create a Debug instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `asyncPeriod` | number | - |
| `dataClass` | string | A class to add to the wrapper of the top-left debug panel. |
| `dataStyles` | Partial\<CSSStyleDeclaration\> | Styles to apply to the wrapper of the top-left debug panel. |
| `entriesClass` | string | A class to add to the wrapper of all debug entries. |
| `entryStyles` | Partial\<CSSStyleDeclaration\> | Styles to apply to the wrapper of all debug entries. |
| `lineClass` | string | A class to add to each of the debug entry line (top left). |
| `lineStyles` | Partial\<CSSStyleDeclaration\> | Styles to apply to each of the debug entry line (top left). |
| `onByDefault` | boolean | Whether or not should the debug panel be displayed by default when the page loads. Defaults to `true`. You can toggle the debug panel by calling Debug.toggle. |
| `showVoxelize` | boolean | Whether or not should `Voxelize x.x.x` be displayed in the top-left debug panel. Defaults to `true`. |
| `stats` | boolean | Whether or not should [stats.js](https://github.com/mrdoob/stats.js/) be enabled. Defaults to `true`. |

___

### DeepPartial

Ƭ **DeepPartial**: \{ [P in keyof T]?: DeepPartial\<T[P]\> }

#### Type parameters

| Name |
| :------ |
| `T` |

___

### Event

Ƭ **Event**: `Object`

A Voxelize event from the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | string | The name to identify the event. |
| `payload?` | any | Additional information of the event. |

___

### EventHandler

Ƭ **EventHandler**: Function

#### Type declaration

▸ (`payload`): void

The handler for an event sent from the Voxelize server.

##### Parameters

| Name | Type |
| :------ | :------ |
| `payload` | any \| null |

##### Returns

void

___

### HeadOptions

Ƭ **HeadOptions**: ColorCanvasBoxOptions & Object

___

### InputOccasion

Ƭ **InputOccasion**: "keydown" \| "keypress" \| "keyup"

The occasion that the input should be fired.

___

### InputSpecifics

Ƭ **InputSpecifics**: `Object`

The specific options of the key to listen to.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `checkType?` | "key" \| "code" | The type of key to check for. Defaults to `key`. |
| `identifier?` | string | A special identifier to tag this input with. This is useful for removing specific inputs from the input listener later on. |
| `occasion?` | InputOccasion | The occasion that the input should be fired. Defaults to `keydown`. |

___

### ItemSlotsOptions

Ƭ **ItemSlotsOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `activatedByDefault` | boolean |
| `focusFirstByDefault` | boolean |
| `horizontalCount` | number |
| `perspective` | CameraPerspective |
| `scrollable?` | boolean |
| `slotClass` | string |
| `slotFocusClass` | string |
| `slotHeight` | number |
| `slotHoverClass` | string |
| `slotMargin` | number |
| `slotPadding` | number |
| `slotStyles` | Partial\<CSSStyleDeclaration\> |
| `slotSubscriptClass` | string |
| `slotSubscriptStyles` | Partial\<CSSStyleDeclaration\> |
| `slotWidth` | number |
| `verticalCount` | number |
| `wrapperClass` | string |
| `wrapperStyles` | Partial\<CSSStyleDeclaration\> |
| `zoom` | number |

___

### LegOptions

Ƭ **LegOptions**: ColorCanvasBoxOptions & Object

Parameters to create the legs of a character.
Defaults to:
```ts
{
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: THREE.DoubleSide,
  width: 0.25 * CHARACTER_SCALE,
  widthSegments: 3,
  height: 0.25 * CHARACTER_SCALE,
  heightSegments: 3,
  depth: 0.25 * CHARACTER_SCALE,
  depthSegments: 3,
  betweenLegsGap: 0.2 * CHARACTER_SCALE,
}
```
where `CHARACTER_SCALE` is 0.9.

___

### LightColor

Ƭ **LightColor**: "RED" \| "GREEN" \| "BLUE" \| "SUNLIGHT"

Sunlight or the color of torch light.

___

### LightNode

Ƭ **LightNode**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `level` | number |
| `voxel` | Coords3 |

___

### LightShinedOptions

Ƭ **LightShinedOptions**: `Object`

Parameters to create a light shine effect.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `lerpFactor` | number | The lerping factor of the brightness of each mesh. Defaults to `0.1`. |

___

### MeshResultType

Ƭ **MeshResultType**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `indices` | Float32Array |
| `normals` | Float32Array |
| `positions` | Float32Array |

___

### NameTagOptions

Ƭ **NameTagOptions**: `Object`

Parameters to create a name tag.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `backgroundColor?` | string | The background color of the name tag. Defaults to `0x00000077`. |
| `color?` | string | The color of the name tag. Defaults to `0xffffff`. |
| `fontFace?` | string | The font face to create the name tag. Defaults to `"monospace"`. |
| `fontSize?` | number | The font size to create the name tag. Defaults to `0.1`. |
| `yOffset?` | number | The y-offset of the nametag moved upwards. Defaults to `0`. |

___

### NetworkConnectionOptions

Ƭ **NetworkConnectionOptions**: `Object`

Parameters to customize the connection to a Voxelize server. For example, setting a secret
key to authenticate the connection with the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `reconnectTimeout?` | number | On disconnection, the timeout to attempt to reconnect. Defaults to 5000. |
| `secret?` | string | The secret to joining a server, a key that if set on the server, then must be provided to connect to the server successfully. |

___

### NetworkOptions

Ƭ **NetworkOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxPacketsPerTick` | number |

___

### PartialRecord

Ƭ **PartialRecord**: \{ [P in K]?: T }

#### Type parameters

| Name | Type |
| :------ | :------ |
| `K` | extends keyof any |
| `T` | `T` |

___

### PeersOptions

Ƭ **PeersOptions**: `Object`

Parameters to customize the peers manager.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `autoAddToSelf` | boolean | - |
| `countSelf` | boolean | Whether or not should the client themselves be counted as "updated". In other words, whether or not should the update function be called on the client's own data. Defaults to `false`. |
| `updateChildren` | boolean | Whether or not should the peers manager automatically call `update` on any children mesh. Defaults to `true`. |

___

### PerspectiveOptions

Ƭ **PerspectiveOptions**: `Object`

Parameters to create a new Perspective instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `blockMargin` | number | The margin between the camera and any block that the camera is colliding with. This prevents the camera from clipping into blocks. Defaults to `0.3`. |
| `ignoreFluids` | boolean | Whether or not should the camera ignore fluid block collisions. Defaults to `true`. |
| `ignoreSeeThrough` | boolean | Whether or not should the camera ignore see-through block collisions. Defaults to `true`. |
| `lerpFactor` | number | The lerping factor for the camera's position. Defaults to `0.5`. |
| `maxDistance` | number | The maximum distance the camera can go from the player's center. Defaults to `5`. |

___

### PortraitOptions

Ƭ **PortraitOptions**: `Object`

Parameters to create a portrait with.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `height` | number | The height of the portrait canvas. Defaults to `100` pixels. |
| `lightRotationOffset` | number | The rotation around the y axis about the camera. This is used to calculate the position of the light. Defaults to `-Math.PI / 8`. |
| `perspective` | CameraPerspective | The position of where the camera should be looking at. Defaults to `pxyz`, which means that the camera will be looking at the center of the object from the positive x, y, and z axis scaled by the zoom. |
| `renderOnce` | boolean | Whether or not should this portrait only render once. Defaults to `false`. |
| `width` | number | The width of the portrait canvas. Defaults to `100` pixels. |
| `zoom` | number | The arbitrary zoom from the camera to the object. This is used to calculate the zoom of the camera. Defaults to `1`. |

___

### ProtocolWS

Ƭ **ProtocolWS**: WebSocket & Object

A custom WebSocket type that supports protocol buffer sending.

___

### RigidControlState

Ƭ **RigidControlState**: `Object`

The state of which a Voxelize Controls is in.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `crouching` | boolean | Whether if the client is attempting to crouch, if the crouch key is pressed. Defaults to `false`. |
| `currentJumpTime` | number | The current amount of time spent in the air from jump. Defaults to `0`. |
| `heading` | number | In radians, the heading y-rotation of the client. Defaults to `0`. |
| `isJumping` | boolean | Whether or not is the client jumping, in the air. Defaults to `false`. |
| `jumpCount` | number | How many times has the client jumped. Defaults to `0`. |
| `jumping` | boolean | Whether if the client is attempting to jump, if the jump key is pressed. Defaults to `false`. |
| `running` | boolean | Whether if the client is running. Defaults to `false`. |
| `sprinting` | boolean | Whether if the client is attempting to sprint, if the sprint key is pressed. Defaults to `false`. |

___

### RigidControlsOptions

Ƭ **RigidControlsOptions**: `Object`

Parameters to initialize the Voxelize Controls.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `airJumps` | number | How many times can a client jump in the air. Defaults to `0`. |
| `airMoveMult` | number | The factor applied to the movements of the client in air, such as while half-jump. Defaults to `0.7`. |
| `alwaysSprint` | boolean | Sprint factor would be on always. Defaults to `false`. |
| `bodyDepth` | number | The depth of the client's avatar. Defaults to `0.8` blocks. |
| `bodyHeight` | number | The height of the client's avatar. Defaults to `1.55` blocks. |
| `bodyWidth` | number | The width of the client's avatar. Defaults to `0.8` blocks. |
| `crouchFactor` | number | The factor to the movement speed when crouch is applied. Defaults to `0.6`. |
| `eyeHeight` | number | The ratio to `bodyHeight` at which the camera is placed from the ground. Defaults at `0.9193548387096774`. |
| `fluidPushForce` | number | The force upwards when a client tries to jump in water. Defaults to `0.3`. |
| `flyForce` | number | The level of force at which a client flies at. Defaults to `80`. |
| `flyImpulse` | number | The level impulse of which a client flies at. Defaults to `2.5`. |
| `flyInertia` | number | The inertia of a client when they're flying. Defaults to `6`. |
| `flySpeed` | number | The level of speed at which a client flies at. Defaults to `40`. |
| `initialDirection` | Coords3 | - |
| `initialPosition` | Coords3 | Initial position of the client. Defaults to `(0, 80, 10)`. |
| `jumpForce` | number | The level of force applied to the client when jumping. Defaults to `1`. |
| `jumpImpulse` | number | The level of impulse at which the client jumps upwards. Defaults to `8`. |
| `jumpTime` | number | The time, in milliseconds, that a client can be jumping. Defaults to `50`ms. |
| `maxPolarAngle` | number | Maximum polar angle that camera can look up to. Defaults to `Math.PI * 0.99` |
| `maxSpeed` | number | The maximum level of speed of a client. Default is `6` . |
| `minPolarAngle` | number | Minimum polar angle that camera can look down to. Defaults to `Math.PI * 0.01`. |
| `moveForce` | number | The level of force of which the client can move at. Default is `30`. |
| `positionLerp` | number | The interpolation factor of the client's position. Defaults to `1.0`. |
| `responsiveness` | number | The level of responsiveness of a client to movements. Default is `240`. |
| `rotationLerp` | number | The interpolation factor of the client's rotation. Defaults to `0.9`. |
| `runningFriction` | number | Default running friction of a client. Defaults to `0.1`. |
| `sensitivity` | number | The mouse sensitivity. Defaults to `100`. |
| `sprintFactor` | number | The factor to the movement speed when sprint is applied. Defaults to `1.4`. |
| `standingFriction` | number | Default standing friction of a client. Defaults to `4`. |
| `stepHeight` | number | How tall a client can step up. Defaults to `0.5`. |
| `stepLerp` | number | The interpolation factor when the client is auto-stepping. Defaults to `0.6`. |

___

### ShadowOptions

Ƭ **ShadowOptions**: `Object`

Parameters to create a shadow.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `maxDistance` | number | The maximum distance from the object to the ground to cast a shadow. The shadow's scale scales inversely with distance. Defaults to `10`. |
| `maxRadius` | number | The maximum radius the shadow can have. That is, the radius of the shadow when the object is on the ground. Defaults to `0.5`. |

___

### SharedWorkerPoolJob

Ƭ **SharedWorkerPoolJob**: `Object`

A worker pool job is queued to a worker pool and is executed by a worker.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `buffers?` | ArrayBufferLike[] | Any array buffers (transferable) that are passed to the worker. |
| `message` | any | A JSON serializable object that is passed to the worker. |
| `resolve` | Function | - |

___

### SharedWorkerPoolOptions

Ƭ **SharedWorkerPoolOptions**: `Object`

Parameters to create a worker pool.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `maxWorker` | number | The maximum number of workers to create. Defaults to `8`. |

___

### SkyOptions

Ƭ **SkyOptions**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `dimension` | number | The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension. |
| `lerpFactor` | number | The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color. set by the `setTopColor`, `setMiddleColor`, and `setBottomColor` methods. |
| `transitionSpan` | number | - |

___

### SkyShadingCycleData

Ƭ **SkyShadingCycleData**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `color` | Object |
| `color.bottom` | Color \| string |
| `color.middle` | Color \| string |
| `color.top` | Color \| string |
| `name` | string |
| `skyOffset` | number |
| `start` | number |
| `voidOffset` | number |

___

### TargetType

Ƭ **TargetType**: "All" \| "Player" \| "Entity"

___

### UV

Ƭ **UV**: `Object`

The UV range of a texture on the texture atlas.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `endU` | number | The ending U coordinate of the texture. |
| `endV` | number | The ending V coordinate of the texture. |
| `startU` | number | The starting U coordinate of the texture. |
| `startV` | number | The starting V coordinate of the texture. |

___

### VoxelInteractOptions

Ƭ **VoxelInteractOptions**: `Object`

Parameters to customize the VoxelInteract instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `highlightColor` | Color | The color of the highlight. Defaults to `0xffffff`. |
| `highlightLerp` | number | The lerping factor of the highlight. Defaults to `0.8`. |
| `highlightOpacity` | number | The opacity of the highlight. Defaults to `0.8`. |
| `highlightScale` | number | The scale of the block highlight. Defaults to `1.002`. |
| `highlightType` | "box" \| "outline" | The type of the block highlight. Box would be a semi-transparent box, while outline would be 12 lines that outline the block's AABB union. Defaults to `"box"`. |
| `ignoreFluids` | boolean | Whether or not should the VoxelInteract instance ignore fluids when raycasting. Defaults to `true`. |
| `inverseDirection` | boolean | Whether or not should the VoxelInteract instance reverse the raycasting direction. Defaults to `false`. |
| `potentialVisuals` | boolean | **`Debug`** Whether or not should there be arrows indicating the potential block placement's orientations. Defaults to `false`. |
| `reachDistance` | number | The maximum distance of reach for the VoxelInteract instance. Defaults to `32`. |

___

### WorkerPoolJob

Ƭ **WorkerPoolJob**: `Object`

A worker pool job is queued to a worker pool and is executed by a worker.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `buffers?` | ArrayBufferLike[] | Any array buffers (transferable) that are passed to the worker. |
| `message` | any | A JSON serializable object that is passed to the worker. |
| `resolve` | Function | - |

___

### WorkerPoolOptions

Ƭ **WorkerPoolOptions**: `Object`

Parameters to create a worker pool.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `maxWorker` | number | The maximum number of workers to create. Defaults to `8`. |

___

### WorldClientOptions

Ƭ **WorldClientOptions**: `Object`

The client-side options to create a world. These are client-side only and can be customized to specific use.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `chunkLoadExponent` | number | The exponent applied to the ratio that chunks are loaded, which would then be used to determine whether an angle to a chunk is worth loading. Defaults to `8`. |
| `chunkRerequestInterval` | number | The interval between each time a chunk is re-requested to the server. Defaults to `300` updates. |
| `chunkUniformsOverwrite` | Partial\<Chunks["uniforms"]\> | The uniforms to overwrite the default chunk material uniforms. Defaults to `{}`. |
| `cloudsOptions` | Partial\<CloudsOptions\> | The options to create the clouds. Defaults to `{}`. |
| `defaultRenderRadius` | number | The default render radius of the world, in chunks. Change this through `world.renderRadius`. Defaults to `8` chunks. |
| `maxChunkRequestsPerUpdate` | number | The maximum chunk requests this world can request from the server per world update. Defaults to `12` chunks. |
| `maxLightsUpdateTime` | number | - |
| `maxMeshesPerUpdate` | number | - |
| `maxProcessesPerUpdate` | number | The maximum amount of chunks received from the server that can be processed per world update. By process, it means to be turned into a `Chunk` instance. Defaults to `8` chunks. |
| `maxUpdatesPerUpdate` | number | The maximum voxel updates that can be sent to the server per world update. Defaults to `1000` updates. |
| `minLightLevel` | number | The minimum light level even when sunlight and torch light levels are at zero. Defaults to `0.04`. |
| `shouldGenerateChunkMeshes` | boolean | Whether or not should the world generate ThreeJS meshes. Defaults to `true`. |
| `skyOptions` | Partial\<SkyOptions\> | The options to create the sky. Defaults to `{}`. |
| `statsSyncInterval` | number | The interval between each time the world requests the server for its stats. Defaults to 500ms. |
| `sunlightChangeSpan` | number | The fraction of the day that sunlight takes to change from appearing to disappearing or disappearing to appearing. Defaults to `0.1`. |
| `sunlightEndTimeFrac` | number | The fraction of the day that sunlight starts to disappear. Defaults to `0.7`. |
| `sunlightStartTimeFrac` | number | The fraction of the day that sunlight starts to appear. Defaults to `0.25`. |
| `textureUnitDimension` | number | The default dimension to a single unit of a block face texture. If any texture loaded is greater, it will be downscaled to this resolution. Defaults to `8` pixels. |
| `timeForceThreshold` | number | The threshold to force the server's time to the client's time. Defaults to `0.1`. |

___

### WorldOptions

Ƭ **WorldOptions**: WorldClientOptions & WorldServerOptions

The options to create a world. This consists of WorldClientOptions and WorldServerOptions.

___

### WorldServerOptions

Ƭ **WorldServerOptions**: `Object`

The options defined on the server-side, passed to the client on network joining.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `airDrag` | number | The air drag of everything physical. |
| `chunkSize` | number | The width and depth of a chunk, in blocks. |
| `doesTickTime` | boolean | - |
| `fluidDensity` | number | The density of the fluid in this world. |
| `fluidDrag` | number | The fluid drag of everything physical. |
| `gravity` | number[] | The gravity of everything physical in this world. |
| `maxChunk` | [number, number] | The maximum chunk coordinate of this world, inclusive. |
| `maxHeight` | number | The height of a chunk, in blocks. |
| `maxLightLevel` | number | The maximum light level that propagates in this world, including sunlight and torch light. |
| `minBounceImpulse` | number | The minimum bouncing impulse of everything physical in this world. |
| `minChunk` | [number, number] | The minimum chunk coordinate of this world, inclusive. |
| `subChunks` | number | The number of sub-chunks that divides a chunk vertically. |
| `timePerDay` | number | The time per day in seconds. |

## Variables

### BLUE\_LIGHT

• `Const` **BLUE\_LIGHT**: "BLUE" = `"BLUE"`

The string representation of blue light.

___

### BOX\_SIDES

• `Const` **BOX\_SIDES**: BoxSides[]

The six default faces of a canvas box.

___

### DEFAULT\_CHUNK\_SHADERS

• `Const` **DEFAULT\_CHUNK\_SHADERS**: `Object`

This is the default shaders used for the chunks.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `fragment` | string |
| `vertex` | string |

___

### GREEN\_LIGHT

• `Const` **GREEN\_LIGHT**: "GREEN" = `"GREEN"`

The string representation of green light.

___

### NX\_ROTATION

• `Const` **NX\_ROTATION**: 3 = `3`

The numerical representation of the negative X rotation.

___

### NY\_ROTATION

• `Const` **NY\_ROTATION**: 1 = `1`

The numerical representation of the negative Y rotation.

___

### NZ\_ROTATION

• `Const` **NZ\_ROTATION**: 5 = `5`

The numerical representation of the negative Z rotation.

___

### OPAQUE\_RENDER\_ORDER

• `Const` **OPAQUE\_RENDER\_ORDER**: 100 = `100`

___

### PX\_ROTATION

• `Const` **PX\_ROTATION**: 2 = `2`

The numerical representation of the positive X rotation.

___

### PY\_ROTATION

• `Const` **PY\_ROTATION**: 0 = `0`

The numerical representation of the positive Y rotation.

___

### PZ\_ROTATION

• `Const` **PZ\_ROTATION**: 4 = `4`

The numerical representation of the positive Z rotation.

___

### RED\_LIGHT

• `Const` **RED\_LIGHT**: "RED" = `"RED"`

The string representation of red light.

___

### SUNLIGHT

• `Const` **SUNLIGHT**: "SUNLIGHT" = `"SUNLIGHT"`

The string representation of sunlight.

___

### TRANSPARENT\_RENDER\_ORDER

• `Const` **TRANSPARENT\_RENDER\_ORDER**: 100000 = `100000`

___

### Y\_ROT\_MAP

• `Const` **Y\_ROT\_MAP**: [number, number][] = `[]`

A rotational map used to get the closest y-rotation representation to a y-rotation value.

Rotation value -> index

___

### Y\_ROT\_MAP\_EIGHT

• `Const` **Y\_ROT\_MAP\_EIGHT**: [number, number][] = `[]`

___

### Y\_ROT\_MAP\_FOUR

• `Const` **Y\_ROT\_MAP\_FOUR**: [number, number][] = `[]`

___

### Y\_ROT\_SEGMENTS

• `Const` **Y\_ROT\_SEGMENTS**: 16 = `16`

The amount of Y-rotation segments should be allowed for y-rotatable blocks. In other words,
the amount of times the block can be rotated around the y-axis within 360 degrees.

The accepted Y-rotation values will be from `0` to `Y_ROTATION_SEGMENTS - 1`.

___

### artFunctions

• `Const` **artFunctions**: `Object`

A preset of art functions to draw on canvas boxes.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `drawCrown` | ArtFunction |
| `drawMoon` | Function |
| `drawStars` | Function |
| `drawSun` | Function |

___

### customShaders

• `Const` **customShaders**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `sway` | Method sway |

___

### defaultArmsOptions

• `Const` **defaultArmsOptions**: ArmsOptions

___

### defaultBodyOptions

• `Const` **defaultBodyOptions**: BodyOptions

___

### defaultCharacterOptions

• `Const` **defaultCharacterOptions**: CharacterOptions

___

### defaultHeadOptions

• `Const` **defaultHeadOptions**: HeadOptions

___

### defaultLegsOptions

• `Const` **defaultLegsOptions**: LegOptions

## Functions

### TRANSPARENT\_SORT

▸ **TRANSPARENT_SORT**(`object`): Function

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | Object3D\<Object3DEventMap\> |

#### Returns

Function

▸ (`a`, `b`): number

##### Parameters

| Name | Type |
| :------ | :------ |
| `a` | any |
| `b` | any |

##### Returns

number

___

### cull

▸ **cull**(`array`, `options`): Promise\<MeshResultType\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `array` | NdArray\<number[] \| TypedArray \| GenericArray\<number\>\> |
| `options` | CullOptionsType |

#### Returns

Promise\<MeshResultType\>

___

### requestWorkerAnimationFrame

▸ **requestWorkerAnimationFrame**(`callback`): number

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback` | Function |

#### Returns

number

___

### setWorkerInterval

▸ **setWorkerInterval**(`func`, `interval`): Function

#### Parameters

| Name | Type |
| :------ | :------ |
| `func` | Function |
| `interval` | number |

#### Returns

Function

▸ (): void

##### Returns

void
