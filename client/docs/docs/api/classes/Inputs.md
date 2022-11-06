---
id: "Inputs"
title: "Class: Inputs<T>"
sidebar_label: "Inputs"
sidebar_position: 0
custom_edit_url: null
---

A key and mouse binding manager for Voxelize.

Inputs allow you to bind keys and mouse buttons to functions
and also gives an organized way to manage keyboard and mouse inputs using namespaces. Namespaces are used to
separate groups of inputs. For example, you can have a namespace for the main menu
and another namespace for the game. You can then bind keys and mouse buttons to functions for each namespace.

Another use of inputs is to bind keys and mouse buttons for some built-in functionality. As of now, the following
requires inputs to be bound:
- [RigidControls.connect](/docs/api/classes/RigidControls#connect): <kbd>WASD</kbd> and <kbd>Space</kbd> for movement, <kbd>Shift</kbd> for going down and <kbd>R</kbd> for sprinting.
- [Perspective.connect](/docs/api/classes/Perspective#connect): <kbd>C</kbd> for switching between perspectives.

You can change the above bindings by calling [Inputs.remap](Inputs.md#remap-156) with the corresponding input identifiers, namely
`RigidControls.INPUT_IDENTIFIER` and `Perspectives.INPUT_IDENTIFIER`.

## Example
```typescript
// Create a new inputs manager.
const inputs = new VOXELIZE.Inputs();

// Bind the space bar to a function.
inputs.bind(" ", () => {
  console.log("Space bar pressed!");
});

// Bind rigid controls to the inputs manager.
rigidControls.connect(inputs);
```

## Type parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `T` | extends `string` = `any` | The list of input namespaces. For instance, `T` could be "menu" and "game". |

## Hierarchy

- `EventEmitter`

  ↳ **`Inputs`**

## Methods

### bind

▸ **bind**(`key`, `callback`, `namespace?`, `specifics?`): () => `void`

Bind a keyboard key to a callback.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `key` | `string` | `undefined` | The key to listen for. This checks the `event.key` or the `event.code` property. |
| `callback` | () => `void` | `undefined` | The callback to call when the key is pressed. |
| `namespace` | `T` \| ``"*"`` | `"*"` | The namespace to bind the key to. Defaults to "*", which means that the key will be fired regardless of the namespace. |
| `specifics` | [`InputSpecifics`](../modules.md#inputspecifics-156) | `{}` | The specific parameters of the key to listen for. |

#### Returns

`fn`

A function to unbind the key.

▸ (): `void`

##### Returns

`void`

___

### click

▸ **click**(`type`, `callback`, `namespace?`): () => `boolean`

Add a mouse click event listener.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `type` | [`ClickType`](../modules.md#clicktype-156) | `undefined` | The type of click to listen for. Either "left", "middle" or "right". |
| `callback` | () => `void` | `undefined` | The callback to call when the click is fired. |
| `namespace` | `T` \| ``"*"`` | `"*"` | The namespace to bind the click to. Defaults to "*", which means that the click will be fired regardless of the namespace. |

#### Returns

`fn`

A function to unbind the click.

▸ (): `boolean`

##### Returns

`boolean`

___

### on

▸ **on**(`event`, `listener`): [`Inputs`](Inputs.md)<`T`\>

Listen to an event emitted by the input instance. The following events are emitted:
- `namespace`: Emitted when the namespace is changed.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | ``"namespace"`` | An event to listen on. |
| `listener` | (`namespace`: `string`) => `void` | A listener to call when the event is emitted. |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

The input instance for chaining.

#### Overrides

EventEmitter.on

___

### remap

▸ **remap**(`oldKey`, `newKey`, `specifics?`): `void`

Remap a key to another key.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `oldKey` | `string` | The old key to replace. |
| `newKey` | `string` | The new key to replace the old key with. |
| `specifics` | `Object` | The specifics of the keys to replace. |
| `specifics.identifier?` | `string` | - |
| `specifics.occasion?` | [`InputOccasion`](../modules.md#inputoccasion-156) | - |

#### Returns

`void`

___

### reset

▸ **reset**(): `void`

Reset all keyboard keys by unbinding all keys.

#### Returns

`void`

___

### scroll

▸ **scroll**(`up`, `down`, `namespace?`): () => `boolean`

Add a scroll event listener.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `up` | (`delta?`: `number`) => `void` | `undefined` | The callback to call when the scroll wheel is scrolled up. |
| `down` | (`delta?`: `number`) => `void` | `undefined` | The callback to call when the scroll wheel is scrolled down. |
| `namespace` | `T` \| ``"*"`` | `"*"` | The namespace to bind the scroll to. Defaults to "*", which means that the scroll will be fired regardless of the namespace. |

#### Returns

`fn`

A function to unbind the scroll.

▸ (): `boolean`

##### Returns

`boolean`

___

### setNamespace

▸ **setNamespace**(`namespace`): `void`

Set the namespace of the input instance. This emits a "namespace" event.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `T` | The new namespace to set. |

#### Returns

`void`

___

### swap

▸ **swap**(`keyA`, `keyB`, `specifics?`): `void`

Swap two keys with each other.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `keyA` | `string` | The first key to swap. |
| `keyB` | `string` | The second key to swap. |
| `specifics` | `Object` | The specifics of the keys to swap. |
| `specifics.identifier?` | `string` | - |
| `specifics.occasion?` | [`InputOccasion`](../modules.md#inputoccasion-156) | - |

#### Returns

`void`

___

### unbind

▸ **unbind**(`key`, `specifics?`): `boolean`

Unbind a keyboard key.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to unbind. |
| `specifics` | [`InputSpecifics`](../modules.md#inputspecifics-156) | The specifics of the key to unbind. |

#### Returns

`boolean`

Whether or not if the unbinding was successful.

## Constructors

### constructor

• **new Inputs**<`T`\>()

Construct a Voxelize inputs instance.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` = `any` |

#### Overrides

EventEmitter.constructor

## Properties

### namespace

• **namespace**: `T` \| ``"*"``

The namespace that the Voxelize inputs is in. Use `setNamespace` to
set the namespace to something else.
