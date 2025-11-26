---
sidebar_position: 2
---

# Custom Peers

Peers represent other players in the world. You can customize peer rendering by extending the `Peers` class and using mixins.

## The Peer Class

The default peer uses `VOXELIZE.Character`:

```ts title="Basic Peer"
import * as VOXELIZE from "@voxelize/core";

class Peer extends VOXELIZE.Character {
  constructor() {
    super({
      nameTagOptions: {
        fontFace: "monospace",
        yOffset: 0.2,
      },
    });
  }
}
```

## The Peers Manager

Extend `VOXELIZE.Peers` to customize peer creation and updates:

```ts title="Custom Peers Manager"
import * as VOXELIZE from "@voxelize/core";

type PeersMeta = {
  position: VOXELIZE.Coords3;
  direction: number[];
  role?: string;
  holdingObjectId?: number;
};

class Peers extends VOXELIZE.Peers<Peer, PeersMeta> {
  createPeer = (id: string): Peer => {
    const peer = new Peer();
    peer.userData.id = id;
    return peer;
  };

  onPeerUpdate = (
    peer: Peer,
    metadata: PeersMeta,
    info: { username: string }
  ) => {
    peer.set(metadata.position, metadata.direction);
    peer.username = info.username;
  };
}
```

## Mixins for Extra Features

### Holding Objects

Add the ability for peers to hold items:

```ts title="Holding Mixin"
export const HoldingMixin = <
  T extends new (...args: any[]) => VOXELIZE.Character
>(
  Base: T
) => {
  return class extends Base {
    public holdingObjectId = 0;

    setHoldingObjectId = (id: number, world?: VOXELIZE.World) => {
      if (id === this.holdingObjectId) return;

      if (id === 0) {
        this.setArmHoldingObject(undefined);
      } else {
        const mesh = world?.makeBlockMesh(id, { material: "basic" });
        this.setArmHoldingObject(mesh);
      }

      this.holdingObjectId = id;
    };
  };
};

class Peer extends HoldingMixin(VOXELIZE.Character) {}
```

### Hit Effects

Add visual feedback when a peer is hit:

```ts title="Hittable Mixin"
export const HittableMixin = <
  T extends new (...args: any[]) => VOXELIZE.Character
>(
  Base: T
) => {
  return class extends Base {
    private hitTimeout: number | null = null;

    hit = () => {
      this.head.children.forEach((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshBasicMaterial).color.setHex(0xff0000);
        }
      });

      if (this.hitTimeout) clearTimeout(this.hitTimeout);

      this.hitTimeout = window.setTimeout(() => {
        this.head.children.forEach((child) => {
          if (child instanceof THREE.Mesh) {
            (child.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
          }
        });
      }, 300);
    };
  };
};
```

### Combined Mixins

```ts title="Combined Peer"
class Peer extends HittableMixin(HoldingMixin(VOXELIZE.Character)) {
  public role = "player";
}
```

## Peer Groups

Organize peers into groups:

```ts title="Peer Groups"
class Peers extends VOXELIZE.Peers<Peer, PeersMeta> {
  public players = new THREE.Group();
  public spectators = new THREE.Group();

  createPeer = (id: string): Peer => {
    const peer = new Peer();
    this.players.add(peer);
    return peer;
  };

  onPeerUpdate = (peer: Peer, metadata: PeersMeta) => {
    if (metadata.isSpectator) {
      this.players.remove(peer);
      this.spectators.add(peer);
      peer.visible = false;
    } else {
      this.spectators.remove(peer);
      this.players.add(peer);
      peer.visible = true;
    }
  };
}
```

## Server-Side Peer Data

### Client Parser

Parse incoming peer data on the server:

```rust title="Client Parser"
world.set_client_parser(|world, metadata_str, client_ent| {
    #[derive(Deserialize)]
    struct PeerUpdate {
        position: Option<Vec3<f32>>,
        direction: Option<Vec3<f32>>,
    }

    let metadata: PeerUpdate = serde_json::from_str(metadata_str).unwrap();

    if let Some(pos) = metadata.position {
        let mut positions = world.write_component::<PositionComp>();
        if let Some(p) = positions.get_mut(client_ent) {
            p.0.set(pos.0, pos.1, pos.2);
        }
    }
});
```

### Client Modifier

Add components to new clients:

```rust title="Client Modifier"
world.set_client_modifier(|world, entity| {
    world.add(entity, RoleComp::new("player"));
    world.add(entity, InventoryComp::new(36));
});
```

## Sending Custom Peer Data

### Client Side

```ts title="Client Peer Data"
class Peers extends VOXELIZE.Peers<Peer, PeersMeta> {
  packInfo = () => {
    return {
      id: this.ownID,
      username: this.ownUsername,
      metadata: {
        position: this.getPosition(),
        direction: this.getDirection(),
        role: this.ownPeer?.role,
        holdingObjectId: this.ownPeer?.holdingObjectId,
      },
    };
  };
}
```

### Server Side

Custom metadata is synced via `PeersMetaSystem` or custom systems.

## Role-Based Styling

```ts title="Role Colors"
const roleColors: Record<string, number> = {
  admin: 0xff0000,
  mod: 0x00ff00,
  player: 0xffffff,
};

onPeerUpdate = (peer: Peer, metadata: PeersMeta) => {
  const color = roleColors[metadata.role || "player"];
  peer.head.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      (child.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
  });
};
```
