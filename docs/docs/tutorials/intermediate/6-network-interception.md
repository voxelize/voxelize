---
sidebar_position: 6
---

# Network Interception

Network interceptors allow you to hook into the message flow between client and server. Any object with an `onMessage` method can be registered as an interceptor.

## The NetIntercept Interface

Interceptors implement the `NetIntercept` interface:

```ts title="NetIntercept Interface"
interface NetIntercept {
  onMessage?: (message: MessageProtocol) => void;
  packets?: any[];
}
```

- `onMessage` - Called when any message is received from the server
- `packets` - Array of outgoing packets to send on the next flush

## Registering Interceptors

Register interceptors with the network:

```ts title="Registering Interceptors"
const network = new VOXELIZE.Network();

network.register(world);
network.register(peers);
network.register(entities);
network.register(myCustomInterceptor);
```

Built-in interceptors:

- `World` - Handles chunk loading, world updates, initialization
- `Peers` - Handles peer position and metadata updates
- `Entities` - Handles entity creation, updates, and deletion
- `Events` - Handles custom event messages
- `Method` - Handles method call responses

## Creating a Custom Interceptor

```ts title="Custom Interceptor"
import { MessageProtocol } from "@voxelize/protocol";

const chatLogger = {
  onMessage(message: MessageProtocol) {
    if (message.type === "CHAT" && message.chat) {
      console.log(`[${message.chat.sender}]: ${message.chat.body}`);
    }
  },
};

network.register(chatLogger);
```

## Message Types

Common message types you can intercept:

| Type     | Description                                          |
| -------- | ---------------------------------------------------- |
| `INIT`   | Initial world data (config, blocks, peers, entities) |
| `JOIN`   | Player joined the world                              |
| `LEAVE`  | Player left the world                                |
| `PEER`   | Peer position/metadata update                        |
| `ENTITY` | Entity create/update/delete                          |
| `LOAD`   | Chunk data received                                  |
| `UPDATE` | World stats update (time, etc.)                      |
| `CHAT`   | Chat message                                         |
| `EVENT`  | Custom event                                         |
| `METHOD` | Method call response                                 |

## Sending Packets

Interceptors can queue outgoing packets:

```ts title="Sending Packets"
const myInterceptor = {
  packets: [] as any[],

  sendChat(message: string) {
    this.packets.push({
      type: "CHAT",
      chat: {
        sender: "Player",
        body: message,
      },
    });
  },

  onMessage(message: MessageProtocol) {
    // Handle incoming messages
  },
};

network.register(myInterceptor);

// Later, send a chat message
myInterceptor.sendChat("Hello world!");
```

Packets are automatically flushed each frame by the network.

## Example: Entity Counter

Track entity counts by type:

```ts title="Entity Counter"
import { MessageProtocol } from "@voxelize/protocol";

class EntityCounter {
  counts: Map<string, number> = new Map();

  onMessage = (message: MessageProtocol) => {
    if (!message.entities) return;

    for (const entity of message.entities) {
      const current = this.counts.get(entity.type) || 0;

      switch (entity.operation) {
        case "CREATE":
          this.counts.set(entity.type, current + 1);
          break;
        case "DELETE":
          this.counts.set(entity.type, Math.max(0, current - 1));
          break;
      }
    }
  };

  getCount(type: string): number {
    return this.counts.get(type) || 0;
  }
}

const counter = new EntityCounter();
network.register(counter);
```

## Example: Latency Monitor

Measure round-trip time:

```ts title="Latency Monitor"
class LatencyMonitor {
  packets: any[] = [];
  private pingTime = 0;
  latency = 0;

  ping() {
    this.pingTime = performance.now();
    this.packets.push({
      type: "METHOD",
      method: { name: "ping", payload: "{}" },
    });
  }

  onMessage = (message: MessageProtocol) => {
    if (message.type === "METHOD" && message.method?.name === "pong") {
      this.latency = performance.now() - this.pingTime;
    }
  };
}
```

## Order of Execution

When a message arrives:

1. `network.sync()` is called (automatically each frame)
2. Message is decoded from the WebSocket
3. Each registered interceptor's `onMessage` is called in registration order
4. Interceptors process the message

When sending:

1. Interceptors add packets to their `packets` array
2. `network.flush()` is called (automatically each frame)
3. All packets from all interceptors are collected and sent
4. `packets` arrays are cleared

Read on to learn about [collision detection](./collision-detection).



