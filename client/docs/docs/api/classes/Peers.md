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

Override [Peers.packInfo](Peers.md#packinfo-480) to customize the information that is sent to other peers.

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

![Example](/img/peers.png)

## Type parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `C` | extends `Object3D` = `Object3D` | The type of the character. Defaults to `Object3D`. |
| `T` | { `direction`: `number`[] ; `position`: `number`[]  } | The type of peer metadata. Defaults to `{ direction: number[], position: number[] }`. |

## Hierarchy

- `Group`

  ↳ **`Peers`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Constructors

### constructor

• **new Peers**<`C`, `T`\>(`object?`, `params?`)

Create a peers manager to add multiplayer functionality to your Voxelize game.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `C` | extends `Object3D`<`Event`, `C`\> = `Object3D`<`Event`\> |
| `T` | { `direction`: `number`[] ; `position`: `number`[]  } |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object?` | `Object3D`<`Event`\> | The object that is used to send client's own data back to the server. |
| `params` | `Partial`<[`PeersParams`](../modules.md#peersparams-374)\> | Parameters to customize the effect. |

#### Overrides

Group.constructor

## Properties

### createPeer

• **createPeer**: (`id`: `string`) => `C`

#### Type declaration

▸ (`id`): `C`

A function called when a new player joins the game. This function should be implemented
to create and return a new peer object.

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | The ID of the new peer. |

##### Returns

`C`

___

### object

• `Optional` **object**: `Object3D`<`Event`\>

___

### onPeerUpdate

• **onPeerUpdate**: (`object`: `C`, `data`: `T`) => `void`

#### Type declaration

▸ (`object`, `data`): `void`

A function called to update a peer object with new data. This function should be implemented to
customize the behavior of the peer object.

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `C` | The peer object. |
| `data` | `T` | The new data. |

##### Returns

`void`

___

### ownID

• **ownID**: `string` = `""`

The client's own peer ID. This is set when the client first connects to the server.

___

### ownUsername

• **ownUsername**: `string` = `""`

The client's own username. This is set when the client first connects to the server.

___

### packInfo

• **packInfo**: () => `void` \| `PeerProtocol`<`T`\>

#### Type declaration

▸ (): `void` \| `PeerProtocol`<`T`\>

Create a packet to send to the server. By default, this function sends the position and direction
as metadata to the server. Override this function to customize the information sent.

If customized and nothing is returned, no packets will be sent.

##### Returns

`void` \| `PeerProtocol`<`T`\>

A peer protocol message

___

### packets

• **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[] = `[]`

A list of packets that will be sent to the server.

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets-480)

___

### params

• **params**: [`PeersParams`](../modules.md#peersparams-374)

Parameters to customize the peers manager.

## Methods

### onPeerJoin

▸ **onPeerJoin**(`id`): `void`

A function called when a player joins the game. This function has a default implementation and
should not be overridden unless you know what you are doing. Internally, this calls [Peers.createPeer](Peers.md#createpeer-480)
to create a new peer object and adds it to the peers group itself.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | The new peer's ID. |

#### Returns

`void`

___

### onPeerLeave

▸ **onPeerLeave**(`id`): `void`

A function called when a player leaves the game. This function has a default implementation and
should not be overridden unless you know what you are doing. Internally, this removes the peer
object from the peers group itself.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | The ID of the peer that left the game. |

#### Returns

`void`

___

### update

▸ **update**(): `void`

Update the peers manager. Internally, this attempts to call any children that has a `update` method.
You can turn this behavior off by setting `params.updateChildren` to `false`.

This function should be called in the render loop.

#### Returns

`void`
