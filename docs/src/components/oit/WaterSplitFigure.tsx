import { useRef, useState } from "react";

import { Choice, Figure } from "./ui";

type Point = { x: number; y: number };

/** World units are blocks; the pool's surface is y = 0. */
const POOL = { left: 4, right: 18, floor: -4, rim: 0.6 };
const BIAS = 0.02;
const SCALE = 30;
const WIDTH = 20 * SCALE;
const HEIGHT = 10 * SCALE;
const toSvg = ({ x, y }: Point) => ({ x: x * SCALE, y: (5 - y) * SCALE });
const fromSvg = (x: number, y: number): Point => ({
  x: x / SCALE,
  y: 5 - y / SCALE,
});

type Thing =
  | {
      kind: "segment";
      name: string;
      x: number;
      y0: number;
      y1: number;
      color: string;
    }
  | {
      kind: "puff";
      name: string;
      x: number;
      y: number;
      r: number;
      color: string;
    };

const THINGS: Thing[] = [
  {
    kind: "segment",
    name: "glass under the surface",
    x: 11,
    y0: -3.6,
    y1: -0.9,
    color: "var(--oit-glass)",
  },
  {
    kind: "segment",
    name: "a column through it",
    x: 15,
    y0: -3.6,
    y1: 2.6,
    color: "#d0455a",
  },
  {
    kind: "puff",
    name: "smoke",
    x: 8,
    y: 1.6,
    r: 0.55,
    color: "var(--oit-smoke)",
  },
  {
    kind: "puff",
    name: "smoke",
    x: 9.2,
    y: 2.7,
    r: 0.7,
    color: "var(--oit-smoke)",
  },
  { kind: "puff", name: "bubble", x: 7, y: -2.2, r: 0.3, color: "#e8f4ff" },
];

type Hit = { t: number; point: Point; thing?: Thing; isWater?: boolean };

function hitsAlong(origin: Point, dir: Point): { hits: Hit[]; end: number } {
  const hits: Hit[] = [];
  let end = 40;
  const vertical = (x: number, y0: number, y1: number) => {
    if (Math.abs(dir.x) < 1e-6) return null;
    const t = (x - origin.x) / dir.x;
    const y = origin.y + t * dir.y;
    return t > 1e-4 && y >= Math.min(y0, y1) && y <= Math.max(y0, y1)
      ? t
      : null;
  };
  const horizontal = (y: number, x0: number, x1: number) => {
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (y - origin.y) / dir.y;
    const x = origin.x + t * dir.x;
    return t > 1e-4 && x >= x0 && x <= x1 ? t : null;
  };
  for (const t of [
    horizontal(POOL.floor, POOL.left, POOL.right),
    vertical(POOL.left, POOL.floor, POOL.rim),
    vertical(POOL.right, POOL.floor, POOL.rim),
    horizontal(POOL.rim, 0, POOL.left),
    horizontal(POOL.rim, POOL.right, 20),
  ]) {
    if (t !== null && t < end) end = t;
  }
  const at = (t: number) => ({
    x: origin.x + dir.x * t,
    y: origin.y + dir.y * t,
  });
  const surface = horizontal(0, POOL.left, POOL.right);
  if (surface !== null && surface < end) {
    hits.push({ t: surface, point: at(surface), isWater: true });
  }
  for (const thing of THINGS) {
    if (thing.kind === "segment") {
      const t = vertical(thing.x, thing.y0, thing.y1);
      if (t !== null && t < end) hits.push({ t, point: at(t), thing });
    } else {
      const ox = origin.x - thing.x;
      const oy = origin.y - thing.y;
      const b = ox * dir.x + oy * dir.y;
      const c = ox * ox + oy * oy - thing.r * thing.r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 1e-4 && t < end) hits.push({ t, point: at(t), thing });
    }
  }
  hits.sort((a, b) => a.t - b.t);
  return { hits, end };
}

const PRESETS: Record<"above" | "below", { eye: Point; target: Point }> = {
  above: { eye: { x: 2.2, y: 4.2 }, target: { x: 12, y: -1.5 } },
  below: { eye: { x: 6, y: -2.6 }, target: { x: 15, y: 1.2 } },
};

export default function WaterSplitFigure() {
  const [preset, setPreset] = useState<"above" | "below">("above");
  const [eye, setEye] = useState(PRESETS.above.eye);
  const [target, setTarget] = useState(PRESETS.above.target);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const pointerTo = (event: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    return fromSvg(
      ((event.clientX - box.left) / box.width) * WIDTH,
      ((event.clientY - box.top) / box.height) * HEIGHT,
    );
  };

  const base = Math.atan2(target.y - eye.y, target.x - eye.x);
  const rays = Array.from({ length: 13 }, (_, i) => {
    const angle = base + ((i - 6) / 6) * 0.62;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    return { dir, ...hitsAlong(eye, dir) };
  });

  const eyeSvg = toSvg(eye);
  const isSubmerged =
    eye.y < 0 && eye.x > POOL.left && eye.x < POOL.right && eye.y > POOL.floor;

  return (
    <Figure
      title="Water separates the two passes"
      caption="Drag the eye. Along each ray, the first water face it crosses is where the pass splits: a see-through hit beyond it (blue) is accumulated first and composited into the scene, so the water refracts and tints it; a hit before it (orange) is accumulated together with the water, in front of it. From below, the surface's underside is the nearest face, so what stands above the water is seen through it."
    >
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <Choice
          value={preset}
          options={[
            { value: "above", label: "Eye above the water" },
            { value: "below", label: "Eye under the water" },
          ]}
          onChange={(value) => {
            setPreset(value);
            setEye(PRESETS[value].eye);
            setTarget(PRESETS[value].target);
          }}
        />
        <span className="opacity-60">
          {isSubmerged ? "submerged" : "in the air"}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto select-none"
        style={{ touchAction: "none", cursor: "grab" }}
        onPointerDown={(event) => {
          const point = pointerTo(event);
          if (!point) return;
          dragging.current = true;
          (event.target as Element).setPointerCapture?.(event.pointerId);
          setEye(point);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const point = pointerTo(event);
          if (point) setEye(point);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      >
        <rect
          x={0}
          y={0}
          width={WIDTH}
          height={toSvg({ x: 0, y: 0 }).y}
          fill="#9fc4ea"
          opacity={0.25}
        />
        <rect
          x={toSvg({ x: POOL.left, y: 0 }).x}
          y={toSvg({ x: 0, y: 0 }).y}
          width={(POOL.right - POOL.left) * SCALE}
          height={-POOL.floor * SCALE}
          fill="var(--oit-water)"
          opacity={0.28}
        />
        <line
          x1={toSvg({ x: POOL.left, y: 0 }).x}
          x2={toSvg({ x: POOL.right, y: 0 }).x}
          y1={toSvg({ x: 0, y: 0 }).y}
          y2={toSvg({ x: 0, y: 0 }).y}
          stroke="var(--oit-water)"
          strokeWidth={3}
        />
        <path
          d={`M0 ${toSvg({ x: 0, y: POOL.rim }).y} H${POOL.left * SCALE} V${toSvg({ x: 0, y: POOL.floor }).y} H${POOL.right * SCALE} V${toSvg({ x: 0, y: POOL.rim }).y} H${WIDTH} V${HEIGHT} H0 Z`}
          fill="var(--oit-depth)"
          opacity={0.55}
        />
        {THINGS.map((thing, i) =>
          thing.kind === "segment" ? (
            <line
              key={i}
              x1={toSvg({ x: thing.x, y: thing.y0 }).x}
              x2={toSvg({ x: thing.x, y: thing.y1 }).x}
              y1={toSvg({ x: thing.x, y: thing.y0 }).y}
              y2={toSvg({ x: thing.x, y: thing.y1 }).y}
              stroke={thing.color}
              strokeWidth={7}
              strokeLinecap="round"
              opacity={0.85}
            />
          ) : (
            <circle
              key={i}
              cx={toSvg(thing).x}
              cy={toSvg(thing).y}
              r={thing.r * SCALE}
              fill={thing.color}
              opacity={0.75}
            />
          ),
        )}
        {rays.map(({ dir, hits, end }, i) => {
          const tip = toSvg({ x: eye.x + dir.x * end, y: eye.y + dir.y * end });
          const water = hits.find((hit) => hit.isWater);
          return (
            <g key={i}>
              <line
                x1={eyeSvg.x}
                y1={eyeSvg.y}
                x2={tip.x}
                y2={tip.y}
                stroke="currentColor"
                strokeOpacity={0.22}
              />
              {hits.map((hit, j) => {
                const p = toSvg(hit.point);
                if (hit.isWater) {
                  return (
                    <circle
                      key={j}
                      cx={p.x}
                      cy={p.y}
                      r={4.5}
                      fill="#ffffff"
                      stroke="var(--oit-water)"
                      strokeWidth={2}
                    />
                  );
                }
                const isBehind = water !== undefined && hit.t > water.t + BIAS;
                return (
                  <circle
                    key={j}
                    cx={p.x}
                    cy={p.y}
                    r={4.5}
                    fill={isBehind ? "var(--oit-behind)" : "var(--oit-front)"}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                );
              })}
            </g>
          );
        })}
        <g
          transform={`translate(${eyeSvg.x} ${eyeSvg.y}) rotate(${(-base * 180) / Math.PI})`}
        >
          <path d="M-14 -9 h18 l10 -6 v30 l-10 -6 h-18 z" fill="currentColor" />
        </g>
      </svg>
      <div className="oit-legend">
        <span>
          <i
            style={{ background: "#fff", border: "2px solid var(--oit-water)" }}
          />{" "}
          the nearest water face
        </span>
        <span>
          <i style={{ background: "var(--oit-behind)" }} /> behind it: first
          pass, composited, refracted
        </span>
        <span>
          <i style={{ background: "var(--oit-front)" }} /> in front: second
          pass, with the water
        </span>
      </div>
    </Figure>
  );
}
