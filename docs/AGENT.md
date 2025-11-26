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

Direct and human. No fluff:

- One sentence to explain what something does
- Show code right after
- Use `title="Description"` on code blocks
- Keep it short - code speaks louder
- Use contrasts when helpful (e.g., "Unlike events, methods run world-wide")
- No AI phrases like "In this section we will..." or "Let's explore..." - just get to the point

### Examples

Every feature needs a real example. No hand-waving.

Structure:

1. **Name it** (e.g., "Example: Discord Bot Bridge")
2. **What problem does it solve?** One sentence.
3. **Show the code** - break into steps if needed
4. **Full implementation** at the end for copy-paste

Bad:

```
Here's how to use onChat:
[code block]
```

Good:

```
## Example: Discord Bot Bridge

Announces when players chat in your game.

[code showing how to set it up]

### Full Implementation
[complete, runnable code]
```

Use sequence diagrams (mermaid) when the flow is complex. Skip them if it's obvious.

### Code References

When showing code blocks, prefer referencing real code from the codebase when possible:

1. **Point to tutorial source code** - If there's a working example in `examples/` or the tutorial project, reference the file path so readers can see full context
2. **Include "Full Implementation" sections** - After step-by-step breakdowns, show the complete, runnable code
3. **Link to town project patterns** - When a pattern exists in `client/src/` or `server/src/`, mention it as a real-world reference

Example reference style:

```
See the full implementation in `examples/client/src/main.ts`.
```

Or at the end of a tutorial section:

```
### Full Implementation

Here's the complete code from this section:

\`\`\`ts title="examples/client/src/main.ts"
// complete runnable code
\`\`\`
```

This helps readers:

- Verify the code actually works
- See surrounding context
- Copy-paste without missing pieces

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

Tutorials walk through building something real. They should read like you're sitting next to someone showing them how to code:

1. Use frontmatter with `sidebar_position`
2. Jump right in - no "In this tutorial..." preamble
3. Show what you're building first (screenshot or description)
4. Walk through it step by step as if you're coding along
5. Reference the actual tutorial repo code when possible
6. End naturally - no forced transitions

Tone: "Now add the network setup:" not "Next, we will add the network setup to our application."

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

- [ ] Code examples actually work
- [ ] Imports use `VOXELIZE.*` and `THREE.*` conventions
- [ ] Code blocks have `title` attributes
- [ ] No AI speak ("In this section...", "Let's explore...", "We will learn...")
- [ ] Explains why, not just what
- [ ] Links to related pages when relevant

## Phrases to Avoid

These sound like AI wrote them:

- "In this section, we will..."
- "Let's explore..."
- "Now that we have covered..."
- "It's time to..."
- "We can now proceed to..."
- "First, let's start by..."

Just say what to do:

- "Add the network setup:"
- "The controls need an update loop:"
- "Create a character:"
