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
| Rivers and ravines | 11 | ridged noise channels carved before caves, flooded to sea level |
| Underground lakes, aquifers | 11 | flood cave pockets below a per-region water table |
| Structures | 11 | data-driven templates (villages, ruins, temples, mines, dungeons, towers, shipwrecks) placed on a seeded region grid; multi-chunk structures are placed through the engine's `exceeded_changes` mechanism so neighbours receive their part |
| Dimensions | 18 | each dimension is a world with its own generator config (underworld: inverted cavern generator, lava sea; sky: floating islands from 3D density) |

## Changing a live world's generator

Pristine chunks are not saved; they are regenerated. Any change to the
generator or to biome/ore data changes unexplored *and* explored-but-unchanged
terrain. Such a change therefore needs a generator version and, for live
worlds, a migration that saves the loaded/visited area before the switch
([CHUNK_FORMAT.md](CHUNK_FORMAT.md) §6).
