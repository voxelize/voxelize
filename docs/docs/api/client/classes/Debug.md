---
id: "Debug"
title: "Class: Debug"
sidebar_label: "Debug"
sidebar_position: 0
custom_edit_url: null
---

Backward-compatible Debug class.

**`Deprecated`**

Prefer `DebugUI` from `@voxelize/debug`. This class is kept so
existing `@voxelize/core` consumers continue to work unchanged.

## Constructors

### constructor

• **new Debug**(`domElement?`, `options?`): [`Debug`](Debug.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `domElement?` | `HTMLElement` |
| `options?` | [`DebugOptions`](../modules.md#debugoptions) |

#### Returns

[`Debug`](Debug.md)

## Properties

### dataWrapper

• **dataWrapper**: `HTMLDivElement`

___

### displayNewline

• **displayNewline**: () => `this`

#### Type declaration

▸ (): `this`

##### Returns

`this`

___

### displayTitle

• **displayTitle**: (`title`: `string`) => `this`

#### Type declaration

▸ (`title`): `this`

##### Parameters

| Name | Type |
| :------ | :------ |
| `title` | `string` |

##### Returns

`this`

___

### dispose

• **dispose**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### domElement

• **domElement**: `HTMLElement`

___

### entriesWrapper

• **entriesWrapper**: `HTMLDivElement`

___

### options

• **options**: `Required`\<`Omit`\<[`DebugOptions`](../modules.md#debugoptions), ``"dataStyles"`` \| ``"entriesStyles"`` \| ``"lineStyles"`` \| ``"newLineStyles"`` \| ``"statsStyles"``\>\> & \{ `dataStyles`: `Partial`\<`CSSStyleDeclaration`\> ; `entriesStyles`: `Partial`\<`CSSStyleDeclaration`\> ; `lineStyles`: `Partial`\<`CSSStyleDeclaration`\> ; `newLineStyles`: `Partial`\<`CSSStyleDeclaration`\> ; `statsStyles`: `Partial`\<`CSSStyleDeclaration`\>  }

___

### registerDisplay

• **registerDisplay**: \<T\>(`title`: `string`, `object?`: `T` \| () => `unknown`, `attribute?`: keyof `T`, `formatter?`: (`value`: `unknown`) => `string`) => `this`

#### Type declaration

▸ \<`T`\>(`title`, `object?`, `attribute?`, `formatter?`): `this`

##### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `unknown` |

##### Parameters

| Name | Type |
| :------ | :------ |
| `title` | `string` |
| `object?` | `T` \| () => `unknown` |
| `attribute?` | keyof `T` |
| `formatter?` | (`value`: `unknown`) => `string` |

##### Returns

`this`

___

### remove

• **remove**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### removeDisplay

• **removeDisplay**: (`title`: `string`) => `void`

#### Type declaration

▸ (`title`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `title` | `string` |

##### Returns

`void`

___

### stats

• `Optional` **stats**: `FpsMeter`

___

### toggle

• **toggle**: (`force?`: `boolean`) => `void`

#### Type declaration

▸ (`force?`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `force?` | `boolean` |

##### Returns

`void`

___

### update

• **update**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### visible

• **visible**: `boolean`
