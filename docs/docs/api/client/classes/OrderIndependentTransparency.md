---
id: "OrderIndependentTransparency"
title: "Class: OrderIndependentTransparency"
sidebar_label: "OrderIndependentTransparency"
sidebar_position: 0
custom_edit_url: null
---

Weighted blended order-independent transparency for one scene.

Marker objects bracket the blended band of the scene's transparent list.
The opening one (after the sky and the depth writers) hands the scene's
colour to whoever samples it mid-render (the water's refraction),
switches the render to an accumulation target that shares the scene's
depth texture, and forces the accumulation blend state on every adopted
material; the closing one switches back and draws the composite. With a
separating surface in view, the band first keeps only what lies behind
that surface, the split marker composites it and draws the band again
for the rest. Adopted materials draw their ordinary colour in any other
render, so a material shared with an inventory scene or drawn into a
shadow map is untouched.

## Constructors

### constructor

• **new OrderIndependentTransparency**(`scene`, `options`, `hooks?`): [`OrderIndependentTransparency`](OrderIndependentTransparency.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `scene` | `Object3D`<`Object3DEventMap`\> | The scene whose renders accumulate; it holds [open](OrderIndependentTransparency.md#open) and [close](OrderIndependentTransparency.md#close). |
| `options` | [`OrderIndependentTransparencyOptions`](../#orderindependenttransparencyoptions) | - |
| `hooks` | `Object` | - |
| `hooks.onOpen?` | (`renderer`: `WebGLRenderer`, `target`: `WebGLRenderTarget`<`Texture`<`unknown`\>\>) => `void` | The scene's colour as blended layers are about to draw over it: once as the accumulation opens, and again after a split, when it also holds what lies behind the separating surface. |
| `hooks.separator?` | [`OrderIndependentSeparator`](../#orderindependentseparator) | - |

#### Returns

[`OrderIndependentTransparency`](OrderIndependentTransparency.md)

## Properties

### close

• `Readonly` **close**: `Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\>

___

### open

• `Readonly` **open**: `Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\>

___

### split

• `Readonly` **split**: `Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\>

___

### stats

• `Readonly` **stats**: [`OrderIndependentStats`](../#orderindependentstats)

___

### uniforms

• `Readonly` **uniforms**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `uOitActive` | \{ `value`: `number` = 0 } |
| `uOitActive.value` | `number` |
| `uOitClip` | \{ `value`: `Vector2`  } |
| `uOitClip.value` | `Vector2` |
| `uOitPhase` | \{ `value`: `number` = OIT\_PHASE\_ALL } |
| `uOitPhase.value` | `number` |
| `uOitSeparatorBias` | \{ `value`: `number` = 0 } |
| `uOitSeparatorBias.value` | `number` |
| `uOitSeparatorDepth` | \{ `value`: `Texture`<`unknown`\>  } |
| `uOitSeparatorDepth.value` | `Texture`<`unknown`\> |
| `uOitViewport` | \{ `value`: `Vector2`  } |
| `uOitViewport.value` | `Vector2` |
| `uOitWeight` | \{ `value`: `Vector4`  } |
| `uOitWeight.value` | `Vector4` |
| `uOitWeightRange` | \{ `value`: `Vector2`  } |
| `uOitWeightRange.value` | `Vector2` |

## Accessors

### isOpen

• `get` **isOpen**(): `boolean`

Whether this render's blended layers are accumulating right now.

#### Returns

`boolean`

## Methods

### adopt

▸ **adopt**(`material`): `boolean`

Wraps `material` with the encoder if it can accumulate; returns whether
it draws in the blended band. Call it before the material first
compiles (a warmup), or it compiles twice.

#### Parameters

| Name | Type |
| :------ | :------ |
| `material` | `Material` |

#### Returns

`boolean`

___

### adoptBeforeCompile

▸ **adoptBeforeCompile**(`material`): `boolean`

[adopt](OrderIndependentTransparency.md#adopt) for a warmup: a material that already compiled is left to
the sort. Every blended item this scene draws is adopted before its
first draw, so one compiled unadopted was drawn outside the band (the
sky, an overlay) or in another scene; wrapping it would only compile it
again.

#### Parameters

| Name | Type |
| :------ | :------ |
| `material` | `Material` |

#### Returns

`boolean`

___

### arm

▸ **arm**(`renderer`, `camera`): `void`

The camera whose renders of the scene accumulate. Renders with any other
camera (shadow cascades, a portrait) draw their blended layers in list
order. Call it before each frame's render.

#### Parameters

| Name | Type |
| :------ | :------ |
| `renderer` | `WebGLRenderer` |
| `camera` | `Camera` |

#### Returns

`void`

___

### bandOf

▸ **bandOf**(`object`, `material`): `number`

The band of a transparent item of this scene (see
[OIT_BLENDED_RENDER_ORDER](../#oit_blended_render_order)), or undefined to place it by its own
render order: an item of another scene, the sky, an overlay.

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> |
| `material` | `Material` |

#### Returns

`number`

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### setWeights

▸ **setWeights**(`weights`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `weights` | [`OrderIndependentWeights`](../#orderindependentweights) |

#### Returns

`void`
