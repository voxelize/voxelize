---
id: "Inputs"
title: "Class: Inputs<T>"
sidebar_label: "Inputs"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** key-bind manager for Voxelize. Uses the [mousetrap](https://github.com/ccampbell/mousetrap)
library internally.

## Example
Print "Hello world" on <kbd>p</kbd> presses:
```typescript
client.inputs.bind(
  "p",
  () => {
    console.log("Hello world");
  },
  "*"
);
```

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

## Hierarchy

- `EventEmitter`

  ↳ **`Inputs`**

## Methods

### addListener

▸ **addListener**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

___

### bind

▸ **bind**(`key`, `callback`, `namespace`, `specifics?`): () => `void`

Register a key-bind event listener.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to listen on. |
| `callback` | () => `void` | What to do when the key/combo is pressed. |
| `namespace` | `T` \| ``"*"`` | The namespace in which the to fire this event. |
| `specifics` | `Object` | Used to specify in more details when/where the press occurs. |
| `specifics.identifier?` | `string` | Whether or not should this be a special key event. Defaults to "". |
| `specifics.occasion?` | [`InputOccasion`](../modules.md#inputoccasion-14) | Which pressing occasion should the event be fired. Defaults to "keydown". |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### click

▸ **click**(`type`, `callback`, `namespace`): () => `boolean`

Register a new click event listener.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | [`ClickType`](../modules.md#clicktype-14) | Which mouse button to register on. |
| `callback` | () => `void` | What to do when that button is clicked. |
| `namespace` | `T` \| ``"*"`` | Which namespace should this event be fired? |

#### Returns

`fn`

▸ (): `boolean`

##### Returns

`boolean`

___

### emit

▸ **emit**(`type`, ...`args`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `...args` | `any`[] |

#### Returns

`boolean`

___

### eventNames

▸ **eventNames**(): (`string` \| `number`)[]

#### Returns

(`string` \| `number`)[]

___

### getMaxListeners

▸ **getMaxListeners**(): `number`

#### Returns

`number`

___

### listenerCount

▸ `Static` **listenerCount**(`emitter`, `type`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `emitter` | `EventEmitter` |
| `type` | `string` \| `number` |

#### Returns

`number`

___

### listenerCount

▸ **listenerCount**(`type`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`number`

___

### listeners

▸ **listeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

___

### off

▸ **off**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

___

### on

▸ **on**(`event`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | ``"namespace"`` |
| `listener` | (`namespace`: `string`) => `void` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

___

### once

▸ **once**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

___

### prependListener

▸ **prependListener**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

___

### prependOnceListener

▸ **prependOnceListener**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

___

### rawListeners

▸ **rawListeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

___

### remap

▸ **remap**(`key`, `newName`, `specifics?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `newName` | `string` |
| `specifics` | `Object` |
| `specifics.identifier?` | `string` |
| `specifics.occasion?` | [`InputOccasion`](../modules.md#inputoccasion-14) |

#### Returns

`void`

___

### removeAllListeners

▸ **removeAllListeners**(`type?`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type?` | `string` \| `number` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

___

### removeListener

▸ **removeListener**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

___

### reset

▸ **reset**(): `void`

Reset and dispose all event listeners.

**`internal`**

#### Returns

`void`

___

### scroll

▸ **scroll**(`up`, `down`, `namespace`): () => `boolean`

Register a new scroll event listener.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `up` | (`delta?`: `number`) => `void` | What to do when scrolled upwards. |
| `down` | (`delta?`: `number`) => `void` | What to do when scrolled downwards. |
| `namespace` | `T` \| ``"*"`` | Which namespace should this even be fired? |

#### Returns

`fn`

▸ (): `boolean`

##### Returns

`boolean`

___

### setMaxListeners

▸ **setMaxListeners**(`n`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `n` | `number` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

___

### setNamespace

▸ **setNamespace**(`namespace`): `void`

Set the namespace of the inputs instance, also checks if the namespace is valid.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `T` | The namespace to set to. |

#### Returns

`void`

___

### swap

▸ **swap**(`keyA`, `keyB`, `specifics?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `keyA` | `string` |
| `keyB` | `string` |
| `specifics` | `Object` |
| `specifics.identifier?` | `string` |
| `specifics.occasion?` | [`InputOccasion`](../modules.md#inputoccasion-14) |

#### Returns

`void`

___

### unbind

▸ **unbind**(`key`, `specifics?`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `specifics` | `Object` |
| `specifics.identifier?` | `string` |
| `specifics.occasion?` | [`InputOccasion`](../modules.md#inputoccasion-14) |

#### Returns

`boolean`

## Properties

### defaultMaxListeners

▪ `Static` **defaultMaxListeners**: `number`

___

### namespace

• **namespace**: `T` \| ``"*"``

The namespace that the Voxelize inputs is in. Use `setNamespace` to
set the namespace for namespace checking.
