---
id: "protocol.IMessage"
title: "Interface: IMessage"
sidebar_label: "IMessage"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).IMessage

Properties of a Message.

## Implemented by

- [`Message`](../classes/protocol.Message.md)

## Properties

### chat

• `Optional` **chat**: [`IChatMessage`](protocol.IChatMessage.md)

Message chat

___

### chunks

• `Optional` **chunks**: [`IChunk`](protocol.IChunk.md)[]

Message chunks

___

### entities

• `Optional` **entities**: [`IEntity`](protocol.IEntity.md)[]

Message entities

___

### events

• `Optional` **events**: [`IEvent`](protocol.IEvent.md)[]

Message events

___

### json

• `Optional` **json**: `string`

Message json

___

### method

• `Optional` **method**: [`IMethod`](protocol.IMethod.md)

Message method

___

### peers

• `Optional` **peers**: [`IPeer`](protocol.IPeer.md)[]

Message peers

___

### text

• `Optional` **text**: `string`

Message text

___

### type

• `Optional` **type**: [`Type`](../enums/protocol.Message-1.Type.md)

Message type

___

### updates

• `Optional` **updates**: [`IUpdate`](protocol.IUpdate.md)[]

Message updates

___

### worldName

• `Optional` **worldName**: `string`

Message worldName
