---
id: "Rendering"
title: "Class: Rendering"
sidebar_label: "Rendering"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### params

• **params**: [`RenderingParams`](../modules.md#renderingparams-92)

___

### scene

• **scene**: `Scene`

___

### renderer

• **renderer**: `WebGLRenderer`

___

### composer

• **composer**: `EffectComposer`

___

### uFogColor

• **uFogColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uFogNear

• **uFogNear**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### uFogFar

• **uFogFar**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Rendering**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`RenderingParams`](../modules.md#renderingparams-92)\> |

## Methods

### adjustRenderer

▸ **adjustRenderer**(): `void`

#### Returns

`void`

___

### matchRenderRadius

▸ **matchRenderRadius**(`radius`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `radius` | `number` |

#### Returns

`void`

___

### render

▸ **render**(): `void`

#### Returns

`void`

## Accessors

### renderSize

• `get` **renderSize**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `width` | `number` |
| `height` | `number` |

___

### aspectRatio

• `get` **aspectRatio**(): `number`

#### Returns

`number`
