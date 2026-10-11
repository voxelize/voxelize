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
                             └─ village paths, structures and villages, entities (phases 11 and 10)
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
| Underground lakes, aquifers | ✅ | where a 110-block aquifer field is high, cave cells below a regional water table (14–44 under sea level, always 10 or more under the ground) hold water instead of air |
| Villages | ✅ | data-driven (`platform/game/villages`): a Hamlet is a well with three to six houses and farms on a ring around it (`radius`), each turned by quarter turns so its front row faces the well, joined to it by gravel paths laid on the surface (clearing ground cover). One per seeded grid cell, in its biomes, on dry land; houses that would stand in water are left out. Village pieces are `village` structures with `foundation` blocks filled under their floors on slopes; house chests carry loot |
| Biome tints | ✅ | each biome has a `tint` colour; blocks marked `tinted` (turf, tall grass, leaves) take it through the engine's regional colour: every chunk carries the tint at its four corners (an average over a 3 × 3 grid of biomes around each corner, so neighbouring chunks share corners and colours blend), the client blends it across the chunk; tints are saved with edited chunks |
| Dimensions | ✅ underworld, sky | see below |
| Frozen water | ✅ | in biomes at or under temperature −0.4 (Snowy Plains, Taiga) the top layer of seas, lakes and rivers is ice; torches melt it (block behaviour `melts`), and broken ice gives an ice block. Pristine cold-water chunks of worlds made before this regenerate frozen; edited chunks keep what was saved |

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
kills (`void` damage, 8 per second below y −2; creative players, who can
fly back, only below y −64, and they keep their inventory).

Sky coordinates are not scaled. An unlinked arrival looks for the nearest
island top (clouds excluded) within 32 columns of the departure point —
the arrival area is 5 × 5 chunks there — and builds the portal on it; over
open void it builds a portal with its ledges as a platform at island height.

## Paradise

`crates/worldgen/src/paradise.rs`, run for the `main_paradise` engine
world: a world of plenty and light. Gentle hills (y 73–95) of radiant turf
over golden loam over pearlstone, with no caves. Slow rivers wind through
them, their surface at y 70 and their beds 2–4 deeper, banks easing up to
the meadow; each river carries honey or wine along its whole length (a
second noise field, far slower than the rivers bend, picks which). Light
trees (light wood, glowing leaves that drop golden fruit) grow on about one
column in 55, halo blooms on one in 11, and on one hill cell in three of 48
a pearl shrine stands: a level platform, four pillars with wisp lanterns,
a block of diamond at its heart. The pearlstone is thick with diamonds,
gold and lumenite (ore specs whose host is pearlstone). Almost every block
gives light, and the world's clock is stopped at noon, so nothing here is
ever dark.

Temples of Light (one in about half of the 112-block cells) stand only
where no river or bank touches their corners or centre: a pearl foundation
fills the ground below their floor and hills inside their footprint are
cut away.

Coordinates are not scaled. An unlinked arrival looks for the nearest dry
meadow (above the rivers) within 32 columns and builds the gate there.

## Ocean

`crates/worldgen/src/ocean.rs`, run for the `main_ocean` engine world: an
endless sea with no shore. Water stands up to y 120 everywhere (the
world's `water_level` too), far above a seafloor around y 60 (±14, with
smaller detail) of sand or gravel over stone. Trenches follow the zero line
of a slow field and sink to about y 24, where the floor is abyssal rock;
seamounts rise as high as y 116 and never break the surface. Nothing is
generated above the surface and there are no caves.

What grows on a column is a pure function of the seed: reefs (where a reef
field is high and the floor above y 62) of fire, tide and sun coral in
stacks of 1–3 with glow anemones between; kelp forests (a second field)
whose stalks reach most of the way up; sea grass on open sand; now and then
a giant clam (pearls) or a bubble vent; and in the abyss glow anemones and
vents light the dark. Kelp, sea grass and anemones are written waterlogged
(bit 28 of the voxel word, the engine's waterlogged bit), so the water
stays around them and breaking one leaves water.

In every 64 × 64 cell stands one air dome: centre placed by a hash of the
cell, a tidestone floor filled down to the seafloor, dry air within radius
6.5 and glass out to radius 8 (thick enough that water cannot seep through
a diagonal), pearl lamps in the corners and a clam by the wall. Dome floors
stay between y 20 and y 104.

Shipwrecks (one in about half of the 96-block cells) and sunken temples
(160-block cells) rest on the seafloor, their bottom layer sunk into it;
none on a seamount close to the surface. Their insides keep the water.

Coordinates are not scaled. An unlinked arrival lands in the dome nearest
to the departure point (found from the seed alone) and the Tide Gate is
built on its floor; arrivals get 90 s of water breathing.

## Spawn

The overworld's spawn (`Generator::spawn_point`) is the dry column nearest
the origin: ground at or above sea level with two free cells above it,
searched in square rings every 4 blocks out to 512 (the origin at sea level
if none). New players start there and the dead respawn there (unless they
have a town hall), so nobody begins in the lake that the origin may be.

## Changing a live world's generator

Pristine chunks are not saved; they are regenerated. Any change to the
generator or to biome/ore data changes unexplored *and* explored-but-unchanged
terrain. Such a change therefore needs a generator version and, for live
worlds, a migration that saves the loaded/visited area before the switch
([CHUNK_FORMAT.md](CHUNK_FORMAT.md) §6).
