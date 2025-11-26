---
id: "Peers"
title: "Class: Peers<C, T>"
sidebar_label: "Peers"
sidebar_position: 0
custom_edit_url: null
---

A class that allows you to add multiplayer functionality to your Voxelize game. This implements
a [NetIntercept](../interfaces/NetIntercept.md) that intercepts all peer-related messages and allows you to customize
the behavior of multiplayer functionality. This class also extends a `THREE.Group` that allows
you to dynamically turn on/off multiplayer visibility.

Override [Peers.packInfo](Peers.md#packinfo) to customize the information that is sent to other peers.

TODO-DOC

# Example
```ts
// Create a peers manager.
const peers = new VOXELIZE.Peers<VOXELIZE.Character>();

// Add the peers group to the world.
world.add(peers);

// Define what a new peer looks like.
peers.createPeer = (id) => {
  const character = new VOXELIZE.Character();
  character.username = id;
  return character;
};

// Define what happens when a peer data is received.
peers.onPeerUpdate = (peer, data) => {
  peer.set(data.position, data.direction);
};

// In the render loop, update the peers manager.
peers.update();
```

![Example](/img/docs/peers.png)

## Type parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `C` | extends `Object3D` = `Object3D` | The type of the character. Defaults to `Object3D`. |
| `T` | \{ `direction`: `number`[] ; `position`: `number`[]  } | The type of peer metadata. Defaults to `{ direction: number[], position: number[] }`. |

## Hierarchy

- `Group`

  ↳ **`Peers`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Constructors

### constructor

• **new Peers**\<`C`, `T`\>(`object?`, `options?`): [`Peers`](Peers.md)\<`C`, `T`\>

Create a peers manager to add multiplayer functionality to your Voxelize game.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `C` | extends `Object3D`\<`Object3DEventMap`\> = `Object3D`\<`Object3DEventMap`\> |
| `T` | \{ `direction`: `number`[] ; `position`: `number`[]  } |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object?` | `Object3D`\<`Object3DEventMap`\> | The object that is used to send client's own data back to the server. |
| `options` | `Partial`\<[`PeersOptions`](../modules.md#peersoptions)\> | Parameters to customize the effect. |

#### Returns

[`Peers`](Peers.md)\<`C`, `T`\>

#### Overrides

Group.constructor

## Properties

### createPeer

• **createPeer**: (`id`: `string`) => `C`

A function called when a new player joins the game. This function should be implemented
to create and return a new peer object.

#### Type declaration

▸ (`id`): `C`

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | The ID of the new peer. |

##### Returns

`C`

___

### map

• **map**: `Map`\<`string`, `C`\>

Maps the peer ID to the peer object.

___

### object

• `Optional` **object**: `Object3D`\<`Object3DEventMap`\>

The object that is used to send client's own data back to the server.

___

### onPeerJoin

• **onPeerJoin**: (`id`: `string`, `peer`: `C`) => `void`

A function called when a player joins the game. By default, the function calls the [Peers.createPeer](Peers.md#createpeer)
function to create a new peer object and adds it to the peers group. Customize this function to add additional
behavior.

#### Type declaration

▸ (`id`, `peer`): `void`

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | The new peer's ID. |
| `peer` | `C` | - |

##### Returns

`void`

___

### onPeerLeave

• **onPeerLeave**: (`id`: `string`, `peer`: `C`) => `void`

A function called when a player leaves the game. Internally, when a player leaves, its object is removed
from the peers group. Customize this function to add additional behavior.

#### Type declaration

▸ (`id`, `peer`): `void`

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | The ID of the peer that left the game. |
| `peer` | `C` | - |

##### Returns

`void`

___

### onPeerUpdate

• **onPeerUpdate**: (`object`: `C`, `data`: `T`, `info`: \{ `id`: `string` ; `username`: `string`  }) => `void`

A function called to update a peer object with new data. This function should be implemented to
customize the behavior of the peer object.

#### Type declaration

▸ (`object`, `data`, `info`): `void`

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `C` | The peer object. |
| `data` | `T` | The new data. |
| `info` | `Object` | The peer's information. |
| `info.id` | `string` | The peer's ID. |
| `info.username` | `string` | The peer's username. |

##### Returns

`void`

___

### options

• **options**: [`PeersOptions`](../modules.md#peersoptions)

Parameters to customize the peers manager.

___

### ownID

• **ownID**: `string` = `""`

The client's own peer ID. This is set when the client first connects to the server.

___

### ownMetadata

• `Optional` **ownMetadata**: `Record`\<`string`, `any`\>

The client's own metadata (device info, etc.). This is set when the client first connects to the server.

___

### ownPeer

• `Optional` **ownPeer**: `C`

___

### ownUsername

• **ownUsername**: `string` = `""`

The client's own username. This is set when the client first connects to the server.

## Methods

### getPeerById

▸ **getPeerById**(`id`): `C`

Get a peer instance by its ID using the `map`.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | The ID of the peer to get. |

#### Returns

`C`

The peer object with the given ID.

___

### packInfo

▸ **packInfo**(): `void` \| `PeerProtocol`\<`T`\>

Create a packet to send to the server. By default, this function sends the position and direction
as metadata to the server. Override this function to customize the information sent.

If customized and nothing is returned, no packets will be sent.

#### Returns

`void` \| `PeerProtocol`\<`T`\>

A peer protocol message

___

### setOwnPeer

▸ **setOwnPeer**(`peer`): `void`

Set the client's own peer instance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `peer` | `C` | The peer instance that is going to be the client themselves. |

#### Returns

`void`

___

### setOwnUsername

▸ **setOwnUsername**(`username`): `void`

Set the client's own username. This will be broadcasted to the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `username` | `string` | The username of the client. |

#### Returns

`void`

___

### update

▸ **update**(): `void`

Update the peers manager. Internally, this attempts to call any children that has a `update` method.
You can turn this behavior off by setting `options.updateChildren` to `false`.

This function should be called in the render loop.

#### Returns

`void`
