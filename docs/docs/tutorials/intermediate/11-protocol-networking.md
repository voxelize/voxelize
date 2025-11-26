---
sidebar_position: 11
---

# Protocol Networking

Voxelize uses Protocol Buffers for efficient binary serialization of network messages. Understanding the protocol helps when building custom features.

## Message Structure

All messages follow the `MessageProtocol` structure:

```ts title="Message Protocol"
interface MessageProtocol {
  type: MessageType;
  json?: string;
  text?: string;
  chat?: ChatMessage;
  peers?: Peer[];
  entities?: Entity[];
  chunks?: Chunk[];
  updates?: Update[];
  events?: Event[];
  method?: Method;
}
```

## Message Types

| Type        | Direction       | Purpose                          |
| ----------- | --------------- | -------------------------------- |
| `INIT`      | Server → Client | Initial world state              |
| `JOIN`      | Server → Client | Player joined notification       |
| `LEAVE`     | Server → Client | Player left notification         |
| `PEER`      | Bidirectional   | Player position/metadata updates |
| `ENTITY`    | Server → Client | Entity create/update/delete      |
| `LOAD`      | Bidirectional   | Chunk requests and data          |
| `UNLOAD`    | Client → Server | Chunk unload notification        |
| `UPDATE`    | Server → Client | World stats (time, etc.)         |
| `CHAT`      | Bidirectional   | Chat messages                    |
| `EVENT`     | Bidirectional   | Custom events                    |
| `METHOD`    | Bidirectional   | RPC calls                        |
| `TRANSPORT` | Bidirectional   | Custom binary data               |

## Entity Protocol

Entity messages contain:

```ts title="Entity Protocol"
interface EntityProtocol {
  id: string;
  type: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  metadata?: string; // JSON string
}
```

Operations:

- `CREATE` - New entity spawned
- `UPDATE` - Entity state changed
- `DELETE` - Entity removed

## Peer Protocol

Peer messages contain:

```ts title="Peer Protocol"
interface PeerProtocol {
  id: string;
  username: string;
  metadata: string; // JSON with position, direction, etc.
}
```

## Chunk Protocol

Chunk data is compressed:

```ts title="Chunk Protocol"
interface ChunkProtocol {
  x: number;
  z: number;
  id: string;
  meshes: MeshProtocol[];
  voxels: Uint8Array; // Compressed voxel data
  lights: Uint8Array; // Compressed light data
}
```

## Custom Transport

For custom binary data, use the transport system:

### Client Side

```ts title="Client Transport"
network.send({
  type: "TRANSPORT",
  json: JSON.stringify({
    action: "custom-action",
    data: { x: 10, y: 20 },
  }),
});
```

### Server Side

```rust title="Server Transport Handler"
world.set_transport_handle(|world, value| {
    let action = value.get("action").and_then(|v| v.as_str());

    match action {
        Some("custom-action") => {
            let data = value.get("data").unwrap();
            // Process custom data
        }
        _ => {}
    }
});
```

## Network Flow

### Connection Sequence

1. Client connects via WebSocket
2. Client sends `JOIN` with world name
3. Server sends `INIT` with world config, blocks, existing peers/entities
4. Client processes `INIT` and starts requesting chunks

### Frame Loop

Each frame:

1. **Client receives**: Server messages queued
2. **network.sync()**: Messages dispatched to interceptors
3. **Game logic**: Updates based on received data
4. **Interceptors queue packets**: Add to `packets` arrays
5. **network.flush()**: All queued packets sent to server

### Server Tick

Each server tick:

1. Process incoming messages
2. Run ECS systems
3. Collect changed entities/peers
4. Send updates to interested clients

## Debugging Network

### Client Logging

```ts title="Network Debugging"
const debugInterceptor = {
  onMessage(message: MessageProtocol) {
    console.log("Received:", message.type, message);
  },
};

network.register(debugInterceptor);
```

### Message Inspection

```ts title="Message Inspection"
network.on("message", (raw: ArrayBuffer) => {
  console.log("Raw message size:", raw.byteLength);
});
```

## Performance Considerations

### Chunk Loading

Chunks are loaded based on:

- Player position and direction (frustum culling)
- Render radius configuration
- Server `max_chunks_per_tick` setting

### Entity Updates

Entities only send updates when metadata changes:

```rust title="Efficient Updates"
// Only changed fields are sent
metadata.set("health", &new_health);  // Sends if health changed
```

### Peer Updates

Peer positions are sent every frame, but interpolated on the client:

```ts title="Peer Interpolation"
onPeerUpdate(peer, metadata) {
  // Don't set position directly, interpolate
  peer.targetPosition.set(...metadata.position);
}

update() {
  peer.position.lerp(peer.targetPosition, 0.1);
}
```

Read on to learn about [custom blocks](./custom-blocks).
