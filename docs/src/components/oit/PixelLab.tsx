import { useMemo, useState } from "react";

import {
  accumulate,
  blendBackToFront,
  blendInOrder,
  css,
  DEFAULT_WEIGHTS,
  depthWeight,
  difference,
  type Layer,
  type Rgb,
  type Weights,
} from "./math";
import { Card, Figure, Slider, Swatch } from "./ui";

const BACKGROUND: Rgb = [0.76, 0.68, 0.52];

const INITIAL: Layer[] = [
  {
    id: "glass",
    name: "Glass",
    color: [0.22, 0.72, 0.42],
    alpha: 0.6,
    distance: 4,
  },
  {
    id: "smoke",
    name: "Smoke",
    color: [0.86, 0.85, 0.82],
    alpha: 0.35,
    distance: 7,
  },
  {
    id: "water",
    name: "Water",
    color: [0.16, 0.42, 0.78],
    alpha: 0.8,
    distance: 12,
  },
];

const MIN_DISTANCE = 1;
const MAX_DISTANCE = 80;
const logX = (d: number, width: number) =>
  (Math.log(d / MIN_DISTANCE) / Math.log(MAX_DISTANCE / MIN_DISTANCE)) * width;

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function Ray({ layers }: { layers: Layer[] }) {
  const width = 560;
  const left = 56;
  const span = width - left - 40;
  return (
    <svg viewBox={`0 0 ${width} 120`} className="w-full h-auto">
      <rect x={0} y={0} width={width} height={120} rx={10} fill="transparent" />
      <g transform="translate(14 46)">
        <path
          d="M0 0 h20 l10 -8 v24 l-10 -8 h-20 z"
          fill="currentColor"
          opacity={0.7}
        />
        <text x={0} y={36} fontSize={11} fill="currentColor" opacity={0.6}>
          eye
        </text>
      </g>
      <line
        x1={left}
        y1={60}
        x2={width - 30}
        y2={60}
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeDasharray="4 4"
      />
      {[1, 2, 5, 10, 20, 50].map((d) => (
        <g key={d} transform={`translate(${left + logX(d, span)} 0)`}>
          <line y1={98} y2={104} stroke="currentColor" strokeOpacity={0.4} />
          <text
            y={116}
            fontSize={10}
            textAnchor="middle"
            fill="currentColor"
            opacity={0.5}
          >
            {d}
          </text>
        </g>
      ))}
      <rect
        x={width - 30}
        y={14}
        width={18}
        height={84}
        rx={3}
        fill={css(BACKGROUND)}
      />
      {layers.map((layer) => (
        <g
          key={layer.id}
          transform={`translate(${left + logX(layer.distance, span)} 0)`}
        >
          <rect
            x={-5}
            y={14}
            width={10}
            height={84}
            rx={3}
            fill={css(layer.color)}
            fillOpacity={0.25 + layer.alpha * 0.75}
            stroke={css(layer.color)}
          />
          <text y={10} fontSize={11} textAnchor="middle" fill="currentColor">
            {layer.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

function WeightCurve({
  weights,
  layers,
}: {
  weights: Weights;
  layers: Layer[];
}) {
  const width = 560;
  const height = 200;
  const pad = { left: 44, right: 16, top: 12, bottom: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const minD = 0.5;
  const maxD = 400;
  const minW = 0.005;
  const maxW = 3000;
  const x = (d: number) =>
    pad.left + (Math.log(d / minD) / Math.log(maxD / minD)) * plotW;
  const y = (w: number) =>
    pad.top + (1 - Math.log(w / minW) / Math.log(maxW / minW)) * plotH;
  const points = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i <= 160; i++) {
      const d = minD * (maxD / minD) ** (i / 160);
      out.push(`${x(d).toFixed(1)},${y(depthWeight(d, weights)).toFixed(1)}`);
    }
    return out.join(" ");
  }, [weights]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {[0.01, 0.1, 1, 10, 100, 1000].map((w) => (
        <g key={w}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(w)}
            y2={y(w)}
            stroke="currentColor"
            strokeOpacity={0.08}
          />
          <text
            x={pad.left - 6}
            y={y(w) + 3}
            fontSize={10}
            textAnchor="end"
            fill="currentColor"
            opacity={0.5}
          >
            {w}
          </text>
        </g>
      ))}
      {[1, 10, 100].map((d) => (
        <text
          key={d}
          x={x(d)}
          y={height - 8}
          fontSize={10}
          textAnchor="middle"
          fill="currentColor"
          opacity={0.5}
        >
          {d} blocks
        </text>
      ))}
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      />
      {layers.map((layer) => {
        const w = depthWeight(layer.distance, weights);
        return (
          <g key={layer.id}>
            <line
              x1={x(layer.distance)}
              x2={x(layer.distance)}
              y1={y(w)}
              y2={pad.top + plotH}
              stroke={css(layer.color)}
              strokeDasharray="3 3"
            />
            <circle
              cx={x(layer.distance)}
              cy={y(w)}
              r={5}
              fill={css(layer.color)}
              stroke="currentColor"
              strokeOpacity={0.4}
            />
            <text
              x={x(layer.distance) + 8}
              y={y(w) - 6}
              fontSize={11}
              fill="currentColor"
            >
              {layer.name} · {w < 10 ? w.toFixed(2) : Math.round(w)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function PixelLab() {
  const [layers, setLayers] = useState(INITIAL);
  const [order, setOrder] = useState(["water", "smoke", "glass"]);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);

  const byId = (id: string) => layers.find((layer) => layer.id === id) as Layer;
  const drawOrder = order.map(byId);
  const inOrder = blendInOrder(drawOrder, BACKGROUND);
  const exact = blendBackToFront(layers, BACKGROUND);
  const oit = accumulate(drawOrder, BACKGROUND, weights);
  const isBackToFront = drawOrder.every(
    (layer, i) => i === 0 || drawOrder[i - 1].distance >= layer.distance,
  );
  const update = (id: string, patch: Partial<Layer>) =>
    setLayers((current) =>
      current.map((layer) =>
        layer.id === id ? { ...layer, ...patch } : layer,
      ),
    );

  return (
    <Figure
      title="One pixel, three layers"
      caption="Drag the layers apart, change their opacity, shuffle the order they draw in. Blending in draw order is right only when the order happens to be back to front; the weighted blend gives the same answer for every order."
    >
      <Ray layers={layers} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-4">
        {layers.map((layer) => (
          <Card key={layer.id}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ background: css(layer.color) }}
              />
              <span className="font-semibold text-sm">{layer.name}</span>
            </div>
            <Slider
              label="opacity"
              value={layer.alpha}
              min={0.05}
              max={1}
              step={0.01}
              format={(v) => v.toFixed(2)}
              onChange={(alpha) => update(layer.id, { alpha })}
            />
            <Slider
              label="distance"
              value={layer.distance}
              min={MIN_DISTANCE}
              max={60}
              step={0.5}
              format={(v) => `${v} blocks`}
              onChange={(distance) => update(layer.id, { distance })}
            />
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <span className="opacity-60">Draw order:</span>
        {drawOrder.map((layer, i) => (
          <span key={layer.id} className="flex items-center gap-1">
            {i > 0 && <span className="opacity-40">→</span>}
            <span
              className="px-2 py-0.5 rounded"
              style={{
                background: css(layer.color),
                color: layer.id === "smoke" ? "#111" : "#fff",
              }}
            >
              {layer.name}
            </span>
          </span>
        ))}
        <span className="flex gap-1 ml-auto">
          <button
            type="button"
            className="oit-button"
            onClick={() =>
              setOrder(
                [...layers]
                  .sort((a, b) => b.distance - a.distance)
                  .map((l) => l.id),
              )
            }
          >
            Back to front
          </button>
          <button
            type="button"
            className="oit-button"
            onClick={() =>
              setOrder(
                [...layers]
                  .sort((a, b) => a.distance - b.distance)
                  .map((l) => l.id),
              )
            }
          >
            Front to back
          </button>
          <button
            type="button"
            className="oit-button"
            onClick={() => setOrder(shuffled(order))}
          >
            Shuffle
          </button>
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Swatch
          title="Blended in draw order"
          color={inOrder}
          note={
            isBackToFront
              ? "Back to front, so this one is right."
              : `Out of order: ${Math.round(difference(inOrder, exact) * 100)}% off.`
          }
        />
        <Swatch
          title="Back to front (exact)"
          color={exact}
          note="What a perfect sort draws."
        />
        <Swatch
          title="Weighted blended (any order)"
          color={oit.result}
          note={`${Math.round(difference(oit.result, exact) * 100)}% off exact, for every order.`}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 text-xs oit-mono">
        <Card>
          <div className="opacity-60 mb-1">target 0 · rgb</div>Σ C·α·w = (
          {oit.accumulated.map((v) => v.toFixed(2)).join(", ")})
        </Card>
        <Card>
          <div className="opacity-60 mb-1">target 0 · alpha</div>Π (1 − α) ={" "}
          {oit.revealage.toFixed(3)}
        </Card>
        <Card>
          <div className="opacity-60 mb-1">target 1 · red</div>Σ α·w ={" "}
          {oit.weight.toFixed(2)}
        </Card>
      </div>
      <h4 className="mt-6 mb-1 text-sm font-semibold">The depth weight</h4>
      <p className="text-sm opacity-80 mt-0">
        <code>
          w(d) = clamp(scale / (ε + (d / near)³ + (d / far)⁶), min, max)
        </code>
        . Between them the nearer layer takes more of the colour: twice as far
        weighs an eighth.
      </p>
      <WeightCurve weights={weights} layers={layers} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Slider
          label="scale"
          value={weights.scale}
          min={1}
          max={100}
          step={1}
          format={(v) => `${v}`}
          onChange={(scale) => setWeights({ ...weights, scale })}
        />
        <Slider
          label="nearDistance"
          value={weights.nearDistance}
          min={1}
          max={50}
          step={1}
          format={(v) => `${v} blocks`}
          onChange={(nearDistance) => setWeights({ ...weights, nearDistance })}
        />
        <Slider
          label="farDistance"
          value={weights.farDistance}
          min={50}
          max={600}
          step={10}
          format={(v) => `${v} blocks`}
          onChange={(farDistance) => setWeights({ ...weights, farDistance })}
        />
      </div>
    </Figure>
  );
}
