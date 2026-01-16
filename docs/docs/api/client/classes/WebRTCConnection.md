---
id: "WebRTCConnection"
title: "Class: WebRTCConnection"
sidebar_label: "WebRTCConnection"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new WebRTCConnection**(): [`WebRTCConnection`](WebRTCConnection.md)

#### Returns

[`WebRTCConnection`](WebRTCConnection.md)

## Properties

### onClose

• **onClose**: () => `void` = `null`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### onMessage

• **onMessage**: (`data`: `ArrayBuffer`) => `void` = `null`

#### Type declaration

▸ (`data`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `ArrayBuffer` |

##### Returns

`void`

___

### onOpen

• **onOpen**: () => `void` = `null`

#### Type declaration

▸ (): `void`

##### Returns

`void`

## Accessors

### isConnected

• `get` **isConnected**(): `boolean`

#### Returns

`boolean`

## Methods

### close

▸ **close**(): `void`

#### Returns

`void`

___

### connect

▸ **connect**(`serverUrl`, `clientId`): `Promise`\<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `serverUrl` | `string` |
| `clientId` | `string` |

#### Returns

`Promise`\<`void`\>
