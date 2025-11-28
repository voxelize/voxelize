---
sidebar_position: 4
---

# Metadata Component

Metadata is how entity state gets synchronized from server to client. The `MetadataComp` stores a JSON-serializable map that gets sent to clients whenever it changes.

## How Metadata Works

1. Server systems update `MetadataComp` each tick
2. `EntitiesSendingSystem` detects changes
3. Changed metadata is sent to interested clients
4. Client receives data in entity lifecycle hooks

## Setting Metadata

Use `metadata.set()` to add typed data:

```rust title="Setting Metadata"
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
struct HealthData {
    current: i32,
    max: i32,
}

let mut metadata = MetadataComp::default();
metadata.set("health", &HealthData { current: 80, max: 100 });
metadata.set("position", &PositionComp::new(10.0, 64.0, 10.0));
metadata.set("name", &"Bob".to_string());
```

## Getting Metadata

Retrieve typed data with `metadata.get()`:

```rust title="Getting Metadata"
let health: Option<HealthData> = metadata.get("health");
let position: Option<PositionComp> = metadata.get("position");
let name: Option<String> = metadata.get("name");
```

## Built-in Metadata Systems

Voxelize includes systems that automatically sync common components:

### EntitiesMetaSystem

For non-client entities, syncs `PositionComp` to metadata:

```rust title="EntitiesMetaSystem Behavior"
// Automatically adds to all entities with EntityFlag:
metadata.set("position", &position_comp);
```

### PeersMetaSystem

For client entities, syncs position, direction, and name:

```rust title="PeersMetaSystem Behavior"
// Automatically adds to all entities with ClientFlag:
metadata.set("position", &position_comp);
metadata.set("direction", &direction_comp);
metadata.set("username", &name_comp);
```

## Custom Metadata Systems

Create systems to sync your custom components:

```rust title="Custom Metadata System"
use specs::{System, ReadStorage, WriteStorage, Join};

pub struct HealthMetaSystem;

impl<'a> System<'a> for HealthMetaSystem {
    type SystemData = (
        ReadStorage<'a, HealthComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, (healths, mut metadatas): Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        (&healths, &mut metadatas)
            .par_join()
            .for_each(|(health, metadata)| {
                metadata.set("health", health);
            });
    }
}
```

Add to the dispatcher before `EntitiesSendingSystem`:

```rust title="Adding to Dispatcher"
.with(HealthMetaSystem, "health-meta", &[])
.with(EntitiesSendingSystem, "entities-sending", &["entities-meta", "health-meta"])
```

## Client-Side Data Types

Define matching TypeScript types for your metadata:

```ts title="Client Data Types"
type BotData = {
  position: VOXELIZE.Coords3;
  direction: number[];
  health: {
    current: number;
    max: number;
  };
  name: string;
};

class Bot extends VOXELIZE.Entity<BotData> {
  onUpdate = (data: BotData) => {
    this.position.set(...data.position);
    this.updateHealthBar(data.health.current, data.health.max);
    this.setName(data.name);
  };
}
```

## Partial Updates

Only changed fields are sent. Metadata tracks what changed since last send:

```rust title="Efficient Updates"
// Only sends "health" field, not entire metadata
metadata.set("health", &new_health);

// Position sent separately by EntitiesMetaSystem
```

## Metadata in Entity Loaders

Access metadata passed during spawning:

```rust title="Metadata in Loaders"
world.set_entity_loader("npc", |world, metadata| {
    let name = metadata.get::<String>("name").unwrap_or("NPC".to_string());
    let health = metadata.get::<HealthComp>("health").unwrap_or(HealthComp(100));

    world
        .create_entity(&nanoid!(), "npc")
        .with(PositionComp::default())
        .with(health)
        .with(NameComp::new(&name))
        .with(metadata)
});
```

## Serialization Requirements

Components synced via metadata must implement `Serialize` and `Deserialize`:

```rust title="Serializable Component"
use serde::{Serialize, Deserialize};
use specs::{Component, VecStorage};

#[derive(Component, Default, Serialize, Deserialize, Clone)]
#[storage(VecStorage)]
pub struct StatsComp {
    pub kills: u32,
    pub deaths: u32,
    pub score: i32,
}
```

## Peer Metadata

For client metadata (peers), use the client parser:

```rust title="Client Parser"
world.set_client_parser(|world, metadata_str, client_ent| {
    let metadata: PeerUpdate = serde_json::from_str(metadata_str).unwrap();

    if let Some(position) = metadata.position {
        let mut positions = world.write_component::<PositionComp>();
        if let Some(p) = positions.get_mut(client_ent) {
            p.0.set(position.0, position.1, position.2);
        }
    }
});
```

The client sends metadata via the `Peers` manager:

```ts title="Client Peer Metadata"
peers.packInfo(); // Returns position, direction, and custom data
```

## Example: Complete Metadata Flow

Server component and system:

```rust title="Server Side"
#[derive(Component, Default, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct MoodComp(pub String);

pub struct MoodMetaSystem;

impl<'a> System<'a> for MoodMetaSystem {
    type SystemData = (
        ReadStorage<'a, MoodComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, (moods, mut metadatas): Self::SystemData) {
        for (mood, metadata) in (&moods, &mut metadatas).join() {
            metadata.set("mood", mood);
        }
    }
}
```

Client entity:

```ts title="Client Side"
type NPCData = {
  position: VOXELIZE.Coords3;
  mood: string;
};

class NPC extends VOXELIZE.Entity<NPCData> {
  private moodText: VOXELIZE.SpriteText;

  constructor(id: string) {
    super(id);
    this.moodText = new VOXELIZE.SpriteText("...");
    this.moodText.position.y = 2;
    this.add(this.moodText);
  }

  onUpdate = (data: NPCData) => {
    this.position.set(...data.position);
    this.moodText.text = data.mood;
  };
}
```

Read on to learn about [customizing the ECS dispatcher](./customizing-the-ecs).



