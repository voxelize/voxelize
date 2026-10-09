/**
 * Camera flights: an eased move from one rig state to another over a set
 * time, sampled from elapsed seconds so it looks the same at any frame
 * rate. The ease starts and ends at rest and never passes its end.
 */
import type { FlyState } from "./camera";
import type { Orbit, Vec3 } from "./pose";

/** Smootherstep: 0 to 1 with no speed or acceleration at either end, never outside [0, 1]. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The signed turn from `from` to `to` the short way round, in (-π, π]. */
export function shortestTurn(from: number, to: number): number {
  const full = Math.PI * 2;
  const d = (((to - from) % full) + full) % full;
  return d > Math.PI ? d - full : d;
}

/**
 * The orbit `t` of the way from `a` to `b`: the target moves in a straight
 * line, the distance geometrically (a zoom reads evenly), the yaw the short
 * way round. `arc` widens the frame mid-way by that share of the distance,
 * easing in and out (sin²), so a long trip can be seen whole.
 */
export function interpolateOrbit(
  a: Orbit,
  b: Orbit,
  t: number,
  arc = 0,
): Orbit {
  if (t <= 0) return { ...a, target: [...a.target] as Vec3 };
  if (t >= 1) return { ...b, target: [...b.target] as Vec3 };
  const lift = 1 + arc * Math.sin(Math.PI * t) ** 2;
  return {
    target: [
      lerp(a.target[0], b.target[0], t),
      lerp(a.target[1], b.target[1], t),
      lerp(a.target[2], b.target[2], t),
    ],
    distance:
      Math.exp(lerp(Math.log(a.distance), Math.log(b.distance), t)) * lift,
    yaw: a.yaw + shortestTurn(a.yaw, b.yaw) * t,
    pitch: lerp(a.pitch, b.pitch, t),
  };
}

/** The flying eye `t` of the way from `a` to `b`, turning the short way. */
export function interpolateFly(a: FlyState, b: FlyState, t: number): FlyState {
  if (t <= 0) return { ...a, eye: [...a.eye] as Vec3 };
  if (t >= 1) return { ...b, eye: [...b.eye] as Vec3 };
  const eye: Vec3 = [
    lerp(a.eye[0], b.eye[0], t),
    lerp(a.eye[1], b.eye[1], t),
    lerp(a.eye[2], b.eye[2], t),
  ];
  return {
    eye,
    yaw: a.yaw + shortestTurn(a.yaw, b.yaw) * t,
    pitch: lerp(a.pitch, b.pitch, t),
  };
}

export type FlightTiming = {
  /** Seconds for a flight that barely moves. */
  min: number;
  /** Seconds for the longest flights. */
  max: number;
  /** A trip this many view spans long, or longer, takes `max`. */
  spans: number;
};

/** Seconds for a flight `travel` blocks long seen in a frame `span` blocks across. */
export function flightDuration(
  travel: number,
  span: number,
  timing: FlightTiming,
): number {
  const ratio = Math.max(0, travel) / Math.max(1, span);
  const share = Math.min(1, Math.log2(1 + ratio) / Math.log2(1 + timing.spans));
  return lerp(timing.min, timing.max, share);
}

/**
 * How much a flight between orbits `a` and `b` should widen mid-way, as a
 * share of its distance there: enough that the frame holds the whole trip
 * (`spanPerDistance` is how many blocks across the frame shows per block of
 * distance), never more than `max`.
 */
export function flightArc(
  a: Orbit,
  b: Orbit,
  spanPerDistance: number,
  max: number,
): number {
  const travel = Math.hypot(
    b.target[0] - a.target[0],
    b.target[1] - a.target[1],
    b.target[2] - a.target[2],
  );
  const mid = Math.sqrt(a.distance * b.distance);
  const needed = travel / Math.max(1e-6, spanPerDistance);
  return Math.min(max, Math.max(0, needed / mid - 1));
}

/** One eased flight between two states of type `S`, advanced by elapsed seconds. */
export class Flight<S> {
  elapsed = 0;

  constructor(
    readonly from: S,
    readonly to: S,
    readonly duration: number,
    private readonly sample: (from: S, to: S, t: number) => S,
  ) {}

  /** Share of the time gone, 0..1. */
  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
  }

  get done(): boolean {
    return this.progress >= 1;
  }

  /** Moves the clock on `dt` seconds and returns the state to show. */
  step(dt: number): S {
    this.elapsed += Math.max(0, dt);
    return this.current();
  }

  /** The state at the present time: what a cancelled flight leaves behind. */
  current(): S {
    return this.sample(this.from, this.to, easeInOut(this.progress));
  }
}
