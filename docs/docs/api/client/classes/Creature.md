---
id: "Creature"
title: "Class: Creature"
sidebar_label: "Creature"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Group`

  ↳ **`Creature`**

## Constructors

### constructor

• **new Creature**(`options?`): [`Creature`](Creature.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Partial`\<[`CreatureOptions`](../modules.md#creatureoptions)\> |

#### Returns

[`Creature`](Creature.md)

#### Overrides

Group.constructor

## Properties

### backLeftLeg

• **backLeftLeg**: [`CanvasBox`](CanvasBox.md)

___

### backLeftLegGroup

• **backLeftLegGroup**: `Group`\<`Object3DEventMap`\>

___

### backRightLeg

• **backRightLeg**: [`CanvasBox`](CanvasBox.md)

___

### backRightLegGroup

• **backRightLegGroup**: `Group`\<`Object3DEventMap`\>

___

### body

• **body**: [`CanvasBox`](CanvasBox.md)

___

### bodyGroup

• **bodyGroup**: `Group`\<`Object3DEventMap`\>

___

### extraData

• **extraData**: `unknown` = `null`

___

### frontLeftLeg

• **frontLeftLeg**: [`CanvasBox`](CanvasBox.md)

___

### frontLeftLegGroup

• **frontLeftLegGroup**: `Group`\<`Object3DEventMap`\>

___

### frontRightLeg

• **frontRightLeg**: [`CanvasBox`](CanvasBox.md)

___

### frontRightLegGroup

• **frontRightLegGroup**: `Group`\<`Object3DEventMap`\>

___

### head

• **head**: [`CanvasBox`](CanvasBox.md)

___

### headGroup

• **headGroup**: `Group`\<`Object3DEventMap`\>

___

### nametag

• **nametag**: [`NameTag`](NameTag.md)

___

### newDirection

• **newDirection**: `Quaternion`

___

### newPosition

• **newPosition**: `Vector3`

___

### onIdle

• **onIdle**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### onMove

• **onMove**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### options

• **options**: [`CreatureOptions`](../modules.md#creatureoptions)

___

### speed

• **speed**: `number` = `0`

## Accessors

### bodyColor

• `get` **bodyColor**(): `string` \| `Color`

#### Returns

`string` \| `Color`

• `set` **bodyColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| `Color` |

#### Returns

`void`

___

### faceColor

• `get` **faceColor**(): `string` \| `Color`

#### Returns

`string` \| `Color`

• `set` **faceColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| `Color` |

#### Returns

`void`

___

### headColor

• `get` **headColor**(): `string` \| `Color`

#### Returns

`string` \| `Color`

• `set` **headColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| `Color` |

#### Returns

`void`

___

### legColor

• `get` **legColor**(): `string` \| `Color`

#### Returns

`string` \| `Color`

• `set` **legColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| `Color` |

#### Returns

`void`

___

### totalHeight

• `get` **totalHeight**(): `number`

#### Returns

`number`

___

### username

• `get` **username**(): `string`

#### Returns

`string`

• `set` **username**(`username`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `username` | `string` |

#### Returns

`void`

## Methods

### set

▸ **set**(`position`, `direction`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `number`[] |
| `direction` | `number`[] |

#### Returns

`void`

___

### update

▸ **update**(): `void`

#### Returns

`void`
