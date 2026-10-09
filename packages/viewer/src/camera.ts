/**
 * Camera rigs: an orbit (perspective, or orthographic for the top-down and
 * isometric presets) around a target held on the ground, and a free flying
 * eye. Both read and write the same plain `Pose`, so switching presets,
 * jumping to a bookmark or driving the camera from a script never loses
 * where the camera is looking.
 */
import { OrthographicCamera, PerspectiveCamera } from "three";

import {
  ISO_PITCH,
  type Orbit,
  orbitEye,
  orbitFromPose,
  type Pose,
  type Preset,
  presetOrbit,
  presetProjection,
  type Projection,
  TOP_PITCH,
  type Vec3,
} from "./pose";

export type FlyState = { eye: Vec3; yaw: number; pitch: number };

const MIN_PITCH = -1.45;
const ORTHO_DEPTH = 6000;

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

  /** Ground height under a column, for keeping the orbit target on the ground. */
  groundAt: (x: number, z: number) => number | null = () => null;

  /** Called whenever the pose changes through input. */
  onChange: () => void = () => {};

  private keys = new Set<string>();

  private drag: {
    x: number;
    y: number;
    button: number;
    shift: boolean;
  } | null = null;

  private aspect = 1;

  private cleanup: (() => void)[] = [];

  constructor(
    private element: HTMLElement,
    fov = 60,
  ) {
    this.perspective = new PerspectiveCamera(fov, 1, 0.5, 24000);
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

  pose(): Pose {
    if (this.preset === "free") {
      const d = this.flyDirection();
      const e = this.fly.eye;
      return {
        eye: [...e] as Vec3,
        look: [e[0] + d[0] * 32, e[1] + d[1] * 32, e[2] + d[2] * 32],
      };
    }
    return { eye: orbitEye(this.orbit), look: [...this.orbit.target] as Vec3 };
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
    return (
      2 *
      distance *
      Math.tan((this.perspective.fov * Math.PI) / 360) *
      Math.max(1, this.aspect)
    );
  }

  setPose(pose: Pose, preset: Preset = this.preset) {
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

  resize(width: number, height: number) {
    this.aspect = width / Math.max(1, height);
    this.sync();
  }

  /** Keyboard movement; call once a frame. */
  update(dt: number) {
    if (this.keys.size === 0) return;
    const step =
      dt * (this.preset === "free" ? this.flySpeed : this.orbit.distance * 0.9);
    let forward = 0;
    let right = 0;
    let up = 0;
    if (this.keys.has("KeyW")) forward += 1;
    if (this.keys.has("KeyS")) forward -= 1;
    if (this.keys.has("KeyD")) right += 1;
    if (this.keys.has("KeyA")) right -= 1;
    if (this.keys.has("Space")) up += 1;
    if (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) up -= 1;
    if (!forward && !right && !up) return;
    if (this.preset === "free") {
      const d = this.flyDirection();
      const yaw = this.fly.yaw;
      const e = this.fly.eye;
      e[0] += (d[0] * forward + Math.cos(yaw) * right) * step;
      e[1] += (d[1] * forward + up) * step;
      e[2] += (d[2] * forward - Math.sin(yaw) * right) * step;
    } else {
      this.panGround(right * step, forward * step);
      this.orbit.distance = Math.max(8, this.orbit.distance * (1 - up * dt));
    }
    this.sync();
    this.onChange();
  }

  dispose() {
    for (const off of this.cleanup) off();
    this.cleanup = [];
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
    const ground = this.groundAt(t[0], t[2]);
    if (ground !== null) t[1] = ground;
  }

  sync() {
    const persp = this.perspective;
    persp.aspect = this.aspect;
    if (this.preset === "free") {
      const d = this.flyDirection();
      const e = this.fly.eye;
      persp.position.set(...e);
      persp.lookAt(e[0] + d[0], e[1] + d[1], e[2] + d[2]);
    } else {
      persp.position.set(...orbitEye(this.orbit));
      persp.lookAt(...this.orbit.target);
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
    on(el, "contextmenu", (e) => e.preventDefault());
    on(el, "pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      el.focus();
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        shift: e.shiftKey,
      };
    });
    on(el, "pointerup", (e) => {
      el.releasePointerCapture(e.pointerId);
      this.drag = null;
    });
    on(el, "pointermove", (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      const isPan =
        this.drag.button === 2 || this.drag.button === 1 || this.drag.shift;
      if (this.preset === "free") {
        this.fly.yaw -= dx * 0.004;
        this.fly.pitch = Math.max(
          MIN_PITCH,
          Math.min(1.45, this.fly.pitch - dy * 0.004),
        );
      } else if (isPan || this.preset === "top") {
        const unitsPerPixel =
          this.projection === "orthographic"
            ? this.orbit.distance / Math.max(1, el.clientHeight)
            : (2 *
                this.orbit.distance *
                Math.tan((this.perspective.fov * Math.PI) / 360)) /
              Math.max(1, el.clientHeight);
        const lean =
          this.projection === "orthographic"
            ? 1 / Math.max(0.2, Math.sin(this.orbit.pitch))
            : 1;
        this.panGround(-dx * unitsPerPixel, dy * unitsPerPixel * lean);
      } else {
        this.orbit.yaw -= dx * 0.005;
        if (this.preset !== "iso") {
          this.orbit.pitch = Math.max(
            0.05,
            Math.min(TOP_PITCH, this.orbit.pitch + dy * 0.005),
          );
        }
      }
      this.sync();
      this.onChange();
    });
    on(
      el,
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.preset === "free") {
          this.flySpeed = Math.max(
            4,
            Math.min(2000, this.flySpeed * Math.exp(-e.deltaY * 0.002)),
          );
          return;
        }
        this.orbit.distance = Math.max(
          6,
          Math.min(20000, this.orbit.distance * Math.exp(e.deltaY * 0.0015)),
        );
        this.sync();
        this.onChange();
      },
      { passive: false },
    );
    on(el, "keydown", (e) => {
      if (e.code === "KeyQ" || e.code === "KeyE") {
        const turn = (e.code === "KeyQ" ? 1 : -1) * (Math.PI / 2);
        if (this.preset === "free") this.fly.yaw += turn;
        else this.orbit.yaw += turn;
        this.sync();
        this.onChange();
        return;
      }
      this.keys.add(e.code);
    });
    on(el, "keyup", (e) => this.keys.delete(e.code));
    on(el, "blur", () => this.keys.clear());
  }
}
