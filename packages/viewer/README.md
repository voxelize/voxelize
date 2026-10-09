# @voxelize/viewer

Fly over a Voxelize world without joining it: pan, orbit, zoom and fly from any
angle, top-down and isometric included, with the engine's own meshing and
materials, a far layer past the meshed chunks, overlays keyed by x,z, two
sources side by side or under a swipe, and a scriptable capture CLI.

Nothing here knows a game. A game supplies a **source** (where chunks come
from), a **page** (its own texture setup and UI around the viewer) and a
**config** (how a source spec becomes a backend process, bookmarks, the label
on every capture).

## Pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Backend | `voxelize::viewer` (Rust, `server/viewer/`) | A long-running process over stdin/stdout: chunks from a `ViewerSource`, cross-chunk writes landed, light flooded and meshed with the server's own `Lights` and greedy mesher, mesh files keyed by their 3x3 neighbourhood's voxels (so a world re-viewed after a generation change re-meshes only what changed), coarse far tiles, column queries, annotations. |
| Browser library | `src/` | `WorldViewer`: camera rigs, chunk streaming with a size-capped resident set, the engine's `FarTerrain` as the far layer, overlays, the A/B split, the control surface (`window.__voxelizeViewer`). Meshes are decoded and built in workers; the main thread only uploads, under a byte budget per frame. |
| Server and CLI | `src/node/`, `bin/voxelize-viewer.ts` | Starts one backend per source, bundles the host page with esbuild, serves tiles, keeps a headless page for captures, answers the control API. Local only; exits after an idle spell. |

## Sources

```rust
pub trait ViewerSource: Send + Sync {
    fn registry(&self) -> &Registry;
    fn config(&self) -> &WorldConfig;
    fn describe(&self) -> SourceDescription;               // name, far materials, layers, info
    fn chunk(&self, cx: i32, cz: i32) -> Result<Option<SourceChunk>, String>;
    fn far_tile(&self, spec: &FarTileSpec) -> Option<FarTile> { None }
    fn query(&self, x: i32, z: i32) -> Value { Value::Null }
    fn annotations(&self, min: [i32; 2], max: [i32; 2]) -> Vec<Annotation> { vec![] }
}
```

Shipped implementations:

- `PipelineSource` runs a world's own stage list chunk by chunk. Get the stage
  list with `capture_world(&registry, "name", |server| setup(server))`, which
  keeps what the setup handed `Server::add_world`, so the viewer cannot drift
  from what the server generates.
- `SavedChunks` reads a world's saved chunk files and never writes them: a
  file that does not decode is reported and shown as missing, never repaired
  or removed.

A game wraps either to add a far layer from its own coarse model, extra
layers for overlays (a biome map, a landform mask) and annotations. A live
server as a spectator is the next provider; it must never count as a player.

Serve a source with `serve_viewer_stdio(source, launch)`; `read_launch` parses
the launch file the server writes (`{ "backend": {...}, ...host fields }`). The
protocol and file layouts are documented in `server/viewer/mod.rs` and
`server/viewer/format.rs`; `src/formats.ts` reads them.

## Overlays

```ts
type RasterOverlay = {
  kind: "raster"; id: string; label: string;
  color(sample: { x; z; height; water; material; layer(id): number }, meta): Rgba | null;
  legend?(meta): { label: string; color: string }[];
  available?(meta): boolean;
};
```

Built in: chunk grid, height contours (drawn from a filtered height map, so
they read as map contours from any angle), relief, water bodies, and the
source's annotations. A host adds its own raster overlays for the layers its
source names. Overlays are drawn in a composite pass that reconstructs each
pixel's world position from depth, so they lie on near meshes and far tiles
alike.

## Camera

Drag to orbit, right-drag (or Shift-drag) to pan, wheel to zoom, WASD to
move, Space and Shift to rise and sink, Q and E to turn a quarter. In the
free preset WASD keeps the camera's height (`levelFlight`; off flies along
the view).

The camera's height only changes because of something the user did. Once
he pans, the look point follows the ground under it, read as the median of
a footprint that scales with the view, so a tree, a pillar or a cliff step
does not register, and eases there; at rest it ignores the heightfield
refining as tiles stream in, unless the ground turns out to be a sizeable
share of the view away. In the orbit preset the eye keeps a clearance over
the ground beneath it, eased the same way. All of it is a critically
damped spring solved per elapsed second (`dampTo` in `src/smoothing.ts`),
so it moves the same at 30 frames a second as at 144. `smoothing` (seconds
to cover 90% of a height change; 0 snaps, as the first version did) is a
user option; `ViewerHost.camera` tunes the rest (`DEFAULT_CAMERA_FEEL`:
footprint, dead bands, clearance, flight timing).

Double-click a spot to fly there: the ground under the cursor is ray
marched, then the camera eases (smootherstep, no overshoot, 0.6 to 1.2 s
by distance) to frame it, closing in a step as a map does, in whatever
preset it is in; on the top-down and isometric maps that is "zoom in
here". Alt keeps the zoom. Any input during a flight stops it where it
is. Bookmarks fly the same way, widening the frame mid-way when the trip
is longer than the view.

```ts
viewer.flyTo([x, y, z]);                   // y may be null: the ground there
viewer.flyToPose(pose, "orbit", { duration: 1 });
window.__voxelizeViewer.flyTo(x, null, z); // the control surface; also pick(px, py), cancelFlight()
```

```bash
voxelize-viewer --config my.config.ts fly-to 120,40         # the headless page's camera, as a double-click
voxelize-viewer --config my.config.ts shot --bookmark a --fly-to 120,64,40
```

## The pin and the action wheel

Click the terrain to drop the pin: a voxel banner (a pole, a brass finial
and a cloth, built from boxes at 16 texels per block and lit by the chunk
shader's own daylight) with a card of what the source knows about the
column (block, height, and whatever the host's `pins.describe` reads from
its query). There is only ever one: the next click moves it. A
double-click that follows flies there instead and puts the pin back where
it stood; a drag still orbits.

Click the pin, right-click anywhere, or hold the pin or the right button
to open the action wheel at the cursor: a ring of 16x16 pixel icons round
a centre, a label under it. Opened by a click it waits for a click, a key
(each action's letter, or 1 to 8) or Esc; opened by a hold it follows the
flick and fires the highlighted action on release. Everything in it moves
in whole steps. The built-in actions: Spawn here (the host's `shareLink`
for a player standing on the pin, facing the camera's heading), Fly here,
Look from here (eye height at the pin), Measure from the pin (run, rise
and slope to the next spot clicked, or to the spot the wheel was opened
over), Bookmark (saved with the viewer server next to the config's), Copy
share link, Copy coordinates, Remove, and Pin here over bare ground. A
host adds its own with `pins.actions`.

`ViewerHost.theme` dresses all of it (panel colours, bevels, accent, a
pixel font, banner colours and an icon per action id); without one it
uses `DEFAULT_THEME` and built-in icons. The pin lives in the page URL
(`pin=x,y,z`; a link's older `pins=` list loads its first pin).

```ts
window.__voxelizeViewer.dropPin(x, null, z);
window.__voxelizeViewer.pinAction("pin", "spawn");                        // { link, pose }
window.__voxelizeViewer.pinAction("pin", "measure", { to: [x, null, z] }); // from the pin
```

```bash
voxelize-viewer --config my.config.ts pin 120,40
voxelize-viewer --config my.config.ts pin-action pin spawn
voxelize-viewer --config my.config.ts pin          # the pin, as it stands
```

## Hosting it

A config module default-exports `{ port, server }` (`ViewerConfigModule`):
`resolveSource(spec)` turns a spec into `{ id, label, world, spawn(launchFile),
launch, provenance }`; `page` names the entry, aliases (one `three`, one
`@voxelize/core`) and asset roots; `bookmarks`; `stamp`, the label printed on
every capture so it is never taken for a game client frame.

```bash
voxelize-viewer --config my.config.ts serve                 # the page at its URL
voxelize-viewer --config my.config.ts shot --preset iso --out a.png
voxelize-viewer --config my.config.ts shot --b other-spec --split side   # A/B
voxelize-viewer --config my.config.ts sheet --title t --view "--bookmark a" --view "--bookmark b"
voxelize-viewer --config my.config.ts call setOptions '{"time":0.8}'      # drive the headless page
voxelize-viewer --config my.config.ts query 12,40
```

`shot` prints the image path and one JSON line: source provenance, pose,
options, settle state and timings.

**Textures.** The host's `setupTextures(world)` runs the game's own registry
setup against a stand-in `World`: texture groups, block textures, frames
(the first one: the viewer holds still) and `customizeMaterialShaders` are
real; anything else it reaches for is absorbed and counted. Paints the setup
fires without awaiting are waited for before anything renders, and then
`textureCensus()` (on the control surface too) counts what is still on the
unknown checker the way `World.textureCensus` counts it: atlas slots once
each, plus own-texture faces, with every paint whose source failed. A source
that comes out with anything unpainted says so on the console, by block and
face.

**Stylesheet.** `page.stylesheet` builds the page's CSS, served at
`/page.css`; when it is built from a file elsewhere (a Tailwind input), set
`page.stylesheetBase` to that file's directory and its relative `url()`s
(a font, say) are pointed at the asset files they name instead of
resolving against the server root.

## Demo

The demo server's worlds through their real pipelines:

```bash
pnpm --filter @voxelize/viewer demo        # builds the viewer-backend example, serves http://127.0.0.1:4820
pnpm --filter @voxelize/viewer demo:shot   # a labelled isometric capture
```

`examples/viewer/main.rs` is the backend: twenty lines of `capture_world`,
`PipelineSource` and `serve_viewer_stdio`. A landscape generator built on
`voxelize-gen` plugs in the same way, as a `PipelineSource` over its stages.
