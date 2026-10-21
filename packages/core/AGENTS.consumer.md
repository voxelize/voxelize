<!-- BEGIN:voxelize-agent-rules -->
## Voxelize

This project is built on [Voxelize](https://github.com/voxelize/voxelize): an authoritative Rust server (`voxelize` crate) and TypeScript client packages (`@voxelize/*`). Its agent docs ship with the installed version; prefer them over memory, which is likely out of date.

Before writing Voxelize code, read the skill that matches the task in `node_modules/@voxelize/core/skills/`:

| Task | Skill |
| --- | --- |
| Creatures, animals, mobs, NPC bodies, any many-of-a-kind animated entity | `voxelize-instanced-entities` |

Then read the APIs it names in `node_modules/@voxelize/core/dist/**/*.d.ts` (JSDoc has `@example`s).

Ground rules:
- The server is authoritative. Gameplay state (positions, health, inventories, voxel edits) changes on the server and streams to clients; the client renders and requests.
- Entities are entities, never blocks. Anything that can number in the dozens is instanced (`defineSkinnedFamily`), not a mesh per entity.
- Work done the first time something appears is a hitch in play: bake it during load (`InstancedEntityRoster.warm`).
- Prove visual work in the running game (lit, shadowed, at day and night), not only in tests.
<!-- END:voxelize-agent-rules -->
