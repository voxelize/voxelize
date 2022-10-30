---
id: "BlockOverlayEffect"
title: "Class: BlockOverlayEffect"
sidebar_label: "BlockOverlayEffect"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Effect`

  ↳ **`BlockOverlayEffect`**

## Constructors

### constructor

• **new BlockOverlayEffect**(`world`, `camera`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `world` | [`World`](World.md) |
| `camera` | `PerspectiveCamera` |

#### Overrides

Effect.constructor

## Properties

### world

• **world**: [`World`](World.md)

___

### camera

• **camera**: `PerspectiveCamera`

___

### name

• **name**: `string`

The name of this effect.

#### Inherited from

Effect.name

___

### defines

• `Readonly` **defines**: `Map`<`string`, `string`\>

Preprocessor macro definitions.

Call {@link Effect.setChanged} after changing macro definitions.

#### Inherited from

Effect.defines

___

### uniforms

• `Readonly` **uniforms**: `Map`<`string`, `Uniform`\>

Shader uniforms.

Call {@link Effect.setChanged} after adding or removing uniforms.

#### Inherited from

Effect.uniforms

___

### extensions

• `Readonly` **extensions**: `Set`<`WebGLExtension`\>

WebGL extensions that are required by this effect.

Call {@link Effect.setChanged} after adding or removing extensions.

#### Inherited from

Effect.extensions

___

### blendMode

• `Readonly` **blendMode**: `BlendMode`

The blend mode of this effect.

#### Inherited from

Effect.blendMode

## Methods

### addOverlay

▸ **addOverlay**(`idOrName`, `color`, `opacity`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |
| `color` | `Color` |
| `opacity` | `number` |

#### Returns

`void`

___

### update

▸ **update**(): `void`

#### Returns

`void`

#### Overrides

Effect.update

___

### addEventListener

▸ **addEventListener**<`T`\>(`type`, `listener`): `void`

Adds a listener to an event type.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` | The type of event to listen to. |
| `listener` | `EventListener`<`Event`, `T`, [`BlockOverlayEffect`](BlockOverlayEffect.md)\> | The function that gets called when the event is fired. |

#### Returns

`void`

#### Inherited from

Effect.addEventListener

___

### hasEventListener

▸ **hasEventListener**<`T`\>(`type`, `listener`): `boolean`

Checks if listener is added to an event type.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` | The type of event to listen to. |
| `listener` | `EventListener`<`Event`, `T`, [`BlockOverlayEffect`](BlockOverlayEffect.md)\> | The function that gets called when the event is fired. |

#### Returns

`boolean`

#### Inherited from

Effect.hasEventListener

___

### removeEventListener

▸ **removeEventListener**<`T`\>(`type`, `listener`): `void`

Removes a listener from an event type.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` | The type of the listener that gets removed. |
| `listener` | `EventListener`<`Event`, `T`, [`BlockOverlayEffect`](BlockOverlayEffect.md)\> | The listener function that gets removed. |

#### Returns

`void`

#### Inherited from

Effect.removeEventListener

___

### dispatchEvent

▸ **dispatchEvent**(`event`): `void`

Fire an event type.

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `Event` |

#### Returns

`void`

#### Inherited from

Effect.dispatchEvent

___

### getName

▸ **getName**(): `string`

Returns the name of this effect.

**`deprecated`** Use name instead.

#### Returns

`string`

The name.

#### Inherited from

Effect.getName

___

### setRenderer

▸ **setRenderer**(`renderer`): `void`

Sets the renderer.

**`deprecated`**

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `renderer` | `WebGLRenderer` | The renderer. |

#### Returns

`void`

#### Inherited from

Effect.setRenderer

___

### getDefines

▸ **getDefines**(): `Map`<`string`, `string`\>

Returns the preprocessor macro definitions.

**`deprecated`** Use defines instead.

#### Returns

`Map`<`string`, `string`\>

The extensions.

#### Inherited from

Effect.getDefines

___

### getUniforms

▸ **getUniforms**(): `Map`<`string`, `Uniform`\>

Returns the uniforms of this effect.

**`deprecated`** Use uniforms instead.

#### Returns

`Map`<`string`, `Uniform`\>

The extensions.

#### Inherited from

Effect.getUniforms

___

### getExtensions

▸ **getExtensions**(): `Set`<`WebGLExtension`\>

Returns the WebGL extensions that are required by this effect.

**`deprecated`** Use extensions instead.

#### Returns

`Set`<`WebGLExtension`\>

The extensions.

#### Inherited from

Effect.getExtensions

___

### getBlendMode

▸ **getBlendMode**(): `BlendMode`

Returns the blend mode.

The result of this effect will be blended with the result of the previous effect using this blend mode.

**`deprecated`** Use blendMode instead.

#### Returns

`BlendMode`

The blend mode.

#### Inherited from

Effect.getBlendMode

___

### getAttributes

▸ **getAttributes**(): `EffectAttribute`

Returns the effect attributes.

#### Returns

`EffectAttribute`

The attributes.

#### Inherited from

Effect.getAttributes

___

### getFragmentShader

▸ **getFragmentShader**(): `string`

Returns the fragment shader.

#### Returns

`string`

The fragment shader.

#### Inherited from

Effect.getFragmentShader

___

### getVertexShader

▸ **getVertexShader**(): `string`

Returns the vertex shader.

#### Returns

`string`

The vertex shader.

#### Inherited from

Effect.getVertexShader

___

### setDepthTexture

▸ **setDepthTexture**(`depthTexture`, `depthPacking?`): `void`

Sets the depth texture.

You may override this method if your effect requires direct access to the depth texture that is bound to the
associated {@link EffectPass}.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `depthTexture` | `Texture` | A depth texture. |
| `depthPacking?` | `DepthPackingStrategies` | - |

#### Returns

`void`

#### Inherited from

Effect.setDepthTexture

___

### setSize

▸ **setSize**(`width`, `height`): `void`

Updates the size of this effect.

You may override this method if you want to be informed about the size of the backbuffer/canvas.
This method is called before [initialize](BlockOverlayEffect.md#initialize-184) and every time the size of the {@link EffectComposer} changes.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `width` | `number` | The width. |
| `height` | `number` | The height. |

#### Returns

`void`

#### Inherited from

Effect.setSize

___

### initialize

▸ **initialize**(`renderer`, `alpha`, `frameBufferType`): `void`

Performs initialization tasks.

This method is called when the associated {@link EffectPass} is added to an {@link EffectComposer}.

**`example`** if(!alpha && frameBufferType === UnsignedByteType) { this.myRenderTarget.texture.format = RGBFormat; }

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `renderer` | `WebGLRenderer` | The renderer. |
| `alpha` | `boolean` | Whether the renderer uses the alpha channel or not. |
| `frameBufferType` | `number` | The type of the main frame buffers. |

#### Returns

`void`

#### Inherited from

Effect.initialize

___

### dispose

▸ **dispose**(): `void`

Performs a shallow search for properties that define a dispose method and deletes them.

The {@link EffectComposer} calls this method when it is being destroyed.

#### Returns

`void`

#### Inherited from

Effect.dispose

## Accessors

### inputColorSpace

• `get` **inputColorSpace**(): `TextureEncoding`

The input color space.

**`experimental`**

#### Returns

`TextureEncoding`

#### Inherited from

Effect.inputColorSpace

___

### outputColorSpace

• `get` **outputColorSpace**(): `TextureEncoding`

The output color space.

Should only be changed if this effect converts the input colors to a different color space.

**`experimental`**

#### Returns

`TextureEncoding`

#### Inherited from

Effect.outputColorSpace

___

### mainScene

• `set` **mainScene**(`arg`): `void`

Sets the main scene.

#### Parameters

| Name | Type |
| :------ | :------ |
| `arg` | `Scene` |

#### Returns

`void`

#### Inherited from

Effect.mainScene

___

### mainCamera

• `set` **mainCamera**(`arg`): `void`

Sets the main camera.

#### Parameters

| Name | Type |
| :------ | :------ |
| `arg` | `Camera` |

#### Returns

`void`

#### Inherited from

Effect.mainCamera
