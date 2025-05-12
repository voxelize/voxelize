# Voxelize Three-Pass Lighting System

**Last updated:** {{DATE}}

## Why a Three-Pass System?

Lighting in a voxel world is a state–propagating simulation. When blocks change, **two kinds of mutations** happen:

1. **Topology** – the solid/transparent status of voxels changes (affects where light _can_ travel).
2. **Sources** – blocks that _emit_ or _remove_ light are added / removed.

If these two concerns are processed in the wrong order or interrupted part-way, residual ("leaked") light remains in the world and can never be removed. A single-pass update therefore cannot guarantee correctness when _multiple_ voxels change in the same tick.

The **three-pass algorithm** guarantees correctness while still being performant.

---

## Pass-by-Pass Breakdown

| Pass                       | Goal                                                                  | What happens                             | Why it must finish |
| -------------------------- | --------------------------------------------------------------------- | ---------------------------------------- | ------------------ |
| 1️⃣ **Apply voxel changes** | Commit _all_ block id / rotation / stage mutations to the data layer. | • Update `voxels`, `stages`, `rotations` |

• Collect a list of _removed_ light-source voxels.  
• Collect a list of _all_ updates for later re-evaluation. | Later lighting calculations must operate on the **final** topology. |
| 2️⃣ **Remove light from deleted sources** | Ensure no residual light remains from blocks that no longer emit. | • Batch clear sunlight at each removed source.  
• **Batch BFS** remove coloured light per colour via `remove_lights` / `removeLightsBatch`. | Any residue left here would propagate in Pass 3 and leak forever. |
| 3️⃣ **Re-evaluate & propagate** | Based on the _new_ world state, remove outdated light caused by transparency changes and add light from new sources. | • Iterate `processedUpdates`, compare old vs new block transparency.  
• Remove neighbour light when now blocked.  
• Queue new light from added sources.  
• **Flood** all queued light once (‘flood light’). | Finalises lighting so that render + save operations see a consistent world. |

A visual mnemonic:

```
┌─────────────┐   ┌────────────┐   ┌──────────────┐
│  PASS 1     │ → │  PASS 2    │ → │   PASS 3     │
│ Apply/Store │   │  Clear     │   │  Re-prop &   │
│ topology    │   │ old light  │   │  flood new   │
└─────────────┘   └────────────┘   └──────────────┘
```

---

## Performance Considerations

- **Batch removal** – `remove_lights`/`removeLightsBatch` accepts _all_ voxels of a colour at once, so overlapping BFS waves are merged and processed only once.
- **Flood once** – All new light is queued during Pass 3 and flooded once at the very end; this minimises redundant work.
- **Time budget** – The client can still honour `maxLightsUpdateTime`, but only **Pass 1** may early-out. Pass 2 & 3 must finish to preserve correctness.

---

## Common Failure Modes Avoided

1. **Residual light leaks** – forgetting Pass 2 leaves old light in the world.
2. **Half-updated neighbours** – single-pass algorithms that intermix removal & flood can let earlier blocks see outdated neighbour data.
3. **Infinite update loops** – stale light can trigger further updates every tick; full removal prevents this.

---

## Checklist for Future Changes

- [ ] Never skip Pass 2 or Pass 3 due to time-budget; only Pass 1 can be subdivided.
- [ ] When introducing new light colours or mechanics, add them to batch removal & flood logic.
- [ ] Maintain data-parallel symmetry between **server** (Rust) and **client** (TS) implementations.
- [ ] Keep the batch removal BFS FIFO; LIFO can starve nodes and leave artefacts.

---

_Prepared by: core-lighting team_
