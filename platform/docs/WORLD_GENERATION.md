# World generation

Implemented in `platform/crates/worldgen`, run by the game server as an
engine chunk stage (`servers/game-server/src/stage.rs`).

## Pipeline

```
seed
 └─ climate: temperature, humidity, continentalness, erosion  (4 independent fBm fields)
     └─ terrain height: sea level + blended biome offset + roughness × detail noise
         └─ biome: nearest biome to the column's climate point
             └─ surface layers: surface / subsurface / stone, underwater surface below sea level
                 └─ caves: "cheese" chambers + two-field tunnels; lava below y = 10
                     └─ ores: per-chunk seeded veins in their height band, replacing their host block
                         └─ vegetation: trees and ground cover by biome density
                             └─ structures, entities (phases 11 and 10)
```

## Properties

- **Deterministic.** Output is a pure function of `(seed, content, cx, cz)`.
  Every random choice comes from a splitmix64 hash of the seed and world
  coordinates, never from a shared RNG, so generation order does not matter.
  Tested by `generation_is_deterministic`.
- **Chunk-local.** Nothing a stage writes leaves its chunk (trees are placed
  only where their canopy fits), so chunks generate in parallel without
  cross-chunk ordering.
- **Data-driven.** Biomes (climate point, terrain offset and roughness,
  surface blocks, weather, vegetation) and ores (block, host, height band,
  veins per chunk, vein size) come from `platform/game/biomes` and
  `platform/game/ores`. The generator only needs the roles `stone`,
  `water`, `lava`, `bedrock` to exist.
- **Smooth borders.** Height parameters are blended across all biomes with a
  Gaussian kernel in climate space, so neighbouring biomes meet without
  cliffs (tested: adjacent columns differ by ≤ 6 blocks outside mountains).
- **Seas and caves don't leak.** Caves keep an 8-block roof under columns
  below sea level, so oceans never drain into caverns.

## Climate axes

| Axis | Low | High | Scale |
| --- | --- | --- | --- |
| temperature | snow, taiga | desert, badlands, jungle | ~1 400 blocks |
| humidity | desert, badlands | swamp, jungle, dark forest | ~1 200 blocks |
| continentalness (weighted ×2) | deep ocean, ocean | inland, mountains | ~2 200 blocks |
| erosion | mountains (rough) | plains, swamp (flat) | ~900 blocks |

## Biomes in the first pack

Plains, Forest, Dark Forest, Desert, Jungle, Swamp, Savanna, Snowy Plains,
Taiga, Mountains, Beach, Ocean, Deep Ocean, Badlands.

## Next stages

| Stage | Phase | Design |
| --- | --- | --- |
| Rivers and ravines | ✅ | rivers where a 700-block noise field crosses zero on land: terrain sinks smoothly to a flat bed 3 below sea level and fills with water; ravines are narrow cuts up to 40 deep inside masked regions |
| Structures | ✅ | data-driven templates (`platform/game/structures`): Wayfarer's Hut, Old Ruin, Sand Obelisk, Deep Vault, Lookout Tower. One per seeded grid cell (`spacing` chunks, `chance`), biome- and water-aware. Each chunk computes every structure whose footprint touches it and draws its part, so chunks stay independent and structures are whole across borders. Chests carry their structure in the voxel stage bits; the server fills them from the structure's loot table on first opening (deterministic per position) or spills that loot if broken unopened |
| Underground lakes, aquifers | later | flood cave pockets below a per-region water table |
| Villages | later | groups of buildings with paths and NPCs (NPC civilisation phase) |
| Dimensions | ✅ underworld, sky | see below |

## The underworld

`crates/worldgen/src/underworld.rs`, run for the `main_underworld` engine
world. A sealed cavern: bedrock floor at y 0 and roof at y 127 (ragged for a
few blocks), cinderstone carved by 3D noise that is dense near floor and
roof and open between, with a slower 2D field varying how open a region is;
open space below y 31 is a lava sea; emberglass clusters hang from cavern
ceilings in the upper half; ores whose host is cinderstone (ember quartz)
use the same vein placement as the overworld. Deterministic and
chunk-local like the overworld; tested for sealing, openness, the lava sea
and its materials.

Horizontal distances are 8 times shorter there: a portal at overworld
(800, z) leads near underworld (100, z/8). Portals are linked in pairs once
used, so a portal always leads to its partner afterwards; an unlinked one
looks for a portal within 16 columns of the scaled point and builds one
(frame, ledges, headroom) when there is none.

## The sky

`crates/worldgen/src/sky.rs`, run for the `main_sky` engine world:
floating islands over an empty void. The main layer holds one island per
40-block grid cell, at a seeded jittered centre with a radius of 9–20 and a
top between y 84 and 108; a noise-warped rim makes the outline ragged, the
top is turf over dirt, gently domed, and the cloudrock underside hangs
deepest at the middle (up to ~1.3 × the radius). So no point is more than a
short flight from land. Smaller, thinner islets float around y 150 where a
second noise field is high, and flat banks of cloud fill y 190–192. Ores
whose host is cloudrock (sunstone) use the shared vein placement. Nothing
generates below y 40: falling off an island falls out of the world, which
kills (`void` damage, 8 per second below y −2).

Sky coordinates are not scaled. An unlinked arrival looks for the nearest
island top (clouds excluded) within 32 columns of the departure point —
the arrival area is 5 × 5 chunks there — and builds the portal on it; over
open void it builds a portal with its ledges as a platform at island height.

## Changing a live world's generator

Pristine chunks are not saved; they are regenerated. Any change to the
generator or to biome/ore data changes unexplored *and* explored-but-unchanged
terrain. Such a change therefore needs a generator version and, for live
worlds, a migration that saves the loaded/visited area before the switch
([CHUNK_FORMAT.md](CHUNK_FORMAT.md) §6).
