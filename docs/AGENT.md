# Documentation Agent Guidelines

This file contains guidelines for AI agents working on Voxelize documentation updates.

## Documentation Structure

The docs live in `voxelize/docs/` and use Docusaurus 3.x with these sections:

- **`docs/tutorials/`** - Step-by-step guides for getting started
- **`docs/wiki/`** - In-depth explanations of concepts and patterns
- **`docs/api/`** - Auto-generated from TypeDoc (do not edit directly)

API docs are auto-generated from `@voxelize/core` and `@voxelize/protocol` packages via `docusaurus-plugin-typedoc`. The source code lives in `voxelize/packages/core/src/` and `voxelize/packages/protocol/src/`.

### Sidebar Configuration

- `sidebars/tutorials.js` - Tutorial sidebar
- `sidebars/wiki.js` - Wiki sidebar
- `sidebars/api.js` - API sidebar (auto-generated)

## Writing Style

Keep it direct and practical:

- Lead with what something does in one sentence
- Show code immediately after the explanation
- Use `title="Description"` on code blocks to label them
- Keep explanations brief - let the code speak
- Use contrasts to clarify (e.g., "Unlike events, methods run world-wide")
- End sections with natural transitions like "Read on to learn about..."

### Code Block Format

Always use language + title:

```ts title="Client Setup"
const world = new VOXELIZE.World();
```

```rust title="Server Definition"
world.set_method_handle("my_method", |world, client_id, payload| {
  // ...
});
```

### Import Conventions

Client-side TypeScript always uses:

```ts
import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";
```

Server-side Rust uses standard Voxelize crate imports.

## Finding Examples

When documenting a class or feature:

1. **Check the town project first** - Real-world usage in `client/src/core/` and `client/src/components/`
2. **Check the packages source** - Implementation details in `voxelize/packages/core/src/`
3. **Check existing wiki pages** - Patterns and conventions in `voxelize/docs/docs/wiki/`

### Key Source Locations

| Feature    | Town Usage                      | Source Code                             |
| ---------- | ------------------------------- | --------------------------------------- |
| Characters | `client/src/core/peers.ts`      | `packages/core/src/libs/character.ts`   |
| Entities   | `client/src/core/entities/*.ts` | `packages/core/src/libs/entities.ts`    |
| Peers      | `client/src/core/peers.ts`      | `packages/core/src/libs/peers.ts`       |
| World      | N/A                             | `packages/core/src/core/world/index.ts` |
| Blocks     | `client/src/core/blocks.ts`     | `packages/core/src/core/world/`         |
| Events     | Used in components              | `packages/core/src/libs/events.ts`      |
| Methods    | Used in components              | `packages/core/src/libs/method.ts`      |

## Updating Documentation

### For API Classes (Arrow, Character, etc.)

The API reference is auto-generated but often lacks good examples. To improve:

1. Read the source in `packages/core/src/`
2. Find real usage in `client/src/core/` or `client/src/components/`
3. Add a practical example to the class's JSDoc in the source file
4. The TypeDoc plugin will include it in the generated docs

Example of good JSDoc in source:

````ts
/**
 * A helper for visualizing a direction.
 *
 * @example
 * ```ts
 * const arrow = new VOXELIZE.Arrow();
 * arrow.position.set(10, 0, 10);
 * arrow.setDirection(new THREE.Vector3(1, 0, 0));
 * world.add(arrow);
 * ```
 */
````

### For Wiki Pages

1. Start with a one-sentence description of what the feature does
2. Explain how it differs from related features (if applicable)
3. Show server-side code first (if fullstack)
4. Show client-side code second
5. Keep it under 100 lines unless the topic is complex

Template:

```md
# Feature Name

One sentence explaining what this feature does and when to use it.

[Optional: how it differs from similar features]

## Server Setup

\`\`\`rust title="Server Definition"
// code
\`\`\`

## Client Usage

\`\`\`ts title="Client Implementation"
// code
\`\`\`

[Optional: additional sections for advanced usage]
```

### For Tutorial Pages

Tutorials are more detailed and guide users step-by-step:

1. Use frontmatter with `sidebar_position`
2. Start with "What you'll learn" or "What you'll need"
3. Break into clear steps
4. Include screenshots in `static/img/docs/` when helpful
5. End with a transition to the next tutorial

## Common Patterns from Town Project

### Custom Peer with Extended Functionality

```ts title="Extended Peer Class"
import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";

export class Peer extends VOXELIZE.Character {
  constructor(id?: string) {
    super({
      nameTagOptions: {
        fontFace: "ConnectionSerif-d20X",
        yOffset: 0.5,
      },
    });
    this.userData.id = id;
  }
}

export class Peers extends VOXELIZE.Peers<Peer, PeersMeta> {
  createPeer = (id: string) => {
    const peer = new Peer(id);
    return peer;
  };

  onPeerUpdate = (
    instance: Peer,
    metadata: PeersMeta,
    info: { username: string }
  ) => {
    instance.set(metadata.position, metadata.direction);
  };
}
```

### Custom Entity

```ts title="Custom Entity Class"
import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";

type BotData = {
  position: VOXELIZE.Coords3;
  direction: number[];
};

export class Bot extends VOXELIZE.Entity<BotData> {
  character: VOXELIZE.Character;

  constructor(id: string) {
    super(id);
    this.character = new VOXELIZE.Character();
    this.add(this.character);
  }

  onCreate = (data: BotData) => {
    this.character.set(data.position, data.direction);
  };

  onUpdate = (data: BotData) => {
    this.character.set(data.position, data.direction);
  };

  update = () => {
    this.character.update();
  };
}
```

### Mixins for Character Extensions

```ts title="Mixin Pattern"
export const HoldingCharacterMixin = <
  T extends new (...args: any[]) => VOXELIZE.Character
>(
  Base: T
) => {
  return class extends Base {
    public holdingObjectId = 0;

    setHoldingObjectId = (id: number, world?: VOXELIZE.World) => {
      if (id !== this.holdingObjectId) {
        const obj = world?.makeBlockMesh(id, { material: "basic" });
        this.setArmHoldingObject(obj);
        this.holdingObjectId = id;
      }
    };
  };
};

class BotCharacter extends HoldingCharacterMixin(VOXELIZE.Character) {}
```

## Images

Store images in `static/img/docs/`. Reference them in markdown as:

```md
![Description](/img/docs/filename.png)
```

## Running Locally

```bash
cd voxelize/docs
pnpm install
pnpm start  # Starts dev server on port 3040
```

## Checklist Before Submitting

- [ ] Code examples compile and run
- [ ] Imports use `VOXELIZE.*` and `THREE.*` conventions
- [ ] Code blocks have `title` attributes
- [ ] No AI-generated filler text ("In this section we will...")
- [ ] Explains the "why" not just the "what"
- [ ] Links to related wiki pages where relevant
