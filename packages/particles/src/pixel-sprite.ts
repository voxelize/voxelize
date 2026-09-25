import { CanvasTexture, NearestFilter, SRGBColorSpace } from "three";

/**
 * Pixel art for effects, baked the way block textures are drawn: whole
 * texels in flat colours, sampled nearest with no mipmaps, so a spark or a
 * puff sits beside the blocks as a sprite of the same grain instead of a
 * smooth gradient that outclasses them.
 */

/**
 * One string per row, top row first. Each character names a colour in the
 * palette; `.` and ` ` are transparent texels.
 */
export type PixelGrid = readonly string[];

/** Single-character keys to CSS colours (`#rrggbb`, `rgba(...)`, ...). */
export type PixelPalette = Readonly<Record<string, string>>;

/** A parsed grid: the colour of every texel, row-major, null where clear. */
export type PixelCells = {
  width: number;
  height: number;
  cells: readonly (string | null)[];
};

/** The slice of a 2D context the baker draws with. */
export type PixelContext = {
  fillStyle: unknown;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
};

/** A canvas the baker can paint and hand to three as a texture image. */
export type PixelCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): PixelContext | null;
};

export type PixelCanvasFactory = (width: number, height: number) => PixelCanvas;

const TRANSPARENT = new Set([".", " "]);

/**
 * Checks a grid against its palette and resolves every texel. A ragged row
 * or a character the palette does not name throws with its row and column:
 * a typo in sprite art must not bake as a hole nobody notices.
 */
export function parsePixelGrid(
  grid: PixelGrid,
  palette: PixelPalette,
): PixelCells {
  if (grid.length === 0 || grid[0].length === 0) {
    throw new Error("[pixel-sprite] a sprite needs at least one texel");
  }
  for (const key of Object.keys(palette)) {
    if (key.length !== 1 || TRANSPARENT.has(key)) {
      throw new Error(
        `[pixel-sprite] palette key "${key}" must be one character other ` +
          'than "." or " "',
      );
    }
  }
  const width = grid[0].length;
  const cells: (string | null)[] = [];
  grid.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(
        `[pixel-sprite] row ${y} is ${row.length} texels wide, expected ${width}`,
      );
    }
    for (let x = 0; x < width; x += 1) {
      const key = row[x];
      if (TRANSPARENT.has(key)) {
        cells.push(null);
        continue;
      }
      const colour = palette[key];
      if (colour === undefined) {
        throw new Error(
          `[pixel-sprite] "${key}" at row ${y}, column ${x} is not in the palette`,
        );
      }
      cells.push(colour);
    }
  });
  return { width, height: grid.length, cells };
}

/**
 * Paints parsed texels one rectangle per horizontal run of a colour, so a
 * 16x16 sprite is a few dozen fills rather than 256.
 */
export function paintPixelCells(context: PixelContext, sprite: PixelCells) {
  context.clearRect(0, 0, sprite.width, sprite.height);
  for (let y = 0; y < sprite.height; y += 1) {
    let x = 0;
    while (x < sprite.width) {
      const colour = sprite.cells[y * sprite.width + x];
      if (colour === null) {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (
        end < sprite.width &&
        sprite.cells[y * sprite.width + end] === colour
      ) {
        end += 1;
      }
      context.fillStyle = colour;
      context.fillRect(x, y, end - x, 1);
      x = end;
    }
  }
}

const createDomCanvas: PixelCanvasFactory = (width, height) => {
  if (typeof document === "undefined") {
    throw new Error(
      "[pixel-sprite] no document to make a canvas with; pass createCanvas",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as PixelCanvas;
};

export type BakePixelSpriteOptions = {
  /** Where the canvas comes from; defaults to `document.createElement`. */
  createCanvas?: PixelCanvasFactory;
};

/**
 * Bakes a grid into a texture at one canvas pixel per texel: nearest
 * filtering both ways and no mipmaps, so it never blurs into a gradient up
 * close or smears into mush far away. sRGB, like every colour in the pack.
 */
export function bakePixelSprite(
  grid: PixelGrid,
  palette: PixelPalette,
  options: BakePixelSpriteOptions = {},
): CanvasTexture {
  const sprite = parsePixelGrid(grid, palette);
  const canvas = (options.createCanvas ?? createDomCanvas)(
    sprite.width,
    sprite.height,
  );
  const context = canvas.getContext("2d");
  if (!context) throw new Error("[pixel-sprite] no 2d context to bake with");
  paintPixelCells(context, sprite);
  const texture = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The silhouette of a burst sprite: a lumpy `puff` (smoke, dust, a pop), a
 * four-point `star` (a flash, a glint), a round `disc`, or a hollow `ring`
 * (a shockwave, a halo).
 */
export type PixelBurstShape = "puff" | "star" | "disc" | "ring";

export type PixelBurstOptions = {
  /** Edge of the sprite in texels. */
  texels: number;
  /**
   * Flat colour bands from the centre outward (for a ring, from its inner
   * edge outward). Each covers an equal step of the radius: stepped colour,
   * never a gradient.
   */
  bands: readonly string[];
  /** Defaults to `puff`. */
  shape?: PixelBurstShape;
  /** A ring's thickness in texels; defaults to a quarter of its radius. */
  ringTexels?: number;
  /** Turns a puff's lumps, so two puffs from one palette differ. */
  phase?: number;
};

/** Keys for up to 36 bands: 0-9 then a-z. */
const BAND_KEYS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * The grid and palette of a burst sprite, before baking: each texel inside
 * the silhouette takes the band its distance from the centre falls in.
 */
export function pixelBurstGrid(options: PixelBurstOptions): {
  grid: string[];
  palette: Record<string, string>;
} {
  const { texels, bands } = options;
  const shape = options.shape ?? "puff";
  if (!Number.isInteger(texels) || texels < 2) {
    throw new Error(`[pixel-sprite] a burst needs >= 2 texels, got ${texels}`);
  }
  if (bands.length === 0 || bands.length > BAND_KEYS.length) {
    throw new Error(
      `[pixel-sprite] a burst takes 1-${BAND_KEYS.length} bands, got ${bands.length}`,
    );
  }
  const palette: Record<string, string> = {};
  bands.forEach((colour, i) => {
    palette[BAND_KEYS[i]] = colour;
  });

  const half = texels / 2;
  const phase = options.phase ?? 1;
  const ringFraction = Math.min(
    1,
    Math.max(1 / half, (options.ringTexels ?? half / 4) / half),
  );
  const grid: string[] = [];
  for (let y = 0; y < texels; y += 1) {
    let row = "";
    for (let x = 0; x < texels; x += 1) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const angle = Math.atan2(dy, dx);
      const reach =
        shape === "star"
          ? 0.5 + 0.5 * Math.abs(Math.cos(2 * angle)) ** 4
          : shape === "puff"
            ? 0.86 + 0.14 * Math.cos(5 * angle + phase)
            : 1;
      const r = Math.hypot(dx, dy) / half / reach;
      if (r >= 1) {
        row += ".";
        continue;
      }
      let t = r;
      if (shape === "ring") {
        const inner = 1 - ringFraction;
        if (r < inner) {
          row += ".";
          continue;
        }
        t = (r - inner) / ringFraction;
      }
      row +=
        BAND_KEYS[Math.min(bands.length - 1, Math.floor(t * bands.length))];
    }
    grid.push(row);
  }
  return { grid, palette };
}

/** {@link pixelBurstGrid}, baked. */
export function pixelBurstTexture(
  options: PixelBurstOptions,
  bakeOptions: BakePixelSpriteOptions = {},
): CanvasTexture {
  const { grid, palette } = pixelBurstGrid(options);
  return bakePixelSprite(grid, palette, bakeOptions);
}
