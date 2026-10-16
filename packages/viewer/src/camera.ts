/**
 * Camera rigs: an orbit (perspective, or orthographic for the top-down and
 * isometric presets) around a target held on the ground, and a free flying
 * eye. Both read and write the same plain `Pose`, so switching presets,
 * jumping to a bookmark or driving the camera from a script never loses
 * where the camera is looking.
 *
 * The camera's height only changes because of something the user did.
 * Once he pans, the target follows the ground under it, read as the median
 * of a footprint scaled to the view (a tree or a cliff step does not
 * register), and eases to it. At rest it ignores the heightfield refining
 * as tiles stream in, unless the ground turns out to be a sizeable share of
 * the view away (data that arrived late). All easing is critically damped
 * and solved per elapsed second, so it is the same at any frame rate.
 */
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

import {
  Flight,
  flightArc,
  flightDuration,
  interpolateFly,
  interpolateOrbit,
} from "./flight";
import {
  ISO_PITCH,
  length,
  type Orbit,
  orbitEye,
  orbitFromPose,
  type Pose,
  type Preset,
  presetOrbit,
  presetProjection,
  type Projection,
  sub,
  TOP_PITCH,
  type Vec3,
} from "./pose";
import { WheelReader } from "./scroll";
import { dampTo, isSettled, median } from "./smoothing";

export type FlyState = { eye: Vec3; yaw: number; pitch: number };

/** How the camera follows the ground and flies; a host may tune any of it. */
export type CameraFeel = {
  /** The ground under the look point is sampled over a disc this share of the view span across... */
  footprint: number;
  /** ...and no narrower than this many blocks. 0 for both samples one column, as the first rig did. */
  footprintMin: number;
  /** While panning, ground changes under the look point smaller than this, in blocks, leave its height alone... */
  deadband: number;
  /** ...and at rest, changes smaller than this share of the view distance: tiles refining as they stream in. */
  restDeadband: number;
  /** The orbit eye keeps at least this many blocks over the ground beneath it, eased like the rest. */
  clearance: number;
  /** Wheel zoom settles in this share of the smoothing time. */
  zoomShare: number;
  /** Seconds for a flight that barely moves. */
  flightMin: number;
  /** Seconds for the longest flights. */
  flightMax: number;
  /** A flight this many view spans long, or longer, takes `flightMax`. */
  flightSpans: number;
  /** A double-click flight closes the frame in by this factor... */
  flightZoom: number;
  /** ...down to a frame this many blocks across. */
  flightMinSpan: number;
  /** A long flight widens its frame mid-way to hold the trip, by at most this share of its distance. */
  flightArcMax: number;
};

export const DEFAULT_CAMERA_FEEL: Readonly<CameraFeel> = Object.freeze({
  footprint: 0.08,
  footprintMin: 12,
  deadband: 1,
  restDeadband: 0.06,
  clearance: 6,
  zoomShare: 0.35,
  flightMin: 0.6,
  flightMax: 1.2,
  flightSpans: 16,
  flightZoom: 0.6,
  flightMinSpan: 96,
  flightArcMax: 3,
});

export type FlightOptions = {
  /** Seconds; by default it scales with the trip, between the feel's bounds. */
  duration?: number;
  /** Fly to the point without closing the frame in. */
  keepZoom?: boolean;
};

export type FlightResult = {
  /** False when input or another move cut the flight short. */
  completed: boolean;
  seconds: number;
  pose: Pose;
};

type ActiveFlight =
  | { kind: "orbit"; flight: Flight<Orbit>; resolve: (r: FlightResult) => void }
  | {
      kind: "fly";
      flight: Flight<FlyState>;
      resolve: (r: FlightResult) => void;
    };

const MIN_PITCH = -1.45;
/** Orbit distance bounds, blocks (an orthographic frame's height). */
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 20000;
/** A wheel gesture picks the ground under the pointer once: while its events keep coming this close together, at this pixel. */
const ANCHOR_REUSE_MS = 300;
const ANCHOR_REUSE_PX = 4;
/** A held-ground pan goes at most this many times as far as it would at the look point. */
const GRAB_REACH = 4;
/** Fingers count as holding the ground until their wheel events pause this long, ms. */
const HOLD_RELEASE_MS = 150;

const clampDistance = (d: number) =>
  Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, d));
const ORTHO_DEPTH = 6000;
/**
 * The perspective camera's near plane, blocks: close up for a walking
 * eye, pushed out as an orbit pulls back, up to a cap. Depth precision far
 * off goes with it: on the near plane alone, faces a tenth of a block apart
 * (a sea-ice sheet over the far water) fight for every pixel past a
 * thousand blocks or so.
 */
const NEAR = 0.5;
const NEAR_PER_ORBIT_DISTANCE = 1 / 256;
const NEAR_MAX = 8;
const FAR = 24000;

/** The near plane for an orbit `distance` blocks from its look point. */
export function orbitNear(distance: number): number {
  return Math.min(NEAR_MAX, Math.max(NEAR, distance * NEAR_PER_ORBIT_DISTANCE));
}
/** Blocks (and blocks per second) within which an easing counts as done. */
const SETTLE_TOLERANCE = 0.01;

export class CameraRig {
  preset: Preset = "orbit";

  orbit: Orbit = {
    target: [0, 80, 0],
    distance: 160,
    yaw: Math.PI / 4,
    pitch: 0.6,
  };

  fly: FlyState = { eye: [0, 120, 0], yaw: Math.PI / 4, pitch: -0.4 };

  readonly perspective: PerspectiveCamera;

  readonly orthographic: OrthographicCamera;

  /** Blocks per second while flying; the wheel scales it. */
  flySpeed = 48;

  /**
   * Seconds the camera takes to cover 90% of a height change (the ground
   * under the target, the eye's clearance) and, scaled by the feel's
   * `zoomShare`, a wheel zoom. 0 snaps, as the first rig did.
   */
  smoothing = 0.6;

  /** Free flight keeps its height unless Space or Shift asks; off flies along the view. */
  levelFlight = true;

  feel: CameraFeel = { ...DEFAULT_CAMERA_FEEL };

  /** Ground height under a column, for keeping the orbit target on the ground. */
  groundAt: (x: number, z: number) => number | null = () => null;

  /** Called whenever the pose changes through input. */
  onChange: () => void = () => {};

  /** Lets the page take a press (on a pin, say) before it becomes an orbit or a pan. */
  claimPointer: (event: PointerEvent) => boolean = () => false;

  /** Lets the page take a key (an open menu's shortcut) before it moves the camera. */
  claimKey: (event: KeyboardEvent) => boolean = () => false;

  /** Where the ray through a client pixel meets the ground: a zoom keeps it on that pixel and a pan holds it there; null where nothing is loaded. */
  pickPoint: (clientX: number, clientY: number) => Vec3 | null = () => null;

  private keys = new Set<string>();

  private drag: {
    x: number;
    y: number;
    button: number;
    shift: boolean;
    /** A pan holds the ground point it was pressed on, on its own height, under the pointer. */
    grab: Vec3 | null;
  } | null = null;

  private aspect = 1;

  /** One view's size, CSS pixels: half the canvas in a side-by-side split. */
  private view: [number, number] = [1, 1];

  private cleanup: (() => void)[] = [];

  /** Where the target's height is easing to, or null when it rests. */
  private heightGoal: number | null = null;

  private heightVelocity = 0;

  /** Where a wheel zoom is easing to, or null when it rests. */
  private zoomGoal: number | null = null;

  /** Rate of change of the log of the distance, per second. */
  private zoomVelocity = 0;

  /** The ground point an easing wheel zoom keeps under the pointer, or null to zoom about the look point. */
  private zoomAnchor: Vec3 | null = null;

  /** The ground last picked under the pointer for a wheel gesture: what for, where (client pixels) and when. */
  private anchorPick: {
    kind: "zoom" | "pan";
    x: number;
    y: number;
    at: number;
    point: Vec3 | null;
  } | null = null;

  /** Trackpad pans and pinches, or a mouse wheel's zoom. */
  private wheel = new WheelReader();

  /** Safari's pinch: the scale its last gesture event reported, null between pinches. */
  private gestureScale: number | null = null;

  /** Shift went with a drag or a scroll, so it is a modifier until let go, never a move. */
  private shiftModifier = false;

  /** When a wheel pan last moved the view, ms. */
  private wheelPanAt = -Infinity;

  /** Blocks the orbit eye is raised to clear the ground beneath it. */
  private lift = 0;

  private liftVelocity = 0;

  private liftGoal = 0;

  /** Set by anything that moved the rig this frame. */
  private moved = false;

  /** Whether the target follows the ground: from the first pan until an explicit pose or a landing. */
  private following = false;

  private flight: ActiveFlight | null = null;

  constructor(
    private element: HTMLElement,
    fov = 60,
  ) {
    this.perspective = new PerspectiveCamera(fov, 1, NEAR, FAR);
    this.orthographic = new OrthographicCamera(
      -1,
      1,
      1,
      -1,
      1,
      ORTHO_DEPTH * 2,
    );
    this.listen();
    this.sync();
  }

  get projection(): Projection {
    return presetProjection(this.preset);
  }

  get camera() {
    return this.projection === "orthographic"
      ? this.orthographic
      : this.perspective;
  }

  /** Whether a flight is under way. */
  get flying(): boolean {
    return this.flight !== null;
  }

  /** Whether anything moves the camera now: a held key or drag, a flight or an easing. */
  isActive(): boolean {
    return this.keys.size > 0 || this.drag !== null || this.isSettling();
  }

  /** Whether the camera is still moving on its own: a flight or an easing. */
  isSettling(): boolean {
    return (
      this.flight !== null ||
      this.heightGoal !== null ||
      this.zoomGoal !== null ||
      !isSettled(
        { value: this.lift, velocity: this.liftVelocity },
        this.liftGoal,
        SETTLE_TOLERANCE,
      )
    );
  }

  pose(): Pose {
    if (this.preset === "free") {
      const d = this.flyDirection();
      const e = this.fly.eye;
      return {
        eye: [...e] as Vec3,
        look: [e[0] + d[0] * 32, e[1] + d[1] * 32, e[2] + d[2] * 32],
      };
    }
    return { eye: this.orbitEyeLifted(), look: [...this.orbit.target] as Vec3 };
  }

  /** Where the viewer streams around: what the camera is looking at. */
  focus(): Vec3 {
    if (this.preset !== "free") return [...this.orbit.target] as Vec3;
    const d = this.flyDirection();
    const reach = Math.min(160, Math.max(24, this.fly.eye[1] - 60));
    const e = this.fly.eye;
    return [e[0] + d[0] * reach, e[1] + d[1] * reach, e[2] + d[2] * reach];
  }

  /** Roughly how many blocks across the frame shows at the focus. */
  span(): number {
    if (this.projection === "orthographic")
      return this.orbit.distance * Math.max(1, this.aspect);
    const distance =
      this.preset === "free"
        ? Math.max(32, this.fly.eye[1] - 60) * 2
        : this.orbit.distance;
    return distance * this.perspectiveSpanPerDistance();
  }

  setPose(pose: Pose, preset: Preset = this.preset) {
    this.cancelFlight();
    this.rest();
    const orbit = orbitFromPose(pose);
    this.preset = preset;
    if (preset === "free") {
      this.fly = {
        eye: [...pose.eye] as Vec3,
        yaw: orbit.yaw,
        pitch: -orbit.pitch,
      };
      this.orbit = orbit;
    } else if (preset === "top") {
      this.orbit = { ...orbit, pitch: TOP_PITCH };
    } else if (preset === "iso") {
      this.orbit = { ...orbit, pitch: ISO_PITCH };
    } else {
      this.orbit = orbit;
    }
    this.sync();
  }

  setPreset(preset: Preset, span?: number) {
    if (preset === this.preset && span === undefined) return;
    this.cancelFlight();
    this.rest();
    const focus = this.focus();
    const yaw = this.preset === "free" ? this.fly.yaw : this.orbit.yaw;
    const frame = span ?? Math.max(64, this.span());
    if (preset === "free") {
      const orbit = presetOrbit("orbit", focus, frame, yaw);
      const eye = orbitEye({
        ...orbit,
        distance: Math.max(48, frame * 0.5),
        pitch: 0.45,
      });
      this.fly = { eye, yaw, pitch: -0.45 };
      this.orbit = { ...orbit, target: focus };
    } else {
      this.orbit = presetOrbit(preset, focus, frame, yaw);
    }
    this.preset = preset;
    this.sync();
  }

  /**
   * Flies to frame `point` in the current preset: the look point (or, flying
   * free, the gaze) moves onto it and the frame closes in a step, as a map
   * does on a double-click, unless `keepZoom`. Resolves when it lands or is
   * cut short by input.
   */
  flyToPoint(point: Vec3, options: FlightOptions = {}): Promise<FlightResult> {
    if (this.preset === "free") {
      const toEye = sub(this.fly.eye, point);
      const away = Math.max(1e-3, length(toEye));
      const minDistance =
        this.feel.flightMinSpan / this.perspectiveSpanPerDistance();
      const distance = options.keepZoom
        ? away
        : Math.min(away, Math.max(minDistance, away * this.feel.flightZoom));
      const eye: Vec3 = [
        point[0] + (toEye[0] / away) * distance,
        point[1] + (toEye[1] / away) * distance,
        point[2] + (toEye[2] / away) * distance,
      ];
      return this.startFly(lookingAt(eye, point), options);
    }
    const minDistance = this.feel.flightMinSpan / this.spanPerDistance();
    const current = this.orbit.distance;
    const distance = options.keepZoom
      ? current
      : Math.min(
          current,
          Math.max(minDistance, current * this.feel.flightZoom),
        );
    return this.startOrbit(
      { ...this.orbit, target: [...point] as Vec3, distance },
      options,
    );
  }

  /** Flies to `pose` in `preset`; switching between perspective and orthographic cuts first. */
  flyToPose(
    pose: Pose,
    preset: Preset = this.preset,
    options: FlightOptions = {},
  ): Promise<FlightResult> {
    if (presetProjection(preset) !== this.projection) this.setPreset(preset);
    const orbit = orbitFromPose(pose);
    if (preset === "free") {
      if (this.preset !== "free") {
        this.fly = {
          eye: this.orbitEyeLifted(),
          yaw: this.orbit.yaw,
          pitch: -this.orbit.pitch,
        };
        this.lift = 0;
        this.preset = "free";
      }
      return this.startFly(
        { eye: [...pose.eye] as Vec3, yaw: orbit.yaw, pitch: -orbit.pitch },
        options,
      );
    }
    if (this.preset === "free") {
      this.orbit = orbitFromPose(this.pose());
    }
    this.preset = preset;
    const pitch =
      preset === "top" ? TOP_PITCH : preset === "iso" ? ISO_PITCH : orbit.pitch;
    return this.startOrbit({ ...orbit, pitch }, options);
  }

  /** Lets go of a drag in progress: the rest of the press moves nothing. */
  cancelDrag() {
    this.drag = null;
  }

  /** Stops a flight where it is; its promise resolves as not completed. */
  cancelFlight() {
    const active = this.flight;
    if (!active) return;
    this.flight = null;
    active.resolve({
      completed: false,
      seconds: active.flight.elapsed,
      pose: this.pose(),
    });
  }

  resize(width: number, height: number) {
    this.aspect = width / Math.max(1, height);
    this.view = [Math.max(1, width), Math.max(1, height)];
    this.sync();
  }

  /** Keyboard movement, flights and easing; call once a frame with the seconds since the last. */
  update(dt: number) {
    let moved = this.flight ? this.stepFlight(dt) : this.stepKeys(dt);
    moved = this.settle(dt) || moved;
    if (moved) {
      this.sync();
      this.onChange();
    }
  }

  dispose() {
    this.cancelFlight();
    for (const off of this.cleanup) off();
    this.cleanup = [];
  }

  private perspectiveSpanPerDistance() {
    return (
      2 *
      Math.tan((this.perspective.fov * Math.PI) / 360) *
      Math.max(1, this.aspect)
    );
  }

  /** Blocks across the frame per block of orbit distance, for the current projection. */
  private spanPerDistance() {
    return this.projection === "orthographic"
      ? Math.max(1, this.aspect)
      : this.perspectiveSpanPerDistance();
  }

  private orbitEyeLifted(): Vec3 {
    const eye = orbitEye(this.orbit);
    if (this.preset === "orbit") eye[1] += this.lift;
    return eye;
  }

  /** Drops every easing in progress, leaving the camera where it stands. */
  private rest() {
    this.following = false;
    this.heightGoal = null;
    this.heightVelocity = 0;
    this.zoomGoal = null;
    this.zoomVelocity = 0;
    this.zoomAnchor = null;
    this.lift = 0;
    this.liftVelocity = 0;
    this.liftGoal = 0;
  }

  private startOrbit(to: Orbit, options: FlightOptions): Promise<FlightResult> {
    this.cancelFlight();
    const from: Orbit = {
      ...this.orbit,
      target: [...this.orbit.target] as Vec3,
    };
    const travel = length(sub(orbitEye(to), orbitEye(from)));
    const duration =
      options.duration ?? flightDuration(travel, this.span(), this.timing());
    const arc = flightArc(
      from,
      to,
      this.spanPerDistance(),
      this.feel.flightArcMax,
    );
    this.following = false;
    this.heightGoal = null;
    this.heightVelocity = 0;
    this.zoomGoal = null;
    this.zoomVelocity = 0;
    this.zoomAnchor = null;
    return new Promise((resolve) => {
      this.flight = {
        kind: "orbit",
        flight: new Flight(from, to, duration, (a, b, t) =>
          interpolateOrbit(a, b, t, arc),
        ),
        resolve,
      };
    });
  }

  private startFly(
    to: FlyState,
    options: FlightOptions,
  ): Promise<FlightResult> {
    this.cancelFlight();
    const from: FlyState = { ...this.fly, eye: [...this.fly.eye] as Vec3 };
    const travel = length(sub(to.eye, from.eye));
    const duration =
      options.duration ?? flightDuration(travel, this.span(), this.timing());
    return new Promise((resolve) => {
      this.flight = {
        kind: "fly",
        flight: new Flight(from, to, duration, interpolateFly),
        resolve,
      };
    });
  }

  private timing() {
    return {
      min: this.feel.flightMin,
      max: this.feel.flightMax,
      spans: this.feel.flightSpans,
    };
  }

  private stepFlight(dt: number): boolean {
    const active = this.flight;
    if (!active) return false;
    if (active.kind === "orbit") this.orbit = active.flight.step(dt);
    else this.fly = active.flight.step(dt);
    this.moved = true;
    if (active.flight.done) {
      this.flight = null;
      this.sync();
      active.resolve({
        completed: true,
        seconds: active.flight.elapsed,
        pose: this.pose(),
      });
    }
    return true;
  }

  private stepKeys(dt: number): boolean {
    if (this.keys.size === 0) return false;
    const step =
      dt * (this.preset === "free" ? this.flySpeed : this.orbit.distance * 0.9);
    let forward = 0;
    let right = 0;
    let up = 0;
    let zoom = 0;
    if (this.keys.has("KeyW")) forward += 1;
    if (this.keys.has("KeyS")) forward -= 1;
    if (this.keys.has("KeyD")) right += 1;
    if (this.keys.has("KeyA")) right -= 1;
    // Rising and sinking are free flight's; an orbit zooms on - and =, so
    // Shift stays a modifier there. Shift that went with a drag or a scroll
    // never sinks.
    if (this.preset === "free") {
      if (this.keys.has("Space")) up += 1;
      if (
        !this.shiftModifier &&
        (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"))
      )
        up -= 1;
    } else {
      if (this.keys.has("Equal") || this.keys.has("NumpadAdd")) zoom -= 1;
      if (this.keys.has("Minus") || this.keys.has("NumpadSubtract")) zoom += 1;
    }
    if (!forward && !right && !up && !zoom) return false;
    if (this.preset === "free") {
      const yaw = this.fly.yaw;
      const d = this.levelFlight
        ? ([-Math.sin(yaw), 0, -Math.cos(yaw)] as Vec3)
        : this.flyDirection();
      const e = this.fly.eye;
      e[0] += (d[0] * forward + Math.cos(yaw) * right) * step;
      e[1] += (d[1] * forward + up) * step;
      e[2] += (d[2] * forward - Math.sin(yaw) * right) * step;
    } else {
      if (forward || right) this.panGround(right * step, forward * step);
      if (zoom) {
        this.zoomGoal = null;
        this.zoomVelocity = 0;
        this.zoomAnchor = null;
        this.orbit.distance = clampDistance(
          this.orbit.distance * Math.exp(zoom * dt),
        );
      }
    }
    this.moved = true;
    return true;
  }

  /** Eases the target's height, a wheel zoom and the eye's clearance; true if anything moved. */
  private settle(dt: number): boolean {
    let moved = false;
    if (this.preset !== "free" && !this.flight) {
      // The look point eases onto the ground once the pointer or the
      // fingers let go of it: moving it under them would slide the ground
      // they hold out from beneath them.
      const holding =
        !!this.drag?.grab ||
        performance.now() - this.wheelPanAt < HOLD_RELEASE_MS;
      if (this.following && !holding) this.retarget();
      if (this.heightGoal !== null && !holding) {
        const t = this.orbit.target;
        const spring = dampTo(
          { value: t[1], velocity: this.heightVelocity },
          this.heightGoal,
          this.smoothing,
          dt,
        );
        t[1] = spring.value;
        this.heightVelocity = spring.velocity;
        if (isSettled(spring, this.heightGoal, SETTLE_TOLERANCE)) {
          t[1] = this.heightGoal;
          this.heightGoal = null;
          this.heightVelocity = 0;
        }
        moved = true;
      }
      if (this.zoomGoal !== null) {
        const goal = Math.log(this.zoomGoal);
        const spring = dampTo(
          { value: Math.log(this.orbit.distance), velocity: this.zoomVelocity },
          goal,
          this.smoothing * this.feel.zoomShare,
          dt,
        );
        this.zoomOrbit(Math.exp(spring.value), this.zoomAnchor);
        this.zoomVelocity = spring.velocity;
        if (isSettled(spring, goal, SETTLE_TOLERANCE / 100)) {
          this.zoomOrbit(this.zoomGoal, this.zoomAnchor);
          this.zoomGoal = null;
          this.zoomVelocity = 0;
          this.zoomAnchor = null;
        }
        moved = true;
      }
    }
    if (this.preset === "orbit" && (this.following || this.moved || moved)) {
      const goal = this.clearanceLift();
      const band = this.moved ? 0 : this.restBand();
      if (Math.abs(goal - this.liftGoal) > band || goal === 0)
        this.liftGoal = goal;
    }
    if (this.preset === "orbit") {
      const resting = isSettled(
        { value: this.lift, velocity: this.liftVelocity },
        this.liftGoal,
        SETTLE_TOLERANCE,
      );
      if (!resting) {
        const spring = dampTo(
          { value: this.lift, velocity: this.liftVelocity },
          this.liftGoal,
          this.smoothing,
          dt,
        );
        this.lift = spring.value;
        this.liftVelocity = spring.velocity;
        if (isSettled(spring, this.liftGoal, SETTLE_TOLERANCE)) {
          this.lift = this.liftGoal;
          this.liftVelocity = 0;
        }
        moved = true;
      }
    }
    this.moved = false;
    return moved;
  }

  /** How far the orbit eye must rise to keep its clearance over the ground beneath it. */
  private clearanceLift(): number {
    const eye = orbitEye(this.orbit);
    const radius = Math.max(1, this.feel.clearance);
    const ground = this.sampleGround(eye[0], eye[2], radius, "max");
    if (ground === null) return this.liftGoal;
    return Math.max(0, ground + this.feel.clearance - eye[1]);
  }

  /**
   * Ground heights over a disc around (x, z): the centre and two rings of
   * six, reduced to their median (the ground under a look point) or their
   * highest (what an eye must clear). A radius of 0 samples the centre.
   */
  private sampleGround(
    x: number,
    z: number,
    radius: number,
    reduce: "median" | "max",
  ): number | null {
    const heights: number[] = [];
    const add = (sx: number, sz: number) => {
      const h = this.groundAt(sx, sz);
      if (h !== null) heights.push(h);
    };
    add(x, z);
    if (radius > 0) {
      for (const r of [radius / 2, radius]) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + (r === radius ? Math.PI / 6 : 0);
          add(x + Math.cos(a) * r, z + Math.sin(a) * r);
        }
      }
    }
    if (!heights.length) return null;
    return reduce === "max" ? Math.max(...heights) : median(heights);
  }

  private flyDirection(): Vec3 {
    const { yaw, pitch } = this.fly;
    const c = Math.cos(pitch);
    return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
  }

  /** Moves the orbit target across the ground in the camera's frame. */
  private panGround(right: number, forward: number) {
    const yaw = this.orbit.yaw;
    const t = this.orbit.target;
    t[0] += Math.cos(yaw) * right - Math.sin(yaw) * forward;
    t[2] += -Math.sin(yaw) * right - Math.cos(yaw) * forward;
    this.moved = true;
    this.following = true;
  }

  /** Blocks across one pixel at the look point. */
  private blocksPerPixel() {
    const tall = Math.max(1, this.element.clientHeight);
    return this.projection === "orthographic"
      ? this.orbit.distance / tall
      : (2 *
          this.orbit.distance *
          Math.tan((this.perspective.fov * Math.PI) / 360)) /
          tall;
  }

  /** Moves the view so the ground under the pointer follows it by (dx, dy) CSS pixels. */
  private panPixels(dx: number, dy: number) {
    const el = this.element;
    if (this.preset === "free") {
      // Truck and pedestal across the screen, at the scale of the view.
      const perPixel = this.span() / Math.max(1, el.clientWidth);
      const { yaw, pitch } = this.fly;
      const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const up: Vec3 = [
        Math.sin(yaw) * Math.sin(pitch),
        Math.cos(pitch),
        Math.cos(yaw) * Math.sin(pitch),
      ];
      const e = this.fly.eye;
      for (let i = 0; i < 3; i++)
        e[i] += (-right[i] * dx + up[i] * dy) * perPixel;
      this.moved = true;
      return;
    }
    const perPixel = this.blocksPerPixel();
    const lean =
      this.projection === "orthographic"
        ? 1 / Math.max(0.2, Math.sin(this.orbit.pitch))
        : 1;
    this.panGround(-dx * perPixel, dy * perPixel * lean);
  }

  /**
   * Zooms by `factor` (the view distance's multiplier) about `anchor`, which
   * keeps its pixel, or about the look point; eased when `eased` (a mouse
   * wheel's notches), at once for a trackpad, whose own motion is smooth.
   * Flying free, the eye moves toward or away from the anchor.
   */
  private zoomBy(factor: number, anchor: Vec3 | null, eased: boolean) {
    if (this.preset === "free") {
      const e = this.fly.eye;
      const p = anchor ?? this.focus();
      const away = length(sub(e, p));
      const k = Math.max(factor, 2 / Math.max(2, away));
      for (let i = 0; i < 3; i++) e[i] = p[i] + (e[i] - p[i]) * k;
    } else if (eased && this.smoothing > 0) {
      this.zoomGoal = clampDistance(
        (this.zoomGoal ?? this.orbit.distance) * factor,
      );
      this.zoomAnchor = anchor;
      return;
    } else {
      this.zoomGoal = null;
      this.zoomVelocity = 0;
      this.zoomAnchor = null;
      this.zoomOrbit(clampDistance(this.orbit.distance * factor), anchor);
    }
    this.moved = true;
    this.sync();
    this.onChange();
  }

  /**
   * Sets the orbit distance, scaling the look point about `anchor` by the
   * same ratio: the whole view scales about the anchor, so it stays on its
   * pixel, in either projection.
   */
  private zoomOrbit(distance: number, anchor: Vec3 | null) {
    const k = distance / this.orbit.distance;
    this.orbit.distance = distance;
    if (!anchor) return;
    const t = this.orbit.target;
    for (let i = 0; i < 3; i++) t[i] = anchor[i] + (t[i] - anchor[i]) * k;
    // The look point left the ground along the pointer's line; holding it
    // there keeps the anchor still, and the next pan sets it back down.
    this.following = false;
    this.heightGoal = null;
    this.heightVelocity = 0;
  }

  /**
   * The ground under the pointer, picked once per gesture: a zoom scales
   * about it, a pan slides the ground on its height.
   */
  private anchorAt(
    e: { clientX: number; clientY: number },
    kind: "zoom" | "pan",
  ): Vec3 | null {
    const now = performance.now();
    const last = this.anchorPick;
    if (
      last?.kind === kind &&
      now - last.at < ANCHOR_REUSE_MS &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) < ANCHOR_REUSE_PX
    ) {
      last.at = now;
      return last.point;
    }
    const point = this.pickPoint(e.clientX, e.clientY);
    this.anchorPick = { kind, x: e.clientX, y: e.clientY, at: now, point };
    return point;
  }

  /** Where the ray through client pixel (x, y) meets the level plane at `height`; null where it never does. */
  private hitLevel(x: number, y: number, height: number): Vec3 | null {
    const rect = this.element.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const [width, tall] = this.view;
    // A side-by-side split draws the same camera in each half.
    const px = (x - rect.left) % width;
    const ndcX = (px / width) * 2 - 1;
    const ndcY = -((y - rect.top) / tall) * 2 + 1;
    const camera = this.camera;
    const origin = new Vector3(ndcX, ndcY, -1).unproject(camera);
    const direction = new Vector3(ndcX, ndcY, 1).unproject(camera).sub(origin);
    if (Math.abs(direction.y) < 1e-9) return null;
    const t = (height - origin.y) / direction.y;
    if (t <= 0) return null;
    return [origin.x + direction.x * t, height, origin.z + direction.z * t];
  }

  /**
   * Slides the orbit across the ground so that `point` lands under client
   * pixel (x, y): the ground stays held under the pointer, as a map's does,
   * in perspective as well as on a map, `pixels` being how far the
   * pointer or the fingers moved. False when that pixel looks above the
   * point's height (the sky), for the caller to pan by scale instead.
   */
  private grabTo(point: Vec3, x: number, y: number, pixels: number): boolean {
    const hit = this.hitLevel(x, y, point[1]);
    if (!hit) return false;
    let dx = point[0] - hit[0];
    let dz = point[2] - hit[2];
    // Near the horizon a pixel spans a long way: a step goes at most a few
    // times as far as the same pixels would carry the look point.
    const most = GRAB_REACH * pixels * this.blocksPerPixel();
    const step = Math.hypot(dx, dz);
    if (step > most) {
      dx *= most / step;
      dz *= most / step;
    }
    this.orbit.target[0] += dx;
    this.orbit.target[2] += dz;
    this.moved = true;
    this.following = true;
    return true;
  }

  /** Changes this small are tile refinement, not terrain, when the camera rests. */
  private restBand() {
    return Math.max(
      this.feel.deadband,
      this.orbit.distance * this.feel.restDeadband,
    );
  }

  /** Re-reads the ground under the target and moves its height goal if it changed enough. */
  private retarget() {
    const t = this.orbit.target;
    const radius = Math.max(
      this.feel.footprintMin,
      this.span() * this.feel.footprint,
    );
    const ground = this.sampleGround(t[0], t[2], radius, "median");
    if (ground === null) return;
    const band = this.moved ? this.feel.deadband : this.restBand();
    const reference = this.heightGoal ?? t[1];
    if (Math.abs(ground - reference) >= band) this.heightGoal = ground;
  }

  sync() {
    const persp = this.perspective;
    persp.aspect = this.aspect;
    if (this.preset === "free") {
      const d = this.flyDirection();
      const e = this.fly.eye;
      persp.position.set(...e);
      persp.lookAt(e[0] + d[0], e[1] + d[1], e[2] + d[2]);
      persp.near = NEAR;
    } else {
      persp.position.set(...this.orbitEyeLifted());
      persp.lookAt(...this.orbit.target);
      persp.near = orbitNear(this.orbit.distance);
    }
    persp.updateProjectionMatrix();
    persp.updateMatrixWorld();

    const ortho = this.orthographic;
    const h = this.orbit.distance / 2;
    ortho.left = -h * this.aspect;
    ortho.right = h * this.aspect;
    ortho.top = h;
    ortho.bottom = -h;
    ortho.position.set(...orbitEye({ ...this.orbit, distance: ORTHO_DEPTH }));
    ortho.lookAt(...this.orbit.target);
    ortho.updateProjectionMatrix();
    ortho.updateMatrixWorld();
  }

  private listen() {
    const el = this.element;
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler as EventListener, options);
      this.cleanup.push(() =>
        target.removeEventListener(type, handler as EventListener),
      );
    };
    // A held key's keyup can go missing: macOS takes Cmd+Shift+3 for a
    // screenshot and the page never hears Shift come up, and it drops every
    // keyup while Cmd is down. Every input event carries the real modifier
    // state, so a Shift the event says is up is let go.
    const syncShift = (e: MouseEvent | KeyboardEvent) => {
      if (e.shiftKey) return;
      this.keys.delete("ShiftLeft");
      this.keys.delete("ShiftRight");
      this.shiftModifier = false;
    };
    on(el, "contextmenu", (e) => e.preventDefault());
    on(el, "pointerdown", (e) => {
      syncShift(e);
      if (e.shiftKey) this.shiftModifier = true;
      this.anchorPick = null;
      this.cancelFlight();
      if (this.claimPointer(e)) return;
      el.setPointerCapture(e.pointerId);
      el.focus();
      const pans =
        this.preset === "top" ||
        e.button === 1 ||
        e.button === 2 ||
        e.shiftKey ||
        this.keys.has("Space");
      let grab: Vec3 | null = null;
      if (pans && this.preset !== "free") {
        const ground = this.pickPoint(e.clientX, e.clientY);
        grab =
          ground ?? this.hitLevel(e.clientX, e.clientY, this.orbit.target[1]);
      }
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        shift: e.shiftKey,
        grab,
      };
    });
    on(el, "pointerup", (e) => {
      el.releasePointerCapture(e.pointerId);
      this.drag = null;
    });
    on(el, "pointermove", (e) => {
      syncShift(e);
      if (!this.drag) return;
      if (e.shiftKey) this.shiftModifier = true;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (!dx && !dy) return;
      // Space held turns a drag into a pan, as in a design tool.
      const isPan =
        this.drag.button === 2 ||
        this.drag.button === 1 ||
        this.drag.shift ||
        this.keys.has("Space");
      if (this.preset === "free") {
        this.fly.yaw -= dx * 0.004;
        this.fly.pitch = Math.max(
          MIN_PITCH,
          Math.min(1.45, this.fly.pitch - dy * 0.004),
        );
      } else if (isPan || this.preset === "top") {
        const grab = this.drag.grab;
        if (
          !grab ||
          !this.grabTo(grab, e.clientX, e.clientY, Math.hypot(dx, dy))
        )
          this.panPixels(dx, dy);
      } else {
        this.orbit.yaw -= dx * 0.005;
        if (this.preset !== "iso") {
          this.orbit.pitch = Math.max(
            0.05,
            Math.min(TOP_PITCH, this.orbit.pitch + dy * 0.005),
          );
        }
      }
      this.moved = true;
      this.sync();
      this.onChange();
    });
    on(
      el,
      "wheel",
      (e) => {
        // Also keeps a sideways swipe from going Back to an older page.
        e.preventDefault();
        syncShift(e);
        if (e.shiftKey) this.shiftModifier = true;
        // Safari sends its pinch as gesture events below, not Ctrl+wheel.
        if (this.gestureScale !== null) return;
        const gesture = this.wheel.read(e, performance.now());
        if (!gesture) return;
        this.cancelFlight();
        if (gesture.kind === "pan") {
          // The ground under the pointer follows the fingers: whatever is
          // under it now, on the height first picked there this gesture.
          this.wheelPanAt = performance.now();
          const ground =
            this.preset === "free" ? null : this.anchorAt(e, "pan");
          const height = ground?.[1] ?? this.orbit.target[1];
          const under =
            this.preset === "free"
              ? null
              : this.hitLevel(e.clientX, e.clientY, height);
          if (
            !under ||
            !this.grabTo(
              under,
              e.clientX + gesture.dx,
              e.clientY + gesture.dy,
              Math.hypot(gesture.dx, gesture.dy),
            )
          )
            this.panPixels(gesture.dx, gesture.dy);
          this.sync();
          this.onChange();
          return;
        }
        // A plain mouse wheel sets the speed of free flight.
        if (this.preset === "free" && !e.ctrlKey && !e.metaKey) {
          if (gesture.device !== "mouse") return;
          this.flySpeed = Math.max(
            4,
            Math.min(2000, this.flySpeed * Math.exp(-e.deltaY * 0.002)),
          );
          return;
        }
        this.zoomBy(
          gesture.factor,
          this.anchorAt(e, "zoom"),
          gesture.device === "mouse",
        );
      },
      { passive: false },
    );
    // Safari's pinch: gesture events carry the scale since the pinch began.
    const onGesture = (
      type: "gesturestart" | "gesturechange" | "gestureend",
      handle: (
        e: Event & { scale: number; clientX: number; clientY: number },
      ) => void,
    ) => {
      const listener = (event: Event) => {
        event.preventDefault();
        handle(event as Parameters<typeof handle>[0]);
      };
      el.addEventListener(type, listener);
      this.cleanup.push(() => el.removeEventListener(type, listener));
    };
    onGesture("gesturestart", () => {
      this.cancelFlight();
      this.gestureScale = 1;
    });
    onGesture("gesturechange", (e) => {
      if (this.gestureScale === null || !(e.scale > 0)) return;
      const factor = this.gestureScale / e.scale;
      this.gestureScale = e.scale;
      this.zoomBy(factor, this.anchorAt(e, "zoom"), false);
    });
    onGesture("gestureend", () => {
      this.gestureScale = null;
    });
    on(el, "keydown", (e) => {
      syncShift(e);
      // A chord with Cmd or Ctrl is the browser's or the system's shortcut,
      // never a move, and whatever was held when it began may never send
      // its keyup.
      if (e.metaKey || e.ctrlKey) {
        this.keys.clear();
        return;
      }
      if (this.claimKey(e)) return;
      this.anchorPick = null;
      this.cancelFlight();
      if (e.code === "KeyQ" || e.code === "KeyE") {
        const turn = (e.code === "KeyQ" ? 1 : -1) * (Math.PI / 2);
        if (this.preset === "free") this.fly.yaw += turn;
        else this.orbit.yaw += turn;
        this.moved = true;
        this.sync();
        this.onChange();
        return;
      }
      this.keys.add(e.code);
    });
    on(el, "keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "ShiftLeft" || e.code === "ShiftRight")
        this.shiftModifier = false;
      syncShift(e);
    });
    on(el, "blur", () => {
      this.keys.clear();
      this.shiftModifier = false;
    });
  }
}

/** The flying state at `eye` gazing at `point`. */
function lookingAt(eye: Vec3, point: Vec3): FlyState {
  const d = sub(point, eye);
  const l = Math.max(1e-9, length(d));
  return {
    eye,
    yaw: Math.atan2(-d[0], -d[2]),
    pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / l))),
  };
}
