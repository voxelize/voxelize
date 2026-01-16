---
id: "LightSourceRegistry"
title: "Class: LightSourceRegistry"
sidebar_label: "LightSourceRegistry"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new LightSourceRegistry**(): [`LightSourceRegistry`](LightSourceRegistry.md)

#### Returns

[`LightSourceRegistry`](LightSourceRegistry.md)

## Accessors

### lightCount

• `get` **lightCount**(): `number`

#### Returns

`number`

## Methods

### addLight

▸ **addLight**(`id`, `light`): [`DynamicLight`](../interfaces/DynamicLight.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `light` | `Omit`\<[`DynamicLight`](../interfaces/DynamicLight.md), ``"id"``\> |

#### Returns

[`DynamicLight`](../interfaces/DynamicLight.md)

___

### clear

▸ **clear**(): `void`

#### Returns

`void`

___

### clearDirtyRegions

▸ **clearDirtyRegions**(): `void`

#### Returns

`void`

___

### getAllLights

▸ **getAllLights**(): [`DynamicLight`](../interfaces/DynamicLight.md)[]

#### Returns

[`DynamicLight`](../interfaces/DynamicLight.md)[]

___

### getDirtyRegions

▸ **getDirtyRegions**(): `string`[]

#### Returns

`string`[]

___

### getLight

▸ **getLight**(`id`): [`DynamicLight`](../interfaces/DynamicLight.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

[`DynamicLight`](../interfaces/DynamicLight.md)

___

### getLightsInRegion

▸ **getLightsInRegion**(`min`, `max`): [`DynamicLight`](../interfaces/DynamicLight.md)[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `min` | `Vector3` |
| `max` | `Vector3` |

#### Returns

[`DynamicLight`](../interfaces/DynamicLight.md)[]

___

### getLightsNearPoint

▸ **getLightsNearPoint**(`point`, `maxDistance`): [`DynamicLight`](../interfaces/DynamicLight.md)[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `point` | `Vector3` |
| `maxDistance` | `number` |

#### Returns

[`DynamicLight`](../interfaces/DynamicLight.md)[]

___

### onLightChanged

▸ **onLightChanged**(`callback`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback` | (`light`: [`DynamicLight`](../interfaces/DynamicLight.md)) => `void` |

#### Returns

`void`

___

### removeLight

▸ **removeLight**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`boolean`

___

### updateLight

▸ **updateLight**(`id`, `updates`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `updates` | `Partial`\<`Omit`\<[`DynamicLight`](../interfaces/DynamicLight.md), ``"id"``\>\> |

#### Returns

`boolean`
