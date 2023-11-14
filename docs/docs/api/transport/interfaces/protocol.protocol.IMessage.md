---
id: "protocol.protocol.IMessage"
title: "Interface: IMessage"
sidebar_label: "IMessage"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).[protocol](../namespaces/protocol.protocol.md).IMessage

Properties of a Message.

## Implemented by

- [`Message`](../classes/protocol.protocol.Message.md)

## Properties

### chat

• `Optional` **chat**: [`IChatMessage`](protocol.protocol.IChatMessage.md)

Message chat

___

### chunks

• `Optional` **chunks**: [`IChunk`](protocol.protocol.IChunk.md)[]

Message chunks

___

### entities

• `Optional` **entities**: [`IEntity`](protocol.protocol.IEntity.md)[]

Message entities

___

### events

• `Optional` **events**: [`IEvent`](protocol.protocol.IEvent.md)[]

Message events

___

### json

• `Optional` **json**: `string`

Message json

___

### method

• `Optional` **method**: [`IMethod`](protocol.protocol.IMethod.md)

Message method

___

### peers

• `Optional` **peers**: [`IPeer`](protocol.protocol.IPeer.md)[]

Message peers

___

### text

• `Optional` **text**: `string`

Message text

___

### type

• `Optional` **type**: [`Type`](../enums/protocol.protocol.Message-1.Type.md)

Message type

___

### updates

• `Optional` **updates**: [`IUpdate`](protocol.protocol.IUpdate.md)[]

Message updates
