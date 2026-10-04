// Original block textures, drawn procedurally at load time.
//
// Every texture is a deterministic function of its name: a small pixel-art
// recipe (base palette + pattern) seeded by a hash of the name, so the art
// is ours, reproducible, and needs no image files. Unknown names get a
// distinct speckled colour derived from the name, never a blank face.

export type RGBA = [number, number, number, number];

export const SIZE = 16;

function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, seeded, deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(color: string, alpha = 255): RGBA {
  const v = parseInt(color.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, alpha];
}

function shade([r, g, b, a]: RGBA, amount: number): RGBA {
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + amount))));
  return [f(r), f(g), f(b), a];
}

class Pixels {
  readonly data: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(new ArrayBuffer(SIZE * SIZE * 4));
  constructor(readonly random: () => number) {}

  set(x: number, y: number, c: RGBA) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  /** Base colour with per-pixel brightness jitter. */
  speckle(base: RGBA, jitter: number) {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) this.set(x, y, shade(base, (this.random() - 0.5) * 2 * jitter));
  }

  /** Scattered blobs of a colour (ore veins, pebbles). */
  blobs(color: RGBA, count: number, radius = 1) {
    for (let n = 0; n < count; n++) {
      const cx = Math.floor(this.random() * SIZE);
      const cy = Math.floor(this.random() * SIZE);
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++)
          if (dx * dx + dy * dy <= radius * radius + this.random())
            this.set(cx + dx, cy + dy, shade(color, (this.random() - 0.5) * 0.3));
    }
  }

  /** Vertical streaks (bark, cactus ribs). */
  streaks(color: RGBA, every: number, jitter = 0.15) {
    for (let x = 0; x < SIZE; x += every)
      for (let y = 0; y < SIZE; y++) if (this.random() > 0.2) this.set(x, y, shade(color, (this.random() - 0.5) * jitter));
  }

  /** Horizontal boards with seams (planks). */
  boards(base: RGBA, height: number) {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const seam = y % height === height - 1;
        const offset = Math.floor(y / height) % 2 === 0 ? 0 : 8;
        const join = (x + offset) % 16 === 0;
        this.set(x, y, shade(base, seam || join ? -0.3 : (this.random() - 0.5) * 0.12));
      }
  }

  /** Concentric rings (log ends). */
  rings(inner: RGBA, bark: RGBA) {
    const c = (SIZE - 1) / 2;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const d = Math.max(Math.abs(x - c), Math.abs(y - c));
        if (d > 6.5) this.set(x, y, shade(bark, (this.random() - 0.5) * 0.2));
        else this.set(x, y, shade(inner, Math.floor(d) % 2 === 0 ? -0.12 : 0.05));
      }
  }

  border(color: RGBA) {
    for (let i = 0; i < SIZE; i++) {
      this.set(i, 0, color);
      this.set(i, SIZE - 1, color);
      this.set(0, i, color);
      this.set(SIZE - 1, i, color);
    }
  }

  clear() {
    this.data.fill(0);
  }
}

const STONE = hex("#7e8085");
const DIRT = hex("#7a5232");
const TURF = hex("#5c9a3b");
const BARK_OAK = hex("#6b4a2b");
const BARK_SPRUCE = hex("#45301d");
const PLANK = hex("#b58f58");

type Recipe = (p: Pixels) => void;

const ore = (color: string, count = 5): Recipe => (p) => {
  p.speckle(STONE, 0.12);
  p.blobs(hex(color), count, 1);
};

const RECIPES: Record<string, Recipe> = {
  stone: (p) => p.speckle(STONE, 0.12),
  rubble: (p) => {
    p.speckle(shade(STONE, -0.1), 0.1);
    p.blobs(shade(STONE, 0.15), 9, 2);
    p.blobs(shade(STONE, -0.35), 6, 0);
  },
  bedrock: (p) => {
    p.speckle(hex("#3a3a40"), 0.35);
    p.blobs(hex("#1c1c20"), 8, 1);
  },
  dirt: (p) => {
    p.speckle(DIRT, 0.15);
    p.blobs(shade(DIRT, -0.3), 5, 0);
  },
  turf_top: (p) => {
    p.speckle(TURF, 0.18);
    p.blobs(shade(TURF, 0.2), 6, 0);
  },
  turf_side: (p) => {
    p.speckle(DIRT, 0.15);
    for (let x = 0; x < SIZE; x++) {
      const depth = 3 + Math.floor(p.random() * 3);
      for (let y = 0; y < depth; y++) p.set(x, y, shade(TURF, (p.random() - 0.5) * 0.3));
    }
  },
  sand: (p) => p.speckle(hex("#dccb8e"), 0.08),
  red_sand: (p) => p.speckle(hex("#b65d2f"), 0.1),
  gravel: (p) => {
    p.speckle(hex("#8a8580"), 0.15);
    p.blobs(hex("#6b6763"), 10, 1);
    p.blobs(hex("#a9a39b"), 6, 0);
  },
  clay: (p) => p.speckle(hex("#9da3b3"), 0.06),
  fired_clay: (p) => p.speckle(hex("#a1593b"), 0.06),
  sandstone_side: (p) => {
    p.speckle(hex("#d6c286"), 0.06);
    for (let x = 0; x < SIZE; x++) {
      p.set(x, 4, hex("#c2ad72"));
      p.set(x, 11, hex("#c2ad72"));
    }
  },
  sandstone_top: (p) => p.speckle(hex("#dccb8e"), 0.05),
  snowpack: (p) => p.speckle(hex("#eef3f8"), 0.04),
  ice: (p) => {
    p.speckle(hex("#9cc8f2", 210), 0.06);
    for (let i = 2; i < 13; i++) p.set(i, i + 1, hex("#d7ecff", 220));
  },
  water: (p) => {
    p.speckle(hex("#2f64c8", 190), 0.08);
    for (let y = 2; y < SIZE; y += 5) for (let x = 0; x < SIZE; x++) if ((x + y) % 7 < 3) p.set(x, y, hex("#5d8ee0", 200));
  },
  lava: (p) => {
    p.speckle(hex("#d9531a"), 0.15);
    p.blobs(hex("#ffb12e"), 7, 1);
    p.blobs(hex("#8f2410"), 4, 0);
  },
  farmland_top: (p) => {
    p.speckle(shade(DIRT, -0.25), 0.1);
    for (let y = 1; y < SIZE; y += 4) for (let x = 0; x < SIZE; x++) p.set(x, y, shade(DIRT, -0.5));
  },
  coal_ore: ore("#1f1f22", 6),
  iron_ore: ore("#d3a98b"),
  copper_ore: (p) => {
    ore("#c46c38")(p);
    p.blobs(hex("#4fa58a"), 2, 0);
  },
  gold_ore: ore("#f0cf45", 4),
  lumenite_ore: (p) => {
    p.speckle(shade(STONE, -0.2), 0.1);
    p.blobs(hex("#5ff0e0"), 4, 1);
    p.blobs(hex("#d6fffb"), 3, 0);
  },
  oak_log_side: (p) => {
    p.speckle(BARK_OAK, 0.1);
    p.streaks(shade(BARK_OAK, -0.3), 3);
  },
  oak_log_top: (p) => p.rings(hex("#b8905a"), BARK_OAK),
  spruce_log_side: (p) => {
    p.speckle(BARK_SPRUCE, 0.1);
    p.streaks(shade(BARK_SPRUCE, -0.35), 2);
  },
  spruce_log_top: (p) => p.rings(hex("#9c7646"), BARK_SPRUCE),
  oak_leaves: (p) => {
    p.speckle(hex("#3e7e2c"), 0.25);
    for (let n = 0; n < 22; n++) p.set(Math.floor(p.random() * SIZE), Math.floor(p.random() * SIZE), [0, 0, 0, 0]);
  },
  spruce_leaves: (p) => {
    p.speckle(hex("#2c5a35"), 0.2);
    for (let n = 0; n < 18; n++) p.set(Math.floor(p.random() * SIZE), Math.floor(p.random() * SIZE), [0, 0, 0, 0]);
  },
  tall_grass: (p) => {
    p.clear();
    for (let blade = 0; blade < 7; blade++) {
      const x = 1 + Math.floor(p.random() * 14);
      const h = 6 + Math.floor(p.random() * 9);
      for (let y = 0; y < h; y++) p.set(x + (y > h - 3 && blade % 2 ? 1 : 0), SIZE - 1 - y, shade(TURF, 0.1 + (p.random() - 0.5) * 0.3));
    }
  },
  wheat_stage: (p) => {
    p.clear();
    for (let x = 1; x < SIZE; x += 3) {
      for (let y = 4; y < SIZE; y++) p.set(x, y, hex("#9fb84a"));
      for (let y = 1; y < 5; y++) p.set(x, y, hex("#e2c25a"));
    }
  },
  carrot_stage: (p) => {
    p.clear();
    for (let x = 2; x < SIZE; x += 4) {
      for (let y = 6; y < SIZE; y++) p.set(x + (y % 3 === 0 ? 1 : 0), y, hex("#5f9e3a"));
      for (let y = 3; y < 7; y++) p.set(x + (y % 2), y, hex("#78b84a"));
      p.set(x, SIZE - 1, hex("#e07b26"));
    }
  },
  potato_stage: (p) => {
    p.clear();
    for (let x = 1; x < SIZE; x += 5) {
      for (let y = 7; y < SIZE; y++) p.set(x + 1, y, hex("#4f8a35"));
      p.blobs(hex("#5f9e3a"), 2, 1);
      p.set(x + 1, SIZE - 1, hex("#c9a46a"));
      p.set(x + 2, SIZE - 1, hex("#b08a52"));
    }
  },
  oak_sapling: (p) => {
    p.clear();
    for (let y = 8; y < SIZE; y++) p.set(7, y, hex("#6b4a2b"));
    p.blobs(hex("#4f8f34"), 5, 2);
    for (let y = 0; y < 8; y++) for (let x = 0; x < SIZE; x++) if ((x - 7) ** 2 + (y - 5) ** 2 > 22) p.set(x, y, [0, 0, 0, 0]);
    for (let y = 9; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (x !== 7) p.set(x, y, [0, 0, 0, 0]);
  },
  spruce_sapling: (p) => {
    p.clear();
    for (let y = 2; y < SIZE; y++) {
      p.set(7, y, hex("#45301d"));
      const w = Math.floor((y - 2) / 3);
      if (y < 13) for (let x = 7 - w; x <= 7 + w; x++) if (x !== 7) p.set(x, y, hex("#2c5a35"));
    }
  },
  cactus_side: (p) => {
    p.speckle(hex("#3f8a3a"), 0.08);
    p.streaks(hex("#2d6a2b"), 4, 0.05);
    p.blobs(hex("#e8e3c0"), 5, 0);
  },
  cactus_top: (p) => {
    p.speckle(hex("#4c9a45"), 0.06);
    p.border(hex("#2d6a2b"));
  },
  planks: (p) => p.boards(PLANK, 4),
  glass: (p) => {
    p.clear();
    p.border(hex("#cfe6f2", 230));
    for (let i = 3; i < 7; i++) p.set(i, 9 - i, hex("#ffffff", 160));
  },
  torch: (p) => {
    p.clear();
    for (let y = 6; y < SIZE; y++) {
      p.set(7, y, hex("#7a5432"));
      p.set(8, y, hex("#6a4729"));
    }
    for (let y = 3; y < 6; y++) for (let x = 6; x < 10; x++) p.set(x, y, hex(y === 3 ? "#ffe9a3" : "#ff9a2e"));
  },
  workbench_top: (p) => {
    p.boards(shade(PLANK, -0.05), 16);
    p.border(shade(PLANK, -0.45));
    for (let i = 3; i < 13; i++) {
      p.set(i, 5, hex("#6f6f74"));
      p.set(5, i, hex("#6f6f74"));
    }
  },
  workbench_side: (p) => {
    p.boards(PLANK, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, shade(PLANK, -0.35));
  },
  furnace_side: (p) => {
    p.speckle(shade(STONE, -0.05), 0.1);
    p.border(shade(STONE, -0.4));
    for (let y = 8; y < 13; y++) for (let x = 4; x < 12; x++) p.set(x, y, hex("#262224"));
  },
  furnace_top: (p) => {
    p.speckle(shade(STONE, -0.05), 0.1);
    p.border(shade(STONE, -0.4));
  },
  chest: (p) => {
    p.boards(shade(PLANK, -0.15), 5);
    p.border(shade(PLANK, -0.5));
    for (let y = 6; y < 9; y++) for (let x = 7; x < 9; x++) p.set(x, y, hex("#c9c9cf"));
  },
  voltite_ore: ore("#d9364a", 6),
  // Circuit pieces: original flat designs, all drawn in code.
  conduit: (p) => {
    p.clear();
    for (let x = 0; x < SIZE; x++) for (let y = 6; y < 10; y++) p.set(x, y, shade(hex("#8c1f2b"), (p.random() - 0.5) * 0.2));
    for (let y = 0; y < SIZE; y++) for (let x = 6; x < 10; x++) p.set(x, y, shade(hex("#8c1f2b"), (p.random() - 0.5) * 0.2));
  },
  lever_top: (p) => {
    p.speckle(shade(STONE, 0.05), 0.08);
    p.border(shade(STONE, -0.4));
    for (let i = 3; i < 13; i++) p.set(i, 15 - i, hex("#7a5432"));
    for (let y = 2; y < 5; y++) for (let x = 11; x < 14; x++) p.set(x, y, hex("#d9364a"));
  },
  button_top: (p) => {
    p.speckle(shade(STONE, 0.05), 0.08);
    for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) p.set(x, y, shade(STONE, y === 5 ? 0.25 : -0.1));
  },
  pressure_plate: (p) => {
    p.speckle(shade(STONE, 0.12), 0.06);
    p.border(shade(STONE, -0.3));
  },
  clock_side: (p) => {
    p.speckle(hex("#5a4636"), 0.08);
    p.border(hex("#3a2b20"));
    for (let i = 4; i < 12; i++) p.set(i, 8, hex("#d9364a"));
  },
  clock_top: (p) => {
    p.speckle(hex("#5a4636"), 0.08);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) if ((x - 7.5) ** 2 + (y - 7.5) ** 2 < 25) p.set(x, y, hex("#e8e0c8"));
    for (let i = 0; i < 5; i++) p.set(8, 8 - i, hex("#262224"));
    for (let i = 0; i < 4; i++) p.set(8 + i, 8, hex("#d9364a"));
  },
  lamp_off: (p) => {
    p.speckle(hex("#6a5a3a"), 0.1);
    p.border(hex("#3f3524"));
    for (let i = 0; i < SIZE; i += 5) for (let j = 0; j < SIZE; j++) {
      p.set(i, j, hex("#3f3524"));
      p.set(j, i, hex("#3f3524"));
    }
  },
  lamp_on: (p) => {
    p.speckle(hex("#ffd36b"), 0.1);
    p.border(hex("#a8742a"));
    for (let i = 0; i < SIZE; i += 5) for (let j = 0; j < SIZE; j++) {
      p.set(i, j, hex("#a8742a"));
      p.set(j, i, hex("#a8742a"));
    }
  },
  repeater_side: (p) => {
    p.speckle(shade(STONE, 0.1), 0.06);
    for (let x = 0; x < SIZE; x++) p.set(x, 7, hex("#8c1f2b"));
  },
  repeater_top: (p) => {
    p.speckle(shade(STONE, 0.1), 0.06);
    for (let y = 0; y < SIZE; y++) p.set(7, y, hex("#8c1f2b"));
    for (let i = 0; i < 5; i++) {
      p.set(7 - i, 3 + i, hex("#d9364a"));
      p.set(7 + i, 3 + i, hex("#d9364a"));
    }
  },
  inverter_side: (p) => {
    p.speckle(shade(STONE, -0.05), 0.06);
    for (let x = 0; x < SIZE; x++) p.set(x, 7, hex("#3a5fb0"));
  },
  inverter_top: (p) => {
    p.speckle(shade(STONE, -0.05), 0.06);
    for (let y = 0; y < SIZE; y++) p.set(7, y, hex("#3a5fb0"));
    for (let y = 2; y < 6; y++) for (let x = 5; x < 10; x++) if ((x - 7) ** 2 + (y - 3.5) ** 2 < 5) p.set(x, y, hex("#d9364a"));
  },
  gate_closed: (p) => {
    p.boards(shade(PLANK, -0.1), 4);
    p.border(shade(PLANK, -0.5));
    for (let y = 7; y < 9; y++) for (let x = 11; x < 13; x++) p.set(x, y, hex("#c9c9cf"));
  },
  gate_open: (p) => {
    p.clear();
    p.border(shade(PLANK, -0.4));
  },
  actuator_side: (p) => {
    p.speckle(shade(STONE, -0.08), 0.1);
    for (let y = 0; y < 4; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, shade(PLANK, -0.1));
  },
  actuator_front: (p) => {
    p.boards(PLANK, 4);
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) p.set(x, y, shade(STONE, -0.3));
  },
  door_lower: (p) => {
    p.boards(shade(PLANK, -0.05), 4);
    p.border(shade(PLANK, -0.5));
    for (let y = 1; y < 3; y++) for (let x = 11; x < 13; x++) p.set(x, y, hex("#c9c9cf"));
  },
  door_upper: (p) => {
    p.boards(shade(PLANK, -0.05), 4);
    p.border(shade(PLANK, -0.5));
    for (let y = 3; y < 9; y++) for (let x = 3; x < 13; x++) p.set(x, y, [170, 205, 225, 140]);
  },
  door_lower_open: (p) => {
    p.clear();
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < 3; x++) p.set(x, y, shade(PLANK, -0.2));
  },
  door_upper_open: (p) => {
    p.clear();
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < 3; x++) p.set(x, y, shade(PLANK, -0.2));
  },
  grip_front: (p) => {
    p.boards(PLANK, 4);
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) p.set(x, y, hex("#d8e0c8"));
  },
  watcher_side: (p) => {
    p.speckle(shade(STONE, -0.25), 0.12);
    for (let x = 0; x < SIZE; x++) p.set(x, 7, hex("#8a3a2a"));
  },
  watcher_face: (p) => {
    p.speckle(shade(STONE, -0.25), 0.12);
    for (let y = 5; y < 11; y++) for (let x = 3; x < 13; x++) p.set(x, y, hex("#1c1c22"));
    for (let y = 7; y < 9; y++) for (let x = 6; x < 10; x++) p.set(x, y, hex("#e0473a"));
  },
  gauge_top: (p) => {
    p.speckle(shade(STONE, 0.05), 0.08);
    for (const [x, y] of [[3, 3], [12, 3], [7, 12]]) for (let d = 0; d < 2; d++) p.set(x + d, y, hex("#e0473a"));
    for (let i = 4; i < 12; i++) p.set(i, 7, hex("#7a7a80"));
  },
  // Underworld and portals.
  riftstone: (p) => {
    p.speckle(hex("#1d1426"), 0.18);
    p.blobs(hex("#4a2d6b"), 6, 1);
    p.blobs(hex("#0c0812"), 5, 0);
  },
  rift: (p) => {
    p.clear();
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const swirl = Math.sin((x + y) * 0.7) + Math.cos((x - y) * 0.5);
        p.set(x, y, shade(hex("#8a3cff", 170), swirl * 0.2 + (p.random() - 0.5) * 0.2));
      }
  },
  cinderstone: (p) => {
    p.speckle(hex("#6e2b25"), 0.16);
    p.blobs(hex("#4a1a17"), 8, 1);
    p.blobs(hex("#8c3a2e"), 5, 0);
  },
  emberglass: (p) => {
    p.speckle(hex("#f2b54a"), 0.12);
    p.blobs(hex("#fff0b3"), 6, 1);
    p.border(hex("#b8742a"));
  },
  ember_quartz_ore: (p) => {
    p.speckle(hex("#6e2b25"), 0.16);
    p.blobs(hex("#f3e6da"), 5, 1);
  },
  // Sky dimension and its portal.
  skystone: (p) => {
    p.speckle(hex("#d9e6f2"), 0.1);
    p.blobs(hex("#8fb8e8"), 6, 1);
    p.blobs(hex("#f6e7a8"), 4, 0);
  },
  sky_rift: (p) => {
    p.clear();
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const swirl = Math.sin((x - y) * 0.6) + Math.cos((x + y) * 0.4);
        p.set(x, y, shade(hex("#7fd4ff", 170), swirl * 0.18 + (p.random() - 0.5) * 0.2));
      }
  },
  cloudrock: (p) => {
    p.speckle(hex("#c9ccd6"), 0.12);
    p.blobs(hex("#aeb3c2"), 7, 1);
    p.blobs(hex("#e4e7ef"), 5, 0);
  },
  cloud: (p) => {
    p.speckle(hex("#f7f9fc"), 0.04);
    p.blobs(hex("#e6ecf5"), 4, 1);
  },
  sunstone_ore: (p) => {
    p.speckle(hex("#c9ccd6"), 0.12);
    p.blobs(hex("#ffd34a"), 5, 1);
    p.blobs(hex("#fff3b0"), 3, 0);
  },
  fire: (p) => {
    p.clear();
    for (let x = 0; x < SIZE; x++) {
      const h = 6 + Math.floor(p.random() * 9);
      for (let y = SIZE - h; y < SIZE; y++) {
        const t = (y - (SIZE - h)) / h;
        p.set(x, y, hex(t < 0.3 ? "#ffe066" : t < 0.65 ? "#ff9a1f" : "#d9401a", 220));
      }
    }
  },
  blast_charge_side: (p) => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, shade(hex("#b8322a"), (x % 4 === 0 ? -0.2 : 0) + (p.random() - 0.5) * 0.08));
    for (let y = 6; y < 10; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, hex("#e8e0c8"));
  },
  blast_charge_top: (p) => {
    p.speckle(hex("#b8322a"), 0.08);
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) p.set(x, y, hex("#2b2b2b"));
  },
  anvil_side: (p) => {
    p.speckle(hex("#3d4048"), 0.08);
    for (let y = 0; y < 4; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, shade(hex("#55595f"), (p.random() - 0.5) * 0.1));
    for (let y = 4; y < 12; y++) for (let x = 0; x < SIZE; x++) if (x < 5 || x > 10) p.set(x, y, hex("#000000", 0));
    p.border(hex("#26282d"));
  },
  anvil_top: (p) => {
    p.speckle(hex("#4a4e55"), 0.08);
    for (let y = 6; y < 10; y++) for (let x = 1; x < 15; x++) p.set(x, y, shade(hex("#6a6f77"), (p.random() - 0.5) * 0.1));
    p.border(hex("#26282d"));
  },
  siege_banner: (p) => {
    p.clear();
    for (let y = 0; y < SIZE; y++) for (let x = 7; x < 9; x++) p.set(x, y, shade(PLANK, -0.3));
    for (let y = 1; y < 11; y++) for (let x = 2; x < 14; x++) if (x < 7 || x > 8) p.set(x, y, shade(hex("#8a1f1f"), (p.random() - 0.5) * 0.15));
    for (let x = 2; x < 14; x++) p.set(x, 1, hex("#d9b04a"));
  },
  // Guild buildings.
  guild_hall_side: (p) => {
    p.boards(shade(PLANK, -0.15), 4);
    for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) p.set(x, y, hex(y < 7 ? "#d9b04a" : "#4a2f1a"));
    p.border(hex("#3b2614"));
  },
  guild_hall_top: (p) => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, shade(hex("#8a2a22"), ((x + y) % 4 === 0 ? -0.15 : 0) + (p.random() - 0.5) * 0.08));
    p.border(hex("#d9b04a"));
  },
  guild_vault_side: (p) => {
    p.speckle(hex("#5e6470"), 0.1);
    p.border(hex("#2c3038"));
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) p.set(x, y, hex(x === 7 || x === 8 ? "#d9b04a" : "#3a3f48"));
  },
  guild_vault_top: (p) => {
    p.speckle(hex("#5e6470"), 0.1);
    p.border(hex("#2c3038"));
  },
  // Trade stall: striped awning on top, a counter on the sides.
  stall_top: (p) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) p.set(x, y, shade(hex(Math.floor(x / 4) % 2 ? "#e8e0c8" : "#b8322a"), (p.random() - 0.5) * 0.1));
    p.border(hex("#6b4a2b"));
  },
  stall_side: (p) => {
    p.boards(shade(PLANK, -0.05), 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < SIZE; x++) p.set(x, y, hex(Math.floor(x / 4) % 2 ? "#e8e0c8" : "#b8322a"));
    for (let x = 2; x < 14; x++) p.set(x, 9, hex("#d9b04a"));
  },
};

/** RGBA pixels (16x16) of a named texture. Pure and deterministic. */
export function texturePixels(name: string): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Pixels(rng(hashString(name)));
  const recipe = RECIPES[name];
  if (recipe) {
    recipe(pixels);
  } else {
    const h = hashString(name);
    pixels.speckle([(h >> 16) & 255, (h >> 8) & 255, h & 255, 255], 0.15);
  }
  return pixels.data;
}

export function hasRecipe(name: string): boolean {
  return name in RECIPES;
}

/** The texture as a canvas, for the engine's texture atlas. */
export function textureCanvas(name: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  context.putImageData(new ImageData(texturePixels(name), SIZE, SIZE), 0, 0);
  return canvas;
}
