/**
 * The pin on the terrain and the action wheel around it. There is only
 * ever one: a click drops it there, moving it from wherever it stood (a
 * double-click that follows turns into a flight and puts the pin back);
 * clicking the pin, right-clicking anywhere, or holding the pin or the
 * right button opens the wheel; actions run on the pin, or on the bare
 * ground point when the wheel was opened over terrain.
 *
 * The pin is a voxel banner in every view's scene, with a card of what
 * the source knows about its column. It lives in the URL (`pin=x,y,z`),
 * so a link to the viewer carries it.
 */
import type { Camera, PerspectiveCamera, Scene } from "three";
import { Vector3 } from "three";

import { builtinIcon } from "./pin-art";
import { PIN_HEIGHT, PinModel, type PinLighting } from "./pin-model";
import {
  formatCoordinates,
  measure,
  type Measurement,
  type Pin,
  type PinFact,
  pinFromUrl,
  serializePin,
  standingPose,
} from "./pins";
import type { Bookmark, Pose, Vec3 } from "./pose";
import { type ViewerTheme, themeCss } from "./theme";
import { RadialWheel, type WheelMode } from "./wheel";

/** What an action runs on: the pin, or a ground point the wheel was opened over. */
export type PinTarget = { pin: Pin | null; point: Vec3 };

export type PinActionResult = {
  action: string;
  ok: boolean;
  /** What the toast says. */
  message: string;
  [detail: string]: unknown;
};

/** The viewer as the pin layer sees it. */
export type PinHost = {
  pickGround(px: number, py: number): Vec3 | null;
  flyTo(point: Vec3): Promise<unknown>;
  flyToPose(pose: Pose, preset: "free"): Promise<unknown>;
  query(x: number, z: number): Promise<unknown>;
  /** The game's link for a pose, or null when the host has none. */
  linkFor(pose: Pose): string | null;
  /** Heading of the camera, radians (0 looks toward -z). */
  cameraYaw(): number;
  /** How far the camera looks down, radians (0 level, π/2 straight down). */
  cameraPitch(): number;
  /** Lets go of a camera drag in progress (a hold became the wheel's). */
  releaseCamera(): void;
  pose(): Pose;
  preset(): string;
  addBookmark(bookmark: Bookmark): Promise<Bookmark>;
};

export type PinActionContext = {
  target: PinTarget;
  host: PinHost;
  pins: PinLayer;
  args: Record<string, unknown>;
};

/** An action on the wheel and in `pinAction`; hosts add their own with `ViewerHost.pinActions`. */
export type PinAction = {
  id: string;
  label: string;
  key: string;
  /** Icon URL; the theme's icon for this id, else a built-in one, when absent. */
  icon?: string;
  /** Why it cannot run on this target; null when it can. */
  unavailable?(ctx: PinActionContext): string | null;
  run(ctx: PinActionContext): Promise<PinActionResult> | PinActionResult;
};

export type PinLayerOptions = {
  theme: ViewerTheme;
  /** Class prefix for the injected stylesheet. */
  prefix: string;
  /** Blocks from the top face to the eyes of a player standing there. */
  standingEyeHeight: number;
  /** How tall the pin stays on screen, CSS pixels (it is never drawn smaller than life). */
  screenHeight: number;
  /** A press held this long, still, opens the wheel in hold mode. */
  holdMs: number;
  /** A press that travels more than this, CSS pixels, is a drag. */
  clickSlop: number;
  /** A second click within this long of a pin drop is a double-click's. */
  doubleClickMs: number;
  /** Turns the column the backend reports into lines on the pin card. */
  describe?: (column: unknown) => PinFact[];
  actions?: PinAction[];
  /** Keep the pin in the page URL (`pin=`). */
  persistInUrl: boolean;
};

type PinScene = {
  scene: Scene;
  lighting: PinLighting;
  model: PinModel | null;
};

type Press = {
  x: number;
  y: number;
  button: number;
  at: number;
  onPin: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  held: boolean;
  moved: boolean;
};

type ScreenAnchor = {
  base: [number, number];
  top: [number, number];
  visible: boolean;
};

const URL_PARAM = "pin";
/** What links from before the pin was one carried; read for their first pin, then dropped. */
const LEGACY_URL_PARAM = "pins";
/** Stepped drop: the banner falls to the ground in three whole steps. */
const DROP_STEPS = [0.7, 0.3, 0];
const DROP_STEP_MS = 45;
/** The hovered or selected pin stands this much taller, in one step. */
const POP = 1.12;
/** Camera pitch past which the banner starts leaning back toward it, and the step it leans in. */
const LEAN_FROM = 0.6;
const LEAN_STEP = Math.PI / 12;

export class PinLayer {
  readonly ui: HTMLDivElement;

  private pin: Pin | null = null;

  private scenes: PinScene[] = [];

  private card: HTMLDivElement;

  private toast: HTMLDivElement;

  private measureLabel: HTMLDivElement;

  private wheel: RadialWheel;

  private selected = false;

  private hovered = false;

  /** When the pin last dropped, for its stepped fall. */
  private droppedAt: number | null = null;

  private press: Press | null = null;

  /** The last click's drop, and the pin it moved, so a double-click can put that one back. */
  private lastDrop: {
    at: number;
    x: number;
    y: number;
    previous: Pin | null;
  } | null = null;

  /** How the last press ended, so the click event that follows it can be read. */
  private lastRelease: {
    x: number;
    y: number;
    moved: boolean;
    handled: boolean;
  } | null = null;

  /** Waiting for a click on the spot to measure to. */
  private measuring = false;

  private measurement: { to: Vec3; result: Measurement } | null = null;

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private screen: ScreenAnchor | null = null;

  private measureScreen: ScreenAnchor | null = null;

  private actions: PinAction[];

  private iconCache = new Map<string, string>();

  constructor(
    private readonly container: HTMLElement,
    private readonly host: PinHost,
    private readonly options: PinLayerOptions,
    private readonly onChange: () => void = () => {},
  ) {
    const styleId = `${options.prefix}-style`;
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = themeCss(options.theme, options.prefix);
      document.head.append(style);
    }
    this.ui = document.createElement("div");
    this.ui.className = `${options.prefix}-ui`;
    container.append(this.ui);
    this.card = this.panel(`${options.prefix}-card`);
    this.toast = this.panel(`${options.prefix}-toast`);
    this.measureLabel = this.panel(`${options.prefix}-measure`);
    this.wheel = new RadialWheel(this.ui, options.prefix);
    this.actions = [...builtinActions(), ...(options.actions ?? [])];
  }

  /** The pin, or null when there is none. */
  current(): Pin | null {
    return this.pin
      ? { point: [...this.pin.point] as Vec3, facts: [...this.pin.facts] }
      : null;
  }

  get wheelOpen() {
    return this.wheel.isOpen;
  }

  get highlightedAction() {
    return this.wheel.highlighted;
  }

  /** Where the pin stands on the canvas, CSS pixels: its foot and its top; null when none is on screen. */
  onScreen(): { base: [number, number]; top: [number, number] } | null {
    return this.pin && this.screen?.visible
      ? { base: [...this.screen.base], top: [...this.screen.top] }
      : null;
  }

  /** The views' scenes and lighting; the banner follows them across source changes. */
  attach(views: { scene: Scene; lighting: PinLighting }[]) {
    for (const old of this.scenes) this.dropModel(old);
    this.scenes = views.map((v) => ({ ...v, model: null }));
    if (this.pin) this.addModels();
  }

  /** Drops the pin at `point`, moving it from wherever it stood; resolves once the source has described the column. */
  async drop(point: Vec3): Promise<Pin> {
    const pin: Pin = { point: [point[0], point[1], point[2]], facts: [] };
    this.place(pin);
    this.selected = true;
    this.changed();
    pin.facts = await this.describe(pin.point);
    this.changed();
    return { point: [...pin.point] as Vec3, facts: [...pin.facts] };
  }

  /** Restores the pin a URL carries (`pin=`, or an older link's first `pins=` entry); its facts load in the background. */
  restoreFromUrl(search: string) {
    const point = pinFromUrl(search);
    if (!point) return;
    void this.drop(point);
    this.selected = false;
  }

  remove(): boolean {
    if (!this.pin) return false;
    this.pin = null;
    for (const s of this.scenes) this.dropModel(s);
    this.selected = false;
    this.hovered = false;
    this.measuring = false;
    this.measurement = null;
    this.changed();
    return true;
  }

  /** The actions a target offers, with why each one cannot run, if it cannot. */
  actionsFor(target: PinTarget) {
    const ctx = this.context(target, {});
    return this.actions
      .filter((a) => (target.pin ? a.id !== "pin" : a.id !== "remove"))
      .map((a) => ({ action: a, disabled: a.unavailable?.(ctx) ?? null }));
  }

  /** Runs `actionId` on a target; the result is also shown as a toast. */
  async run(
    target: PinTarget,
    actionId: string,
    args: Record<string, unknown> = {},
  ) {
    const entry = this.actionsFor(target).find((e) => e.action.id === actionId);
    if (!entry) {
      throw new Error(
        `no action ${actionId}; this target offers ${this.actionsFor(target)
          .map((e) => e.action.id)
          .join(", ")}`,
      );
    }
    if (entry.disabled) {
      const result: PinActionResult = {
        action: actionId,
        ok: false,
        message: entry.disabled,
      };
      this.say(result.message);
      return result;
    }
    const result = await entry.action.run(this.context(target, args));
    this.say(result.message);
    return result;
  }

  /** Opens the wheel at (x, y) in the container's CSS pixels. */
  openWheel(target: PinTarget, x: number, y: number, mode: WheelMode) {
    const items = this.actionsFor(target).map(({ action, disabled }) => ({
      id: action.id,
      label: action.label,
      key: action.key,
      icon: this.iconFor(action),
      disabled,
    }));
    this.wheel.open({
      x,
      y,
      items,
      mode,
      title: `${target.pin ? "Pin · " : ""}${formatCoordinates(target.point)}`,
      onPick: (id) => {
        void this.run(target, id).catch((error: Error) =>
          this.say(error.message),
        );
      },
    });
    this.changed();
  }

  closeWheel() {
    this.wheel.close();
  }

  /** Whether the layer takes a press at canvas pixel (x, y), so the camera does not. */
  claimPress(x: number, y: number, button: number): boolean {
    if (this.wheel.isOpen) {
      this.wheel.close();
      this.press = null;
      return true;
    }
    const onPin = this.hitPin(x, y);
    const press: Press = {
      x,
      y,
      button,
      at: performance.now(),
      onPin,
      timer: null,
      held: false,
      moved: false,
    };
    if ((button === 0 && onPin) || button === 2) {
      press.timer = setTimeout(() => this.hold(press), this.options.holdMs);
    }
    this.press = press;
    return onPin && button === 0;
  }

  /** True when the press under way turned into a hold, so the camera must let go of it. */
  get holding() {
    return this.press?.held ?? false;
  }

  move(x: number, y: number) {
    const press = this.press;
    if (
      press &&
      !press.held &&
      Math.hypot(x - press.x, y - press.y) > this.options.clickSlop
    ) {
      press.moved = true;
      if (press.timer) clearTimeout(press.timer);
      press.timer = null;
    }
    if (this.wheel.isOpen && this.wheel.mode === "hold") {
      this.wheel.point(x, y);
      return;
    }
    if (!press) {
      const hovered = this.hitPin(x, y);
      if (hovered !== this.hovered) {
        this.hovered = hovered;
        this.container.style.cursor = hovered ? "pointer" : "";
      }
    }
  }

  /** A press ended at (x, y); returns true when the layer handled it. */
  release(x: number, y: number, button: number): boolean {
    const handled = this.settle(x, y, button);
    this.lastRelease = {
      x,
      y,
      moved: handled === "moved",
      handled: handled === true,
    };
    return handled === true;
  }

  private settle(x: number, y: number, button: number): boolean | "moved" {
    const press = this.press;
    this.press = null;
    if (press?.timer) clearTimeout(press.timer);
    if (press?.held) {
      if (this.wheel.isOpen && this.wheel.mode === "hold") this.wheel.release();
      return true;
    }
    if (!press) return false;
    if (
      press.moved ||
      Math.hypot(x - press.x, y - press.y) > this.options.clickSlop
    ) {
      return "moved";
    }
    if (button === 2) {
      const target = this.targetAt(press.onPin, x, y);
      if (target) this.openWheel(target, x, y, "click");
      return true;
    }
    if (button === 0 && press.onPin) {
      this.clickPin(x, y);
      return true;
    }
    return false;
  }

  /** A left click on the canvas (`detail` counts the clicks of a double-click). */
  click(x: number, y: number, detail: number): boolean {
    const release = this.lastRelease;
    this.lastRelease = null;
    if (release?.handled || release?.moved) return true;
    if (detail !== 1) return detail > 1;
    const point = this.host.pickGround(x, y);
    if (!point) return false;
    if (this.measuring && this.pin) {
      this.say(describeMeasurement(this.measureTo(point)));
      return true;
    }
    this.lastDrop = { at: performance.now(), x, y, previous: this.current() };
    void this.drop(point);
    return true;
  }

  /**
   * A double-click at (x, y): puts back the pin its first click moved (or
   * takes it away, when there was none) and returns the point to fly to
   * (the pin's own, when it was on the pin).
   */
  doubleClick(x: number, y: number): Vec3 | null {
    const last = this.lastDrop;
    this.lastDrop = null;
    if (
      last &&
      performance.now() - last.at < this.options.doubleClickMs &&
      Math.hypot(x - last.x, y - last.y) <= this.options.clickSlop * 2
    ) {
      if (last.previous) {
        this.place(last.previous, false);
        this.selected = false;
        this.changed();
      } else {
        this.remove();
      }
    }
    this.wheel.close(false);
    return this.pin && this.hitPin(x, y)
      ? this.pin.point
      : this.host.pickGround(x, y);
  }

  /** A key; true when the layer used it (the camera must not). */
  key(event: KeyboardEvent): boolean {
    if (this.wheel.isOpen) return this.wheel.key(event);
    if (
      event.key === "Escape" &&
      (this.selected || this.measuring || this.measurement)
    ) {
      this.selected = false;
      this.measuring = false;
      this.measurement = null;
      this.changed();
      return true;
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      this.selected
    ) {
      this.remove();
      return true;
    }
    return false;
  }

  /** Waits for a click on the spot to measure the pin to. */
  startMeasure() {
    this.measuring = true;
    this.changed();
  }

  /** Measures from the pin to `to` and draws it. */
  measureTo(to: Vec3): Measurement {
    if (!this.pin) throw new Error("no pin to measure from");
    const result = measure(this.pin.point, to);
    this.measurement = { to: [to[0], to[1], to[2]], result };
    this.measuring = false;
    this.changed();
    return result;
  }

  /** Per frame: the banner scaled, turned and dropped; its card and the measuring line placed. */
  update(camera: Camera, viewWidth: number, height: number) {
    const pin = this.pin;
    if (!pin) {
      this.screen = null;
      this.measureScreen = null;
      this.placeCard();
      this.placeMeasure();
      return;
    }
    const facing =
      Math.round(this.host.cameraYaw() / (Math.PI / 4)) * (Math.PI / 4);
    // Seen from high above a standing banner is a sliver; it leans back
    // toward the camera, in whole steps, so a map view still shows its face.
    const lean =
      Math.round(Math.max(0, this.host.cameraPitch() - LEAN_FROM) / LEAN_STEP) *
      LEAN_STEP;
    const scale = this.scaleAt(camera, pin.point, height);
    const lift = this.dropLift(performance.now()) * PIN_HEIGHT * scale;
    const pop = this.hovered || this.selected ? POP : 1;
    for (const s of this.scenes) {
      if (!s.model) continue;
      s.model.group.position.set(
        pin.point[0],
        pin.point[1] + lift,
        pin.point[2],
      );
      s.model.group.rotation.set(-lean, facing, 0, "YXZ");
      s.model.group.scale.setScalar(scale * pop);
      s.model.group.updateMatrixWorld(true);
    }
    const base = project(camera, pin.point, viewWidth, height);
    const top = project(
      camera,
      [
        pin.point[0],
        pin.point[1] + lift + PIN_HEIGHT * scale * pop,
        pin.point[2],
      ],
      viewWidth,
      height,
    );
    this.screen = {
      base: base.xy,
      top: top.xy,
      visible: base.visible && top.visible,
    };
    if (this.measurement) {
      const to = project(camera, this.measurement.to, viewWidth, height);
      this.measureScreen = { base: to.xy, top: to.xy, visible: to.visible };
    } else {
      this.measureScreen = null;
    }
    this.placeCard();
    this.placeMeasure();
  }

  /** The measuring line, drawn as whole-pixel dashes on the HUD canvas. */
  drawHud(context: CanvasRenderingContext2D) {
    const a = this.screen;
    const b = this.measureScreen;
    if (!a?.visible || !b?.visible) return;
    const [ax, ay] = a.base;
    const [bx, by] = b.base;
    const steps = Math.max(1, Math.floor(Math.hypot(bx - ax, by - ay) / 6));
    for (let i = 0; i <= steps; i += 2) {
      const x = Math.round(ax + ((bx - ax) * i) / steps);
      const y = Math.round(ay + ((by - ay) * i) / steps);
      context.fillStyle = this.options.theme.outline;
      context.fillRect(x - 2, y - 2, 4, 4);
      context.fillStyle = this.options.theme.accent;
      context.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  /** The pin as a URL parameter value; empty when there is none. */
  serialized() {
    return this.pin ? serializePin(this.pin.point) : "";
  }

  dispose() {
    this.attach([]);
    this.wheel.close(false);
    this.ui.remove();
  }

  // ----

  private context(
    target: PinTarget,
    args: Record<string, unknown>,
  ): PinActionContext {
    return { target, host: this.host, pins: this, args };
  }

  /** Eye height the actions stand a player at. */
  get standingEyeHeight() {
    return this.options.standingEyeHeight;
  }

  /** Puts `pin` up as the one pin, falling into place when `animate`. */
  private place(pin: Pin, animate = true) {
    this.pin = pin;
    this.measuring = false;
    this.measurement = null;
    this.droppedAt = animate ? performance.now() : null;
    this.addModels();
  }

  private clickPin(x: number, y: number) {
    if (!this.pin) return;
    this.selected = true;
    const [wx, wy] = this.screen?.visible ? this.screen.top : [x, y];
    this.openWheel(
      { pin: this.pin, point: this.pin.point },
      wx,
      wy - 10,
      "click",
    );
  }

  private hold(press: Press) {
    if (this.press !== press || press.moved) return;
    press.held = true;
    press.timer = null;
    const target = this.targetAt(press.onPin, press.x, press.y);
    if (!target) {
      press.held = false;
      return;
    }
    if (press.onPin) this.selected = true;
    this.host.releaseCamera();
    this.openWheel(target, press.x, press.y, "hold");
  }

  /** The pin when the press was on it, else the ground under (x, y). */
  private targetAt(onPin: boolean, x: number, y: number): PinTarget | null {
    if (onPin && this.pin) return { pin: this.pin, point: this.pin.point };
    const point = this.host.pickGround(x, y);
    return point ? { pin: null, point } : null;
  }

  private async describe(point: Vec3): Promise<PinFact[]> {
    const facts: PinFact[] = [
      { label: "Position", value: formatCoordinates(point) },
      { label: "Height", value: String(Math.round(point[1])) },
    ];
    try {
      const column = (await this.host.query(point[0], point[2])) as {
        top?: { name?: string } | null;
        ground?: { name?: string } | null;
        source?: unknown;
      } | null;
      if (!column) {
        facts.push({ label: "Column", value: "not loaded" });
        return facts;
      }
      const block = column.top?.name ?? column.ground?.name;
      if (block) facts.push({ label: "Block", value: block });
      if (column.ground?.name && column.ground.name !== block) {
        facts.push({ label: "Ground", value: column.ground.name });
      }
      facts.push(...(this.options.describe?.(column.source) ?? []));
    } catch (error) {
      facts.push({
        label: "Column",
        value: `unavailable: ${(error as Error).message}`,
      });
    }
    return facts;
  }

  private addModels() {
    const t = this.options.theme;
    const colors = {
      cloth: t.pinCloth[0],
      pole: t.pinPole,
      cap: t.pinCap,
      letter: t.pinLetter,
    };
    for (const s of this.scenes) {
      if (s.model) continue;
      s.model = new PinModel(colors, "", s.lighting);
      s.scene.add(s.model.group);
    }
  }

  private dropModel(s: PinScene) {
    if (!s.model) return;
    s.scene.remove(s.model.group);
    s.model.dispose();
    s.model = null;
  }

  private iconFor(action: PinAction): string {
    const cached = this.iconCache.get(action.id);
    if (cached) return cached;
    const icon =
      action.icon ??
      this.options.theme.icons[action.id] ??
      builtinIcon(action.id, this.options.theme) ??
      builtinIcon("pin", this.options.theme) ??
      "";
    this.iconCache.set(action.id, icon);
    return icon;
  }

  /** The scale that keeps the pin `screenHeight` pixels tall, never below life size. */
  private scaleAt(camera: Camera, point: Vec3, height: number): number {
    let pixelsPerBlock: number;
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as PerspectiveCamera;
      const distance = Math.max(
        0.1,
        perspective.position.distanceTo(
          new Vector3(point[0], point[1], point[2]),
        ),
      );
      pixelsPerBlock =
        height / (2 * distance * Math.tan((perspective.fov * Math.PI) / 360));
    } else {
      const o = camera as unknown as {
        top: number;
        bottom: number;
        zoom: number;
      };
      pixelsPerBlock = (height * o.zoom) / Math.max(1e-6, o.top - o.bottom);
    }
    return Math.max(
      1,
      this.options.screenHeight / (PIN_HEIGHT * pixelsPerBlock),
    );
  }

  private dropLift(now: number): number {
    if (this.droppedAt === null) return 0;
    const step = Math.floor((now - this.droppedAt) / DROP_STEP_MS);
    if (step >= DROP_STEPS.length - 1) {
      this.droppedAt = null;
      return 0;
    }
    return DROP_STEPS[step];
  }

  private hitPin(x: number, y: number): boolean {
    const s = this.screen;
    if (!this.pin || !s?.visible) return false;
    const tall = Math.max(12, s.base[1] - s.top[1]);
    const left = s.base[0] - tall * 0.12;
    const right = s.base[0] + tall * 0.42;
    return !(x < left || x > right || y < s.top[1] - 4 || y > s.base[1] + 4);
  }

  private placeCard() {
    const pin = this.pin;
    const s = this.screen;
    if (!pin || !this.selected || !s?.visible || this.wheel.isOpen) {
      this.card.style.display = "none";
      return;
    }
    const signature = JSON.stringify(pin.facts);
    if (this.card.dataset.signature !== signature) {
      this.card.dataset.signature = signature;
      this.card.replaceChildren();
      const title = document.createElement("div");
      title.className = `${this.options.prefix}-card-title`;
      title.textContent = "Pin";
      this.card.append(title);
      const facts = pin.facts.length
        ? pin.facts
        : [{ label: "Position", value: formatCoordinates(pin.point) }];
      for (const fact of facts) {
        const row = document.createElement("div");
        row.className = `${this.options.prefix}-row`;
        const k = document.createElement("span");
        k.textContent = fact.label;
        const v = document.createElement("span");
        v.textContent = fact.value;
        row.append(k, v);
        this.card.append(row);
      }
    }
    this.card.style.display = "";
    this.card.style.transform = `translate(${Math.round(s.base[0] + 26)}px, ${Math.round(s.top[1])}px)`;
  }

  private placeMeasure() {
    const m = this.measurement;
    const a = this.screen;
    const b = this.measureScreen;
    if (!m || !a?.visible || !b?.visible) {
      this.measureLabel.style.display = "none";
      return;
    }
    const text = describeMeasurement(m.result);
    if (this.measureLabel.textContent !== text)
      this.measureLabel.textContent = text;
    this.measureLabel.style.display = "";
    const x = (a.base[0] + b.base[0]) / 2 - this.measureLabel.offsetWidth / 2;
    const y = (a.base[1] + b.base[1]) / 2 + 10;
    this.measureLabel.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private panel(className: string) {
    const div = document.createElement("div");
    div.className = `${this.options.prefix}-panel ${className}`;
    div.style.display = "none";
    this.ui.append(div);
    return div;
  }

  private say(message: string) {
    if (!message) return;
    this.toast.textContent = message;
    this.toast.style.display = "";
    const width = this.container.clientWidth;
    this.toast.style.transform = `translate(${Math.round(width / 2 - this.toast.offsetWidth / 2)}px, 12px)`;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.style.display = "none";
    }, 2400);
  }

  private changed() {
    if (this.options.persistInUrl && typeof history !== "undefined") {
      const url = new URL(window.location.href);
      const text = this.serialized();
      if (text) url.searchParams.set(URL_PARAM, text);
      else url.searchParams.delete(URL_PARAM);
      url.searchParams.delete(LEGACY_URL_PARAM);
      if (url.href !== window.location.href)
        history.replaceState(history.state, "", url);
    }
    this.onChange();
  }
}

function project(
  camera: Camera,
  point: Vec3,
  width: number,
  height: number,
): { xy: [number, number]; visible: boolean } {
  const v = new Vector3(point[0], point[1], point[2]).project(camera);
  return {
    xy: [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height],
    visible: v.z > -1 && v.z < 1,
  };
}

export function describeMeasurement(m: Measurement): string {
  const rise = `${m.rise >= 0 ? "+" : ""}${m.rise.toFixed(1)}`;
  const slope =
    m.slopePercent === null
      ? "vertical"
      : `${m.slopePercent.toFixed(0)}% (${m.slopeDegrees.toFixed(1)}°)`;
  return `${m.horizontal.toFixed(1)} blocks across · ${rise} up · slope ${slope}`;
}

async function copy(text: string): Promise<string | null> {
  try {
    await navigator.clipboard.writeText(text);
    return null;
  } catch (error) {
    return (error as Error).message || "the clipboard refused";
  }
}

const isPoint = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((v) => typeof v === "number" && Number.isFinite(v));

/** The built-in actions, in wheel order (clockwise from the top). */
function builtinActions(): PinAction[] {
  const spawnPose = (ctx: PinActionContext) =>
    standingPose(
      ctx.target.point,
      ctx.host.cameraYaw(),
      ctx.pins.standingEyeHeight,
    );
  const needsLink = (ctx: PinActionContext) =>
    ctx.host.linkFor(spawnPose(ctx)) ? null : "this viewer has no game link";
  return [
    {
      id: "spawn",
      label: "Spawn here",
      key: "s",
      unavailable: needsLink,
      run(ctx) {
        const pose = spawnPose(ctx);
        const link = ctx.host.linkFor(pose);
        if (!link)
          return { action: "spawn", ok: false, message: "no game link" };
        const opened =
          ctx.args.open === false ? null : window.open(link, "_blank");
        return {
          action: "spawn",
          ok: true,
          link,
          pose,
          opened: opened !== null,
          message:
            ctx.args.open === false
              ? "Spawn link ready"
              : "Opening the game here",
        };
      },
    },
    {
      id: "fly",
      label: "Fly here",
      key: "f",
      async run(ctx) {
        const flight = await ctx.host.flyTo(ctx.target.point);
        return { action: "fly", ok: true, flight, message: "" };
      },
    },
    {
      id: "look",
      label: "Look from here",
      key: "l",
      async run(ctx) {
        const pose = spawnPose(ctx);
        const flight = await ctx.host.flyToPose(pose, "free");
        return {
          action: "look",
          ok: true,
          pose,
          flight,
          message: "Standing at eye height",
        };
      },
    },
    {
      id: "measure",
      label: "Measure from the pin",
      key: "m",
      unavailable: (ctx) =>
        ctx.pins.current() ? null : "drop a pin to measure from",
      run(ctx) {
        // On the pin it waits for a spot; over the ground it measures there.
        const to = ctx.args.to ?? (ctx.target.pin ? null : ctx.target.point);
        if (to === null) {
          ctx.pins.startMeasure();
          return {
            action: "measure",
            ok: true,
            waiting: true,
            message: "Click a spot to measure to",
          };
        }
        if (!isPoint(to)) {
          return {
            action: "measure",
            ok: false,
            message: `cannot measure to ${JSON.stringify(to)}; give x,y,z`,
          };
        }
        const result = ctx.pins.measureTo(to);
        return {
          action: "measure",
          ok: true,
          measurement: result,
          message: describeMeasurement(result),
        };
      },
    },
    {
      id: "bookmark",
      label: "Bookmark",
      key: "b",
      async run(ctx) {
        const { point } = ctx.target;
        const current = ctx.host.pose();
        const eye: Vec3 = [
          point[0] + current.eye[0] - current.look[0],
          point[1] + current.eye[1] - current.look[1],
          point[2] + current.eye[2] - current.look[2],
        ];
        const label = formatCoordinates(point);
        const bookmark = await ctx.host.addBookmark({
          id: `pin-${Math.floor(point[0])}-${Math.floor(point[2])}-${Date.now().toString(36)}`,
          label,
          pose: { eye, look: [...point] as Vec3 },
          preset: ctx.host.preset() as Bookmark["preset"],
        });
        return {
          action: "bookmark",
          ok: true,
          bookmark,
          message: `Bookmarked ${label}`,
        };
      },
    },
    {
      id: "copy-link",
      label: "Copy share link",
      key: "k",
      unavailable: needsLink,
      async run(ctx) {
        const link = ctx.host.linkFor(spawnPose(ctx));
        if (!link)
          return { action: "copy-link", ok: false, message: "no game link" };
        const failed = await copy(link);
        return {
          action: "copy-link",
          ok: failed === null,
          link,
          message: failed
            ? `Could not copy: ${failed}`
            : "Copied the game link",
        };
      },
    },
    {
      id: "copy-coords",
      label: "Copy coordinates",
      key: "c",
      async run(ctx) {
        const text = formatCoordinates(ctx.target.point);
        const failed = await copy(text);
        return {
          action: "copy-coords",
          ok: failed === null,
          text,
          message: failed ? `Could not copy: ${failed}` : `Copied ${text}`,
        };
      },
    },
    {
      id: "remove",
      label: "Remove pin",
      key: "x",
      run(ctx) {
        const removed = ctx.pins.remove();
        return {
          action: "remove",
          ok: removed,
          message: removed ? "Removed the pin" : "nothing pinned here",
        };
      },
    },
    {
      id: "pin",
      label: "Pin here",
      key: "p",
      async run(ctx) {
        const pin = await ctx.pins.drop(ctx.target.point);
        return {
          action: "pin",
          ok: true,
          pin,
          message: `Pinned ${formatCoordinates(pin.point)}`,
        };
      },
    },
  ];
}
