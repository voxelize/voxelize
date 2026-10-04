# Content packs

All game content is data under `platform/game/`, one directory per kind.
Every `*.json` file in a kind's directory is read in file-name order and
concatenated, so packs split content by theme (`00-terrain.json`,
`10-ores.json`, …). `platform-content` validates the whole pack at load and
reports every problem at once; the game server refuses to start on an
invalid pack, and CI runs the validation on every change.

Keys are `snake_case`, unique per kind, and are the stable references used
by other content, saves and the database. Numeric ids (blocks, items) are
stable forever once a world has used them; 0 is reserved (air).

## blocks/

```json
{
  "id": 2, "key": "stone", "name": "Stone",
  "material": "rock", "hardness": 1.5, "resistance": 6,
  "texture": { "all": "stone", "top": null, "bottom": null, "side": null },
  "transparent": false, "collision": true, "gravity": false,
  "lightEmission": 0,
  "tool": { "kind": "pickaxe", "minTier": 0, "required": true },
  "drops": [{ "item": "rubble", "min": 1, "max": 1, "chance": 1.0 }],
  "orientation": "none",
  "flammable": false, "fluid": null,
  "behaviors": [], "stages": 0
}
```

| Field | Meaning |
| --- | --- |
| `hardness` | seconds-scale break cost; negative = unbreakable |
| `tool.kind` | `pickaxe`, `axe`, `shovel`, `hoe`, `sword`, `shears` |
| `tool.minTier` | lowest tool tier that harvests (0 wood, 1 stone, 2 iron, …) |
| `tool.required` | `false`: the tool only speeds mining, drops come by hand too |
| `orientation` | `none`, `horizontal` (4 facings), `full` (6 facings) |
| `fluid` | `water` or `lava`; fluids must not have collision |
| `xp` | blocks: experience released when mined and harvested, `[min, max]` (ores) |
| `behaviors` | `falls`, `spreads`, `decays`, `grows`, `melts`, `dries`, `burns` (fire); circuits: `conduit`, `lever`, `button`, `plate`, `clock`, `consumer`, `repeater`, `inverter`, `actuator`, `gripActuator` (pushes when powered, pulls the block back when the power goes), `watcher` (a two-tick pulse out of its back when the cell in front changes), `gauge` (powers its front with the fill level 0–15 of the container behind it) — implemented once by the server, enabled here |
| `coupled` | two-voxel blocks (tall doors): `{ "offset", "block", "anchor" }` names the other half; the two must point at each other and exactly one is the anchor (the half that is placed). Placing the anchor needs the other cell free; breaking either half removes both; consumer pairs switch together and feel power at either half |
| `powered` / `powerSwap` | consumers (lamps, gates): whether this block is the powered state, and the block it swaps to when power changes (pairs must point at each other) |
| `stages` | growth stages (2–16) for `grows` blocks |
| `grownDrops` | drops at the last growth stage (ripe crops), replacing `drops` |
| `support` | block keys it must stand on; elsewhere it cannot be placed and it breaks (and drops) when its ground changes |
| `growsInto` | saplings: the tree they become (`log`, `leaves`, `minHeight`, `maxHeight`) |

Items with `"fertiliser": true` (Fertiliser, three from a bone) used on a
plant make it grow at once: a crop advances two to four stages (never past
ripe; a ripe crop refuses), a sapling becomes its tree when there is room,
and turf sprouts tall grass around the spot. Crops: wheat (seeds), carrots
and potatoes (planted from the vegetable itself on farmland, eaten
elsewhere; potatoes bake in the furnace).

The `rift` behaviour marks portal surfaces, and every rift declares
`"portal": { "frame": "<block>", "to": "<dimension>" }`: a rift stays only
while its four in-plane neighbours are rift or its frame, so breaking any
frame block puts the whole portal out. Items with tool kind `igniter` (the
Fire Striker) light closed frames into their rift. A portal kind leads from
the overworld to its `to` dimension and back, and does nothing anywhere else
(its frame does not light there). The pack has two kinds: `riftstone` →
`rift` → underworld and `skystone` → `sky_rift` → sky. Each frame and each
destination belongs to one rift only, and no rift leads to the overworld
(checked at load).

Mining time: `hardness × (harvests ? 1.5 : 5.0) ÷ speed`, where `speed` is
the held tool's `speed` if its kind matches the block's tool, else 1;
divided by 5 more when airborne or underwater; multiplied by status effects
(`crates/content/src/mining.rs`).

## items/

```json
{ "id": 24, "key": "wooden_pickaxe", "name": "Wooden Pickaxe", "type": "tool",
  "stackSize": 1, "durability": 60, "rarity": "common", "value": 3,
  "tool": { "kind": "pickaxe", "tier": 0, "speed": 2.0, "attackDamage": 2 },
  "placesBlock": null, "food": null }
```

`type`: `block`, `material`, `tool`, `weapon`, `armor`, `food`, `seed`,
`misc`. Items with durability stack to 1. `value` is a reference value in
soft-currency units for NPC traders and analytics, never a binding price.

## recipes/

```json
{ "type": "shaped", "key": "stick", "pattern": ["#", "#"],
  "symbols": { "#": "planks" }, "result": { "item": "stick", "count": 4 },
  "mirrored": true }
{ "type": "shapeless", "key": "planks_from_oak", "ingredients": ["oak_log"],
  "result": { "item": "planks", "count": 4 } }
```

Shaped patterns are up to 3×3 and match anywhere in the grid (and mirrored
unless `mirrored: false`). Shapeless recipes match the exact multiset of
ingredients. The first matching recipe in pack order wins.

## processing/

```json
{ "stations": [{ "key": "furnace", "name": "Furnace", "block": "furnace", "fueled": true }],
  "fuels":    [{ "item": "coal", "ticks": 1600 }],
  "recipes":  [{ "key": "smelt_iron", "station": "furnace",
                 "input": { "item": "raw_iron" }, "output": { "item": "iron_ingot" },
                 "ticks": 200, "experience": 0.7 }] }
```

A station is any block that runs processing recipes. Smelters, cookers,
crushers and later machines are new station entries plus recipes, with no
new code.

Guild blocks: `guild_hall` (Town Hall) and `guild_vault` (Guild Vault) are
placed only on guild land that is part of a settlement (a hall by the
guild's leader or officers, a vault by any member). The server gives them
their behaviour by key: using a hall sets the member's respawn point; a
vault opens its guild's shared inventory. `siege_banner` is the one block
placed on someone else's land: on land of a guild yours is at war with,
where it runs a siege (see NETWORK_PROTOCOL.md).

Armor items (`"type": "armor"`) carry `"armor": { "slot": "head" | "chest" | "legs" | "feet", "points": n }`
(checked at load: armor needs stats and only armor has them). The inventory
screen's armor slots run head, chest, legs, feet and take only their own
piece; shift-click puts a piece on. Armor worn adds up to at most 20 points
and takes points/25 off hits from creatures and players; each hit wears
every worn piece by one. The pack has hide, copper, iron and ember quartz
sets (the classic points: 1/3/2/1 up to 3/8/6/3). Mobs may set `xp` (the
default is 5, 2 for passive ones); processing recipes' `experience` is paid
per item taken out of a furnace.

Fire (`fire`, behaviour `burns`) updates every 1.5–3 s: it burns a
flammable neighbour away (into fire), spreads to empty cells beside
flammable blocks, ages and dies out (at once without fuel or ground, beside
water; never on cinderstone). A `blast_charge` caught by fire is set off
instead. Bodies in fire or lava burn (1 per second, 2 in the flames, for 8
s after fire and 15 s after lava) until water puts them out; creatures in
fire or lava take 1 or 4 per second. A lit blast charge explodes after 4 s
with power 4: cells within 4 blocks break when the blast at their distance
beats their `resistance` (never unbreakable blocks, fluids, containers,
town halls, vaults or anvils, and on claimed land only where the one who
lit it may build); one block in four drops; other charges go off within a
second or so; bodies within 8 blocks take up to 24 damage (through armor)
and are pushed away. Bows (`bow`) shoot `arrow`s (see NETWORK_PROTOCOL.md).

Potions are items with `"potion": { "effect", "seconds", "level" }`; effects
are `speed`, `slowness`, `strength` (+3 melee per level), `weakness`
(−4), `regeneration` (1 health per 2.5 s, twice as fast per level),
`poison` (1 per 1.25 s, never below one heart), `resistance` (−20 % damage
per level), `fire_resistance`, `night_vision`, `water_breathing`,
`jump_boost`, `hunger` and the instant `healing`. Speed, slowness, jumping
and night vision act on the client; the rest on the server. Brewing is
shapeless crafting: a water bottle (a glass bottle filled at water) and an
ingredient.

Weather (overworld only): clear spells of 10–150 minutes and rain of 10–20
minutes, a quarter of it thunder. Rain puts out fires and burning bodies
under open sky, keeps farmland wet and keeps the undead from burning; it
falls as snow in biomes colder than −0.3 and not at all above 0.84.
Thunderstorms strike lightning near a player every 8 s: 5 damage within 3
blocks (setting them alight) and fire where it hits unclaimed land.

## biomes/ and ores/

Every biome belongs to a `dimension` (`overworld` by default,
`underworld` or `sky`); each dimension needs at least one. The overworld
generator uses only overworld biomes; the underworld's and the sky's first
biome names its single region.

See [WORLD_GENERATION.md](WORLD_GENERATION.md). Biomes declare a climate
point, terrain offset and roughness, surface/subsurface/underwater blocks,
weather kinds and vegetation (`trees`: log, leaves, density, height range;
`groundCover`: block, density, optional host block). Ores declare block,
host block, height band, veins per chunk and vein size.

## mobs/ and structures/

Creatures declare kind (`passive`, `neutral`, `hostile`), health, speed,
damage, size, spawn rules (light, ground blocks, biomes, weight, group
size), drops, breed item, daylight burning, sight and a box model (parts
with size, offset, colour; legs swing). Optional fields:

| field | meaning |
| --- | --- |
| `movement` | `walk` (default: gravity, step-up, A* paths round walls), `fly` (no gravity; hovers, dives at its target, rises over obstacles), `swim` (moves in 3D in water, stays under the surface, turns back at the shore, loses 1 health a second on land; spawns in water two deep, so `spawn.on` must be empty) |
| `ranged` | `{ "range", "cooldown", "speed" }`: shoots arrows (aimed above far targets for the drop) at targets in sight within `range`, and keeps away when nearer than 60 % of it; still strikes in melee when cornered. Not for passive creatures |
| `onHit` | `{ "effect", "level", "seconds" }`: a status effect its blows give |
| `boss` | a health bar for players within 48 blocks, 15 % knockback, never despawns |
| `summon` | `{ "item", "on": [blocks] }`: using the item on one of the blocks calls the creature up above it (one of a kind within 64 blocks; the item is used up in survival). Give such creatures `spawn.weight` 0 so they never spawn by themselves |

Creatures in the pack: Grazer, Cluckling, Bristleback (animals), Shambler,
Cave Crawler (its bite poisons), Bone Archer (ranged, burns in daylight),
Cinder Wraith (underworld), Sky Wisp (flying, sky islands at night), River
Fish (swimming; raw fish grills in the furnace) and the Ember Warden boss
(200 health, arrows and slowing blows, summoned with an Ember Sigil —
ember dust, ember quartz and a sun shard — on cinderstone or emberglass;
drops a Warden Core). Structures declare placement
(`surface` with `yOffset`, or `underground` between `minY` and `maxY`),
biomes, grid `spacing` and `chance`, a character `palette`, `layers` (bottom
to top, rows along z, characters along x; space keeps terrain, `.` is air)
and a `loot` table for their chests.

## achievements/

An achievement has a `key`, `name`, `description`, an `icon` item, `xp`
awarded, an optional `parent` (its place in the tree) and a `trigger`:
`{ "kind", "target"?, "count"? }` where kind is `mine` / `place` (block
keys), `craft` / `smelt` / `eat` (item keys), `kill` (mob keys) or `enter`
(`overworld`, `underworld`, `sky`); without a target any counts; `count`
defaults to 1. Targets and parents are checked at load. Players earn each
once; lifetime counters are kept per player (the same triggers drive quests
and jobs).

## jobs/ and quests/

A job has a `key`, `name`, `description`, `icon` and `pays`: a list of
`{ "trigger", "cents" }` — every action matching the trigger (its `count`
is ignored) earns `cents` hundredths of a Crown to the player who took up
the job. A quest has an `objective` trigger (with its `count`), `crowns`
and `xp`; each UTC day the server offers three quests from the pool (the
same for everyone, shuffled by the day), each completed once that day.
Crowns are minted by the backend within the daily reward cap.

## villages/

A village names its `center` and `houses` (structures with
`"placement": "village"`, placed only by villages), `minHouses`–`maxHouses`,
the ring `radius`, the `path` block, its `biomes`, and grid `spacing`
(chunks) and `chance`. Structures may name a `foundation` block filled under
their floor down to the terrain. Biomes may name a `tint` (`#rrggbb`,
`#808080` neutral) that blocks with `"tinted": true` take.

## Trade stalls

`trade_stall` (`blocks/60-trade.json`) is a player shop: whoever places it
owns it, stocks its nine slots through a chest-style window and prices each
slot; other players buy priced stacks with Crowns (see API.md and
NETWORK_PROTOCOL.md). Crafted from three sticks over planks, a chest and
planks.

## Adding a content kind

1. Schema structs in `crates/content/src/defs.rs` (`deny_unknown_fields`).
2. Loading and cross-reference validation in `registry.rs`, with a test that
   a broken reference is reported.
3. Data in `platform/game/<kind>/`.
4. The server behaviour that reads it.
5. A section in this document.
