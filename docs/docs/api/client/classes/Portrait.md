---
id: "Portrait"
title: "Class: Portrait"
sidebar_label: "Portrait"
sidebar_position: 0
custom_edit_url: null
---

This class allows you to render a single THREE.js object to a canvas element.
This is useful for generating images of objects for use in the game. However, there
are performance bottlenecks that you should be aware of:
- The THREE.js renderer is shared between all instances of this class. This is because
  there is a limit to how many webgl contexts can be created.
- Each individual portrait has their own render loop. This means that if you have a lto
  of portraits, you will be rendering a lot of frames per second. This can be mitigated
  by either using the renderOnce parameter or utilizing the [ItemSlots](ItemSlots.md) class, which
  batch renders objects in a grid-like fashion.

# Example
```ts
const portrait = new Portrait(world.makeBlockMesh(5));
document.body.appendChild(portrait.canvas);
```

## Constructors

### constructor

• **new Portrait**(`object`, `options?`): [`Portrait`](Portrait.md)

Create a new portrait. This automatically starts a render loop.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> | The object to render to the canvas. |
| `options` | `Partial`\<[`PortraitOptions`](../modules.md#portraitoptions)\> | The options to create this portrait with. |

#### Returns

[`Portrait`](Portrait.md)

## Properties

### camera

• **camera**: `OrthographicCamera`

The THREE.js camera to use for rendering this portrait.

___

### canvas

• **canvas**: `HTMLCanvasElement`

The canvas element to render this portrait to.

___

### object

• **object**: `Object3D`\<`Object3DEventMap`\>

The target of this portrait.

___

### options

• **options**: [`PortraitOptions`](../modules.md#portraitoptions)

Parameters to create this portrait with.

___

### scene

• **scene**: `Scene`

The THREE.js scene to use for rendering this portrait.

## Accessors

### renderer

• `get` **renderer**(): `WebGLRenderer`

#### Returns

`WebGLRenderer`

## Methods

### dispose

▸ **dispose**(): `void`

Dispose of this portrait. This stops the render loop and removes the object from the scene.
However, it does not remove the canvas from the DOM.

#### Returns

`void`

___

### setObject

▸ **setObject**(`object`): `void`

Set the object to render to the canvas.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> | The object to render to the canvas. |

#### Returns

`void`
