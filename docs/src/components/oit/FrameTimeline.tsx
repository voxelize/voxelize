import { type ReactNode, useState } from "react";

import { Figure } from "./ui";

type BufferId = "scene" | "depth" | "accum" | "weight" | "water";

type Step = {
  label: string;
  order: string;
  kind: "pass" | "band" | "marker";
  writes: BufferId[];
  reads: BufferId[];
  depth: "write" | "test" | "none";
  blend: string;
  text: ReactNode;
};

const BUFFERS: { id: BufferId; name: string; detail: string }[] = [
  {
    id: "scene",
    name: "Scene colour",
    detail: "the scene target's texture (RGBA8, sRGB)",
  },
  {
    id: "depth",
    name: "Scene depth",
    detail: "its depth texture, shared with the accumulation",
  },
  {
    id: "accum",
    name: "Accumulation",
    detail: "RGBA16F · rgb Σ C·α·w · alpha Π(1 − α)",
  },
  { id: "weight", name: "Weight", detail: "R16F · Σ α·w" },
  {
    id: "water",
    name: "Water depth",
    detail: "the nearest water face, both sides",
  },
];

const STEPS: Step[] = [
  {
    label: "Before the frame",
    order: "prepareTransparency",
    kind: "pass",
    writes: ["water"],
    reads: [],
    depth: "write",
    blend: "none (depth only)",
    text: (
      <>
        <code>world.prepareTransparency(renderer, camera)</code> installs the
        world's banded sort, draws the depth of every water face in view into a
        texture of its own, with the water's own vertex shader so the waves
        match, and arms the accumulation for this camera. Both sides of each
        face: the surface's top is the nearest water from above, its underside
        from below.
      </>
    ),
  },
  {
    label: "Opaque",
    order: "opaque list",
    kind: "pass",
    writes: ["scene", "depth"],
    reads: [],
    depth: "write",
    blend: "none",
    text: <>Terrain, entities, everything solid. Nothing changes here.</>,
  },
  {
    label: "Sky and clouds",
    order: "< 0",
    kind: "band",
    writes: ["scene"],
    reads: ["depth"],
    depth: "test",
    blend: "the material's own",
    text: (
      <>
        Any negative render order keeps its place before everything see-through.
      </>
    ),
  },
  {
    label: "Depth writers",
    order: "−0.75",
    kind: "band",
    writes: ["scene", "depth"],
    reads: [],
    depth: "write",
    blend: "the material's own",
    text: (
      <>
        Every transparent material that writes depth: cutouts (leaves, plants,
        doors), the solid texels of see-through blocks, masks. Their depth hides
        whatever is behind them from every blended layer that follows, which is
        what keeps a lead line in stained glass crisp in front of a pool.
      </>
    ),
  },
  {
    label: "Open",
    order: "−0.5",
    kind: "marker",
    writes: ["accum", "weight"],
    reads: [],
    depth: "none",
    blend: "—",
    text: (
      <>
        A marker mesh that draws nothing. Its <code>onBeforeRender</code> hands
        the scene colour texture to the water (it refracts the target directly,
        no copy), binds the accumulation target (two attachments, the scene's
        depth texture as its depth), clears them to (0, 0, 0, 1) and 0, and from
        here on forces one blend state on every adopted material.
      </>
    ),
  },
  {
    label: "Blended, behind the water",
    order: "0 · phase 1",
    kind: "band",
    writes: ["accum", "weight"],
    reads: ["depth", "water"],
    depth: "test",
    blend: "rgb ONE + ONE · alpha ZERO + ONE_MINUS_SRC_ALPHA",
    text: (
      <>
        Glass, smoke, bubbles, sprites, every blended material, in whatever
        order the list has. The first thing each fragment does is compare itself
        with the water depth: in front of the nearest water face, it is dropped
        (it draws in the next pass). The water follows the same rule: its
        nearest face lies at that depth and waits for the next pass, while water
        farther back, seen through it, is behind like anything else. What is
        left adds into the sums. No depth is written.
      </>
    ),
  },
  {
    label: "Split",
    order: "999 998",
    kind: "marker",
    writes: ["scene", "accum", "weight"],
    reads: ["accum", "weight"],
    depth: "none",
    blend: "composite: ONE + ONE_MINUS_SRC_ALPHA",
    text: (
      <>
        Composites what lies behind the water into the scene, hands the scene
        colour to the water again (now with the glass, bubbles and smoke behind
        it in it), clears the accumulation and draws the blended band once more,
        straight from three's list, with the steps three's own draw takes. With
        no water in view there is no split: the band draws once.
      </>
    ),
  },
  {
    label: "Blended, with the water",
    order: "0 · phase 2",
    kind: "band",
    writes: ["accum", "weight"],
    reads: ["depth", "water", "scene"],
    depth: "test",
    blend: "rgb ONE + ONE · alpha ZERO + ONE_MINUS_SRC_ALPHA",
    text: (
      <>
        The water and everything in front of it. The water reads the scene
        colour for its refraction while drawing into the accumulation, so it
        bends and tints exactly what lies behind it, and blends by distance with
        whatever stands in front.
      </>
    ),
  },
  {
    label: "Close",
    order: "999 999",
    kind: "marker",
    writes: ["scene"],
    reads: ["accum", "weight"],
    depth: "none",
    blend: "ONE + ONE_MINUS_SRC_ALPHA",
    text: (
      <>
        Binds the scene target again and draws one full-screen triangle:{" "}
        <code>rgb = Σ C·α·w ÷ Σ α·w × (1 − Π)</code>, alpha <code>1 − Π</code>,
        over the scene.
      </>
    ),
  },
  {
    label: "After",
    order: "999 999.5",
    kind: "band",
    writes: ["scene"],
    reads: ["depth"],
    depth: "test",
    blend: "the material's own",
    text: (
      <>
        What cannot accumulate: additive light (it needs no order anyway),
        multiply, custom blends the accumulation cannot express. It draws over
        the composite.
      </>
    ),
  },
  {
    label: "Overlays",
    order: "≥ 1 000 000",
    kind: "band",
    writes: ["scene"],
    reads: [],
    depth: "none",
    blend: "the material's own",
    text: (
      <>Selection boxes and labels keep their own orders, after everything.</>
    ),
  },
];

const ROW_HEIGHT = 46;

function Diagram({ step }: { step: Step }) {
  const width = 620;
  const height = BUFFERS.length * (ROW_HEIGHT + 10) + 20;
  const drawX = 70;
  const drawY = height / 2;
  const boxX = 250;
  const boxW = width - boxX - 10;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      <defs>
        <marker
          id="oit-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
      </defs>
      <rect
        x={drawX - 58}
        y={drawY - 34}
        width={116}
        height={68}
        rx={12}
        fill="var(--oit-active)"
      />
      <text
        x={drawX}
        y={drawY - 6}
        textAnchor="middle"
        fontSize={13}
        fontWeight={600}
        fill="var(--oit-active-text)"
      >
        {step.kind === "marker" ? "marker" : "draws"}
      </text>
      <text
        x={drawX}
        y={drawY + 14}
        textAnchor="middle"
        fontSize={11}
        fill="var(--oit-active-text)"
        opacity={0.8}
      >
        {step.label.length > 18 ? `${step.label.slice(0, 17)}…` : step.label}
      </text>
      {BUFFERS.map((buffer, index) => {
        const y = 10 + index * (ROW_HEIGHT + 10);
        const written =
          step.writes.includes(buffer.id) ||
          (buffer.id === "depth" && step.depth === "write");
        const read =
          step.reads.includes(buffer.id) ||
          (buffer.id === "depth" && step.depth === "test");
        const isAccumulation = buffer.id === "accum" || buffer.id === "weight";
        const stroke = written
          ? isAccumulation
            ? "var(--oit-accum)"
            : "currentColor"
          : read
            ? "var(--oit-behind)"
            : "currentColor";
        const midY = y + ROW_HEIGHT / 2;
        return (
          <g key={buffer.id}>
            {written && (
              <path
                d={`M${drawX + 58} ${drawY} C ${drawX + 120} ${drawY}, ${boxX - 60} ${midY - 6}, ${boxX - 4} ${midY - 6}`}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                markerEnd="url(#oit-arrow)"
                color={stroke}
              />
            )}
            {read && (
              <path
                d={`M${boxX - 4} ${midY + 6} C ${boxX - 60} ${midY + 6}, ${drawX + 120} ${drawY + 8}, ${drawX + 60} ${drawY + 8}`}
                fill="none"
                stroke="var(--oit-behind)"
                strokeWidth={1.5}
                strokeDasharray={
                  buffer.id === "depth" && step.depth === "test" ? "2 4" : "6 4"
                }
                markerEnd="url(#oit-arrow)"
                color="var(--oit-behind)"
              />
            )}
            <rect
              x={boxX}
              y={y}
              width={boxW}
              height={ROW_HEIGHT}
              rx={8}
              fill="transparent"
              stroke={stroke}
              strokeOpacity={written || read ? 1 : 0.2}
              strokeWidth={written ? 2.5 : 1.25}
            />
            <text
              x={boxX + 12}
              y={y + 19}
              fontSize={13}
              fontWeight={600}
              fill="currentColor"
              opacity={written || read ? 1 : 0.45}
            >
              {buffer.name}
              {written
                ? " · written"
                : read
                  ? buffer.id === "depth" && step.depth === "test"
                    ? " · depth-tested"
                    : " · read"
                  : ""}
            </text>
            <text
              x={boxX + 12}
              y={y + 35}
              fontSize={11}
              fill="currentColor"
              opacity={written || read ? 0.7 : 0.35}
            >
              {buffer.detail}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function FrameTimeline() {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  return (
    <Figure
      title="A frame, band by band"
      caption="The world's sort puts every transparent item in one of these bands. Step through them: solid arrows are writes, dashed are reads, dotted is the depth test."
    >
      <div className="oit-steps">
        <ol className="oit-list">
          {STEPS.map((entry, i) => (
            <li
              key={entry.label}
              data-active={i === index}
              data-kind={entry.kind}
              onClick={() => setIndex(i)}
            >
              <span>{entry.label}</span>
              <code>{entry.order}</code>
            </li>
          ))}
        </ol>
        <div>
          <Diagram step={step} />
          <p className="text-sm mt-3 mb-1">{step.text}</p>
          <p className="text-xs mt-0 opacity-70">
            depth:{" "}
            {step.depth === "write"
              ? "written"
              : step.depth === "test"
                ? "tested, not written"
                : "off"}{" "}
            · blend: {step.blend}
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              className="oit-button"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              ← Previous
            </button>
            <button
              type="button"
              className="oit-button"
              disabled={index === STEPS.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </Figure>
  );
}
