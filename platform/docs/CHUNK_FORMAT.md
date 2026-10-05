# Chunk format

## 1. Coordinates

- A **voxel** is one block cell at integer world coordinates `(vx, vy, vz)`;
  `vy` runs from 0 (bedrock) to `max_height - 1` (255).
- A **chunk** is a column of `16 × 256 × 16` voxels at chunk coordinates
  `(cx, cz) = (floor(vx / 16), floor(vz / 16))`. It is meshed and lit as 8
  sub-chunks of height 32.
- The world is unbounded horizontally (`min_chunk`/`max_chunk` default to the
  full `i32` range); a private or arena world can bound it.

## 2. Voxel encoding (`u32`)

| Bits | Field | Notes |
| --- | --- | --- |
| 0–15 | block id | content `blocks[].id`; 0 is air; up to 65 535 block types |
| 16–19 | rotation | six axis-aligned facings (`PY, NY, PX, NX, PZ, NZ`) |
| 20–23 | y-rotation | 16 horizontal segments for `horizontal` orientation |
| 24–27 | stage | growth or state stage 0–15 (crops, fluid level) |
| 28 | waterlogged | block shares its cell with water |
| 29–31 | waterlog level | fluid level of the shared water |

Defined in `crates/core/src/block.rs` (`BlockUtils`). Block identity therefore
lives in 16 bits and per-cell state in the other 16; richer state (container
contents, sign text, machine buffers) lives in **block entities** keyed by
position, not in the voxel.

## 3. Light encoding (`u32`, low 16 bits used)

| Bits | Channel |
| --- | --- |
| 12–15 | sunlight 0–15 |
| 8–11 | red block light |
| 4–7 | green block light |
| 0–3 | blue block light |

Defined in `crates/core/src/light.rs`. Light is propagated incrementally: a
block change re-floods only the affected light front (`server/world/generators/lights.rs`),
never whole chunks.

## 4. In-memory layout

`Chunk` (`server/world/voxels/chunk.rs`) holds `voxels`, `lights` and
`height_map` as flat `Ndarray<u32>` buffers shared with `Arc` (copy on write),
plus meshes per sub-chunk level, block-entity seeds, biome tint corners and a
`status` (`Generating → Meshing → Ready`). The platform generator produces a
column-major buffer (`index = (x * 16 + z) * 256 + y`) that the generation
stage copies into the chunk.

## 5. Wire format

`protocol.Chunk` in `messages.proto`: `x`, `z`, `id`, `voxels` (bytes),
`lights` (bytes), `meshes` (per sub-chunk geometry with positions, uvs,
indices, lights, and a 15-bit occlusion connectivity mask), optional
`biome_tints`. Clients can mesh locally with the WASM mesher, which compiles
the same Rust mesher, so server and client geometry agree.

## 6. Persistence

Each world saves to `<GAME_SAVE_DIR>/<world>/` (engine `WorldConfig.save_dir`).

```
data/worlds/main/
  chunks/<cx>_<cz>.json      one file per modified chunk
  entities/…                 persisted entities (when enabled)
  chat/…                     chat log
  players/<id>.json          player records, only without a database
                             (GAME_DATABASE_URL); with one they live in
                             MySQL `player_states`, and an old file is
                             imported on the player's first load
                             (renamed <id>.json.imported)
  portal_links.json          pairs of portals that lead to each other
  containers.json, mobs.json chests and furnaces, animals
  drops.json                 items lying on the ground (with their age)
  plugins/<key>.json         each server plugin's store
data/worlds/main_underworld/ the underworld: its own chunks, containers, mobs
data/worlds/main_sky/        the sky: the same, for the floating islands
```

Chunk file (version 1, `server/world/voxels/background_chunk_saver.rs`):

```json
{
  "id": "<chunk id>",
  "voxels": "<base64( zlib( little-endian u32[16*256*16] ) )>",
  "height_map": "<base64( zlib( little-endian u32[16*16] ) )>",
  "version": 1
}
```

Lights are not stored; they are recomputed on load, which keeps files small
and makes a light-propagation fix apply to old saves.

**When game state is written.** Player records after every intent that
changes them (to MySQL through a writer thread that never blocks the tick:
a burst of saves becomes one write within milliseconds, a record still
waiting is what the next load returns, and on stop the server waits until
every record is written), and every player every minute (places and vitals change
without intents); containers and lying items every 5 s when they changed;
animals as they change; chunks within ticks of an edit (the engine's
background saver flushes every 50 ms). On SIGTERM or Ctrl-C every world
saves players, containers, items and animals once more, plugins save their
stores, and the process exits 1.5 s later (`gameplay/shutdown.rs`), so a
stop loses nothing a player did. Items whose chunk is not loaded hold still
until it is, so restored items never fall through an unloaded world.

**What a crash can lose (and why there is no separate write-ahead log).**
A clean stop loses nothing (above). A hard crash (power loss, `kill -9`)
loses what was not yet on disk: up to a minute of a player's position and
vitals, up to 5 s of container and lying-item changes, and chunk edits of
the last few ticks. The one case that matters is a block mined (or placed)
in the last ~100 ms before a crash: the player's record, written right
after the intent, keeps the item while the chunk may not yet hold the
change, so one block can come back. Every file is written whole and
renamed into place, so nothing is ever torn, and money never depends on
these files (the ledger is in the database, in transactions). A
write-ahead log of block changes would close that sub-second window at the
cost of a second write path through the engine's chunk saver; with the
window this small it is not worth it, and the backups (daily archives,
infrastructure/README.md) cover losing the disk itself.

**Write safety.** Files are written to `<name>.json.tmp`, `fsync`ed, then
atomically renamed over the old file. A crash leaves either the old or the
new chunk, never a torn one.

**What is saved.** Only chunks that differ from what the generator produces
(`save_pristine_chunks = false`). A pristine chunk is regenerated from the
seed on load — generation is deterministic (see
[WORLD_GENERATION.md](WORLD_GENERATION.md)) — so the world can be explored
for kilometres without growing the disk. **Changing the generator therefore
changes pristine terrain**: any change to `crates/worldgen` or to the biome
and ore data of a live world requires a generator version bump and a
migration that materialises the affected loaded chunks first.

**Save cadence.** Dirty chunks are queued and written by a background thread
(`save_interval` ticks, bounded per tick); a chunk that cannot be saved is
retried with a bounded count and logged, never dropped silently.

## 7. Versioning and migration

- `version` in every chunk file. Readers accept all versions they know and
  refuse unknown ones loudly.
- `ChunkStage::restore` runs on every loaded save before meshing: it is the
  hook for idempotent data migrations (e.g. a block id remap when content
  ids change). It never reruns generation, so player construction survives.
- Block ids are stable forever once a world uses them. Removing a block from
  content requires a remap migration; reusing an id is refused by review.

## 8. Planned: region files and write-ahead log (phase 6)

One JSON file per chunk is simple and crash-safe but costs an inode per
chunk. Phase 6 introduces:

1. **Region files**: 32×32 chunks per file with an offset table and
   per-chunk zstd compression, written append-then-swap.
2. **Write-ahead log** for sensitive changes (block entities holding items,
   land-protected edits): each change is appended and fsynced before it is
   acknowledged, and replayed on startup after a crash.
3. **Incremental backups**: region files are content-addressed and uploaded
   to object storage when they change ([../infrastructure/README.md](../infrastructure/README.md)).
