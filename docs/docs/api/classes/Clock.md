---
id: "Clock"
title: "Class: Clock"
sidebar_label: "Clock"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** central control for the game clock, including handling intervals
and calculating the delta time of each front-end game loop.

# Example
Getting the delta time elapsed in seconds:
```ts
console.log(client.clock.delta);
```

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`ClockParams`](../modules.md#clockparams-4)

Parameters to initialize the clock.

___

### delta

• **delta**: `number`

Delta time elapsed each update

**`memberof`** Clock
