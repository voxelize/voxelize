---
id: "Registry"
title: "Class: Registry"
sidebar_label: "Registry"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### blocksById

• **blocksById**: `Map`<`number`, [`Block`](../#block)\>

___

### blocksByName

• **blocksByName**: `Map`<`string`, [`Block`](../#block)\>

___

### idMap

• **idMap**: `Map`<`number`, `string`\>

___

### nameMap

• **nameMap**: `Map`<`string`, `number`\>

## Methods

### deserialize

▸ **deserialize**(`data`): [`Registry`](Registry.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | [`SerializedRegistry`](../#serializedregistry) |

#### Returns

[`Registry`](Registry.md)

___

### parseSerialized

▸ **parseSerialized**(`data`): [`ParsedRegistry`](../#parsedregistry)

Decodes what [Registry.serialize](Registry.md#serialize) produced into plain block
entries, keyed both ways with shared block objects. Workers that keep
their own block tables (the wasm mesher) read this directly;
[Registry.deserialize](Registry.md#deserialize) wraps it into a `Registry`.

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | [`SerializedRegistry`](../#serializedregistry) |

#### Returns

[`ParsedRegistry`](../#parsedregistry)

___

### serialize

▸ **serialize**(): `string`

#### Returns

`string`
