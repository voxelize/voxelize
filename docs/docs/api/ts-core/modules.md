---
id: "modules"
title: "@voxelize/ts-core"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Enumerations

- [BlockRuleLogic](enums/BlockRuleLogic.md)
- [LightColor](enums/LightColor.md)

## Classes

- [AABB](classes/AABB.md)
- [AABBBuilder](classes/AABBBuilder.md)
- [BlockFace](classes/BlockFace.md)
- [BlockRotation](classes/BlockRotation.md)
- [BlockRuleEvaluator](classes/BlockRuleEvaluator.md)
- [BlockUtils](classes/BlockUtils.md)
- [Light](classes/Light.md)
- [LightUtils](classes/LightUtils.md)
- [Voxel](classes/Voxel.md)

## Interfaces

- [BlockConditionalPart](interfaces/BlockConditionalPart.md)
- [BlockDynamicPattern](interfaces/BlockDynamicPattern.md)
- [BlockFaceInit](interfaces/BlockFaceInit.md)
- [BlockRuleEvaluationOptions](interfaces/BlockRuleEvaluationOptions.md)
- [CornerData](interfaces/CornerData.md)
- [LightChannels](interfaces/LightChannels.md)
- [RotationLike](interfaces/RotationLike.md)
- [UV](interfaces/UV.md)
- [VoxelAccess](interfaces/VoxelAccess.md)
- [VoxelFields](interfaces/VoxelFields.md)

## Type Aliases

### BlockRule

Ƭ **BlockRule**: \{ `type`: ``"none"``  } \| \{ `type`: ``"simple"``  } & [`BlockSimpleRule`](modules.md#blocksimplerule) \| \{ `logic`: [`BlockRuleLogic`](enums/BlockRuleLogic.md) ; `rules`: [`BlockRule`](modules.md#blockrule)[] ; `type`: ``"combination"``  }

___

### BlockSimpleRule

Ƭ **BlockSimpleRule**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id?` | [`OptionalRuleValue`](modules.md#optionalrulevalue)\<`number`\> |
| `offset` | [`Vec3`](modules.md#vec3) |
| `rotation?` | [`OptionalRuleValue`](modules.md#optionalrulevalue)\<[`BlockRotation`](classes/BlockRotation.md)\> |
| `stage?` | [`OptionalRuleValue`](modules.md#optionalrulevalue)\<`number`\> |

___

### FaceTransparency

Ƭ **FaceTransparency**: [`boolean`, `boolean`, `boolean`, `boolean`, `boolean`, `boolean`]

___

### OptionalRuleValue

Ƭ **OptionalRuleValue**\<`T`\>: `T` \| ``null`` \| `undefined`

#### Type parameters

| Name |
| :------ |
| `T` |

___

### Vec2

Ƭ **Vec2**: [`number`, `number`]

___

### Vec3

Ƭ **Vec3**: [`number`, `number`, `number`]

## Variables

### BLOCK\_RULE\_NONE

• `Const` **BLOCK\_RULE\_NONE**: [`BlockRule`](modules.md#blockrule)

___

### NX\_ROTATION

• `Const` **NX\_ROTATION**: ``3``

___

### NY\_ROTATION

• `Const` **NY\_ROTATION**: ``1``

___

### NZ\_ROTATION

• `Const` **NZ\_ROTATION**: ``5``

___

### PI\_2

• `Const` **PI\_2**: `number`

___

### PX\_ROTATION

• `Const` **PX\_ROTATION**: ``2``

___

### PY\_ROTATION

• `Const` **PY\_ROTATION**: ``0``

___

### PZ\_ROTATION

• `Const` **PZ\_ROTATION**: ``4``

___

### ROTATION\_MASK

• `Const` **ROTATION\_MASK**: ``4293984255``

___

### STAGE\_MASK

• `Const` **STAGE\_MASK**: ``4043309055``

___

### Y\_ROTATION\_MASK

• `Const` **Y\_ROTATION\_MASK**: ``4279238655``

___

### Y\_ROT\_MAP

• `Const` **Y\_ROT\_MAP**: [`number`, `number`][] = `[]`

___

### Y\_ROT\_MAP\_EIGHT

• `Const` **Y\_ROT\_MAP\_EIGHT**: [`number`, `number`][] = `[]`

___

### Y\_ROT\_MAP\_FOUR

• `Const` **Y\_ROT\_MAP\_FOUR**: [`number`, `number`][] = `[]`

___

### Y\_ROT\_SEGMENTS

• `Const` **Y\_ROT\_SEGMENTS**: ``16``

## Functions

### assertStage

▸ **assertStage**(`stage`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `stage` | `number` |

#### Returns

`void`

___

### createBlockConditionalPart

▸ **createBlockConditionalPart**(`part`): [`BlockConditionalPart`](interfaces/BlockConditionalPart.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `part` | `Partial`\<[`BlockConditionalPart`](interfaces/BlockConditionalPart.md)\> |

#### Returns

[`BlockConditionalPart`](interfaces/BlockConditionalPart.md)

___

### createCornerData

▸ **createCornerData**(`pos`, `uv`): [`CornerData`](interfaces/CornerData.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `pos` | [`Vec3`](modules.md#vec3) |
| `uv` | [`Vec2`](modules.md#vec2) |

#### Returns

[`CornerData`](interfaces/CornerData.md)

___

### createUV

▸ **createUV**(`startU?`, `endU?`, `startV?`, `endV?`): [`UV`](interfaces/UV.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `startU` | `number` | `0` |
| `endU` | `number` | `0` |
| `startV` | `number` | `0` |
| `endV` | `number` | `0` |

#### Returns

[`UV`](interfaces/UV.md)

___

### lightColorFromIndex

▸ **lightColorFromIndex**(`color`): [`LightColor`](enums/LightColor.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `number` |

#### Returns

[`LightColor`](enums/LightColor.md)

___

### toSaturatedUint32

▸ **toSaturatedUint32**(`value`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `number` |

#### Returns

`number`

___

### toUint32

▸ **toUint32**(`value`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `number` |

#### Returns

`number`
