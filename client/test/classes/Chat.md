[@voxelize/client](../README.md) / [Exports](../modules.md) / Chat

# Class: Chat

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Table of contents

### Constructors

- [constructor](Chat.md#constructor)

### Properties

- [commandSymbol](Chat.md#commandsymbol)
- [commands](Chat.md#commands)
- [onChat](Chat.md#onchat)
- [packets](Chat.md#packets)

### Methods

- [addCommand](Chat.md#addcommand)
- [onMessage](Chat.md#onmessage)
- [removeCommand](Chat.md#removecommand)
- [send](Chat.md#send)

## Constructors

### constructor

• **new Chat**(`commandSymbol?`)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `commandSymbol` | `string` | `"/"` |

#### Defined in

[client/src/core/chat.ts:15](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/chat.ts#L15)

## Properties

### commandSymbol

• **commandSymbol**: `string` = `"/"`

___

### commands

• `Private` **commands**: `Map`<`string`, [`CommandProcessor`](../modules.md#commandprocessor)\>

#### Defined in

[client/src/core/chat.ts:11](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/chat.ts#L11)

___

### onChat

• **onChat**: (`chat`: `ChatProtocol`) => `void`

#### Type declaration

▸ (`chat`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `chat` | `ChatProtocol` |

##### Returns

`void`

#### Defined in

[client/src/core/chat.ts:40](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/chat.ts#L40)

___

### packets

• **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[] = `[]`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets)

#### Defined in

[client/src/core/chat.ts:13](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/chat.ts#L13)

## Methods

### addCommand

▸ **addCommand**(`trigger`, `process`, `aliases?`): `void`

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `trigger` | `string` | `undefined` |  |
| `process` | [`CommandProcessor`](../modules.md#commandprocessor) | `undefined` |  |
| `aliases` | `string`[] | `[]` | - |

#### Returns

`void`

#### Defined in

[client/src/core/chat.ts:48](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/chat.ts#L48)

___

### onMessage

▸ **onMessage**(`message`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage)

#### Defined in

[client/src/core/chat.ts:84](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/chat.ts#L84)

___

### removeCommand

▸ **removeCommand**(`trigger`): `boolean`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `trigger` | `string` |  |

#### Returns

`boolean`

#### Defined in

[client/src/core/chat.ts:80](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/chat.ts#L80)

___

### send

▸ **send**(`chat`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `chat` | `ChatProtocol` |

#### Returns

`void`

#### Defined in

[client/src/core/chat.ts:17](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/chat.ts#L17)
