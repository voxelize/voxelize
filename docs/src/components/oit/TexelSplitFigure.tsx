import { useEffect, useMemo, useRef, useState } from "react";

import { Choice, Figure, Slider } from "./ui";

const SIZE = 16;
const HOLE_ALPHA = 0.1;

type Texel = [number, number, number, number];
type TextureId = "stained" | "glass" | "leaves" | "soft" | "ice";

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function makeTexture(id: TextureId): Texel[] {
  const texels: Texel[] = [];
  const rand = random(id.length * 7919 + 17);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const edge = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
      if (id === "stained") {
        const lead = edge || x === 7 || x === 8 || (y + x) % 8 === 0;
        const pane = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
        texels.push(
          lead
            ? [38, 34, 30, 255]
            : pane
              ? [56, 182, 104, 150]
              : [214, 64, 82, 150],
        );
      } else if (id === "glass") {
        const streak = (x === y + 2 || x === y + 3) && x > 3 && x < 12;
        texels.push(
          edge
            ? [210, 228, 236, 255]
            : streak
              ? [246, 252, 255, 255]
              : [0, 0, 0, 0],
        );
      } else if (id === "ice") {
        const crack = (x * 3 + y * 5) % 11 === 0;
        texels.push(crack ? [228, 244, 255, 190] : [150, 196, 232, 140]);
      } else {
        const isLeaf = rand() > 0.32;
        const shade = 70 + Math.floor(rand() * 60);
        texels.push(isLeaf ? [40, shade + 40, 36, 255] : [0, 0, 0, 0]);
      }
    }
  }
  if (id === "soft") {
    const at = (x: number, y: number) => texels[y * SIZE + x];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (at(x, y)[3] !== 0) continue;
        const nearLeaf = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(
          ([dx, dy]) =>
            at((x + dx + SIZE) % SIZE, (y + dy + SIZE) % SIZE)[3] === 255,
        );
        if (nearLeaf && (x + y) % 2 === 0)
          texels[y * SIZE + x] = [52, 118, 44, 120];
      }
    }
  }
  return texels;
}

const TEXTURES: { id: TextureId; label: string; isCutout: boolean }[] = [
  { id: "stained", label: "Stained glass", isCutout: false },
  { id: "glass", label: "Clear glass", isCutout: false },
  { id: "leaves", label: "Leaves", isCutout: true },
  { id: "soft", label: "Soft-edged leaves", isCutout: true },
  { id: "ice", label: "Ice", isCutout: false },
];

type Kind = "solid" | "translucent" | "hole";
const kindOf = (alpha: number, solid: number): Kind =>
  alpha >= solid * 255
    ? "solid"
    : alpha >= HOLE_ALPHA * 255
      ? "translucent"
      : "hole";

function TexelCanvas({
  texels,
  keep,
}: {
  texels: Texel[];
  keep: (t: Texel) => boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(SIZE, SIZE);
    texels.forEach((texel, i) => {
      const shown = keep(texel);
      image.data.set(shown ? texel : [0, 0, 0, 0], i * 4);
    });
    context.putImageData(image, 0, 0);
  }, [texels, keep]);
  return (
    <canvas
      ref={ref}
      width={SIZE}
      height={SIZE}
      className="oit-texture"
      style={{
        background:
          "repeating-conic-gradient(#d8d8d8 0 25%, #f4f4f4 0 50%) 50% / 25% 25%",
      }}
    />
  );
}

export default function TexelSplitFigure() {
  const [textureId, setTextureId] = useState<TextureId>("stained");
  const [solid, setSolid] = useState(0.99);
  const texture = TEXTURES.find((t) => t.id === textureId) ?? TEXTURES[0];
  const [isCutout, setIsCutout] = useState(texture.isCutout);
  const texels = useMemo(() => makeTexture(textureId), [textureId]);

  const classes = useMemo(() => {
    const kinds = texels.map((t) => kindOf(t[3], solid));
    return {
      solid: kinds.includes("solid"),
      translucent: kinds.includes("translucent"),
      counts: {
        solid: kinds.filter((k) => k === "solid").length,
        translucent: kinds.filter((k) => k === "translucent").length,
        hole: kinds.filter((k) => k === "hole").length,
      },
    };
  }, [texels, solid]);

  const plan = isCutout
    ? !classes.translucent
      ? "as-is"
      : classes.solid
        ? "split"
        : "translucent"
    : !classes.solid
      ? "as-is"
      : classes.translucent
        ? "split"
        : "solid";

  const draws: Record<string, string> = {
    "as-is": isCutout
      ? "One draw, as before: every kept texel writes depth."
      : "One draw, blended: there is nothing solid to keep crisp.",
    solid: "One draw as a cutout: alpha-tested, writing depth.",
    translucent: "One blended draw, writing no depth.",
    split:
      "Two draws from the same buffers: the solid texels with the depth writers, the translucent ones in the blended band.",
  };

  const keepSolid = useMemo(
    () => (t: Texel) => kindOf(t[3], solid) === "solid",
    [solid],
  );
  const keepTranslucent = useMemo(
    () => (t: Texel) => kindOf(t[3], solid) === "translucent",
    [solid],
  );
  const keepAll = useMemo(
    () => (t: Texel) => kindOf(t[3], solid) !== "hole",
    [solid],
  );

  return (
    <Figure
      title="Split by what the texture holds"
      caption="The world reads each material bucket's textures once per texture write: its blocks' atlas slots, a face's or voxel's own texture, every keyframe of an animated face. A bucket whose texels are all solid or all translucent draws once; only one with both pays for the second draw."
    >
      <div className="flex flex-wrap gap-3 items-center mb-3 text-sm">
        <Choice
          value={textureId}
          options={TEXTURES.map((t) => ({ value: t.id, label: t.label }))}
          onChange={(id) => {
            setTextureId(id);
            setIsCutout(TEXTURES.find((t) => t.id === id)?.isCutout ?? false);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-3 items-center mb-4 text-sm">
        <span className="opacity-60">The block is</span>
        <Choice
          value={isCutout ? "cutout" : "blended"}
          options={[
            { value: "blended", label: "blended (glass-like)" },
            {
              value: "cutout",
              label: "a cutout (transparentStandalone or lightAttenuation > 0)",
            },
          ]}
          onChange={(value) => setIsCutout(value === "cutout")}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="text-xs font-semibold mb-1">The texture</div>
          <TexelCanvas texels={texels} keep={keepAll} />
        </div>
        <div>
          <div className="text-xs font-semibold mb-1">
            Solid · α ≥ {solid.toFixed(2)} · {classes.counts.solid} texels
          </div>
          <TexelCanvas texels={texels} keep={keepSolid} />
        </div>
        <div>
          <div className="text-xs font-semibold mb-1">
            Translucent · {HOLE_ALPHA} ≤ α &lt; {solid.toFixed(2)} ·{" "}
            {classes.counts.translucent} texels
          </div>
          <TexelCanvas texels={texels} keep={keepTranslucent} />
        </div>
      </div>
      <div className="max-w-md mt-3">
        <Slider
          label="solidTexelAlpha"
          value={solid}
          min={0.5}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={setSolid}
        />
      </div>
      <p className="text-sm mt-3 mb-0">
        <strong>
          <code>texelPlanOf</code> → {plan}
        </strong>
        . {draws[plan]}
      </p>
    </Figure>
  );
}
