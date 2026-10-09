/**
 * Pins on the terrain and the action wheel around them. A click drops a
 * pin (a double-click that follows turns into a flight and takes the pin
 * back); clicking a pin, right-clicking anywhere, or holding a pin or the
 * right button opens the wheel; actions run on the pin, or on the bare
 * ground point when the wheel was opened over terrain.
 *
 * Pins are voxel banners in every view's scene, with a pixel tag over each
 * and a card for the selected one. The list lives in the URL, so a link to
 * the viewer carries its pins.
 */
import type { Camera, PerspectiveCamera, Scene } from "three";
import { Vector3 } from "three";

import { builtinIcon } from "./pin-art";
import { PIN_HEIGHT, PinModel, type PinLighting } from "./pin-model";
import {
  formatCoordinates,
  measure,
  type Measurement,
  nextPinLabel,
  parsePins,
  type Pin,
  type PinFact,
  serializePins,
  standingPose,
} from "./pins";
import type { Bookmark, Pose, Vec3 } from "./pose";
import { type ViewerTheme, themeCss } from "./theme";
import { RadialWheel, type WheelMode } from "./wheel";

/** What an action runs on: a pin, or a ground point the wheel was opened over. */
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
  /** How tall a pin stays on screen, CSS pixels (it is never drawn smaller than life). */
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
  /** Keep the pins in the page URL (`pins=`). */
  persistInUrl: boolean;
};

type PinScene = {
  scene: Scene;
  lighting: PinLighting;
  models: Map<string, PinModel>;
};

type Press = {
  x: number;
  y: number;
  button: number;
  at: number;
  pin: Pin | null;
  timer: ReturnType<typeof setTimeout> | null;
  held: boolean;
  moved: boolean;
};

const URL_PARAM = "pins";
/** Stepped drop: the banner falls to the ground in three whole steps. */
const DROP_STEPS = [0.7, 0.3, 0];
const DROP_STEP_MS = 45;
/** A hovered or selected pin stands this much taller, in one step. */
const POP = 1.12;
/** Camera pitch past which a banner starts leaning back toward it, and the step it leans in. */
const LEAN_FROM = 0.6;
const LEAN_STEP = Math.PI / 12;

export class PinLayer {
  readonly ui: HTMLDivElement;

  private pins: Pin[] = [];

  private scenes: PinScene[] = [];

  private tags = new Map<string, HTMLDivElement>();

  private card: HTMLDivElement;

  private toast: HTMLDivElement;

  private measureLabel: HTMLDivElement;

  private wheel: RadialWheel;

  private selected: string | null = null;

  private hovered: string | null = null;

  private dropped = new Map<string, number>();

  private press: Press | null = null;

  private lastClickPin: {
    id: string;
    at: number;
    x: number;
    y: number;
  } | null = null;

  /** How the last press ended, so the click event that follows it can be read. */
  private lastRelease: {
    x: number;
    y: number;
    moved: boolean;
    handled: boolean;
  } | null = null;

  private measuring: { from: string } | null = null;

  private measurement: {
    from: string;
    to: string;
    result: Measurement;
  } | null = null;

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private nextId = 1;

  private screen = new Map<
    string,
    { base: [number, number]; top: [number, number]; visible: boolean }
  >();

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

  list(): Pin[] {
    return this.pins.map((p) => ({
      ...p,
      point: [...p.point] as Vec3,
      facts: [...p.facts],
    }));
  }

  get wheelOpen() {
    return this.wheel.isOpen;
  }

  get highlightedAction() {
    return this.wheel.highlighted;
  }

  /** The views' scenes and lighting; models follow them across source changes. */
  attach(views: { scene: Scene; lighting: PinLighting }[]) {
    for (const old of this.scenes) {
      for (const model of old.models.values()) {
        old.scene.remove(model.group);
        model.dispose();
      }
    }
    this.scenes = views.map((v) => ({ ...v, models: new Map() }));
    for (const pin of this.pins) this.addModels(pin);
  }

  /** Drops a pin at `point`; resolves once the source has described the column. */
  async drop(point: Vec3, label?: string): Promise<Pin> {
    const pin: Pin = {
      id: `pin-${this.nextId++}`,
      label: label?.trim() || nextPinLabel(this.pins),
      point: [point[0], point[1], point[2]],
      facts: [],
    };
    this.pins.push(pin);
    this.dropped.set(pin.id, performance.now());
    this.addModels(pin);
    this.selected = pin.id;
    this.changed();
    pin.facts = await this.describe(pin.point);
    this.changed();
    return { ...pin };
  }

  /** Restores pins (from a URL); facts load in the background. */
  restore(entries: { label: string; point: Vec3 }[]) {
    for (const entry of entries) void this.drop(entry.point, entry.label);
    this.selected = null;
  }

  restoreFromUrl(search: string) {
    const text = new URLSearchParams(search).get(URL_PARAM);
    if (text) this.restore(parsePins(text));
  }

  remove(id: string): boolean {
    const index = this.pins.findIndex((p) => p.id === id);
    if (index < 0) return false;
    this.pins.splice(index, 1);
    for (const s of this.scenes) {
      const model = s.models.get(id);
      if (model) {
        s.scene.remove(model.group);
        model.dispose();
        s.models.delete(id);
      }
    }
    this.tags.get(id)?.remove();
    this.tags.delete(id);
    if (this.selected === id) this.selected = null;
    if (this.measuring?.from === id) this.measuring = null;
    if (
      this.measurement &&
      (this.measurement.from === id || this.measurement.to === id)
    ) {
      this.measurement = null;
    }
    this.changed();
    return true;
  }

  rename(id: string, label: string): boolean {
    const pin = this.find(id);
    if (!pin || !label.trim()) return false;
    pin.label = label.trim();
    this.restyle(pin);
    this.changed();
    return true;
  }

  /** A pin by id or by label. */
  find(idOrLabel: string): Pin | null {
    return (
      this.pins.find((p) => p.id === idOrLabel) ??
      this.pins.find((p) => p.label === idOrLabel) ??
      null
    );
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
    const name = target.pin ? `${target.pin.label} · ` : "";
    this.wheel.open({
      x,
      y,
      items,
      mode,
      title: `${name}${formatCoordinates(target.point)}`,
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
    const pin = this.hitPin(x, y);
    const press: Press = {
      x,
      y,
      button,
      at: performance.now(),
      pin,
      timer: null,
      held: false,
      moved: false,
    };
    if ((button === 0 && pin) || button === 2) {
      press.timer = setTimeout(() => this.hold(press), this.options.holdMs);
    }
    this.press = press;
    return pin !== null && button === 0;
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
      const hovered = this.hitPin(x, y)?.id ?? null;
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
      const target = press.pin
        ? { pin: press.pin, point: press.pin.point }
        : this.groundTarget(x, y);
      if (target) this.openWheel(target, x, y, "click");
      return true;
    }
    if (button === 0 && press.pin) {
      this.clickPin(press.pin, x, y);
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
    void this.drop(point).then((pin) => {
      if (this.measuring) this.finishMeasure(pin.id);
    });
    const id = this.pins[this.pins.length - 1]?.id;
    if (id) this.lastClickPin = { id, at: performance.now(), x, y };
    return true;
  }

  /**
   * A double-click at (x, y): takes back the pin its first click dropped and
   * returns the point to fly to (a pin's own, when it was on one).
   */
  doubleClick(x: number, y: number): Vec3 | null {
    const last = this.lastClickPin;
    this.lastClickPin = null;
    if (
      last &&
      performance.now() - last.at < this.options.doubleClickMs &&
      Math.hypot(x - last.x, y - last.y) <= this.options.clickSlop * 2
    ) {
      this.remove(last.id);
    }
    this.wheel.close(false);
    const pin = this.hitPin(x, y);
    return pin ? pin.point : this.host.pickGround(x, y);
  }

  /** A key; true when the layer used it (the camera must not). */
  key(event: KeyboardEvent): boolean {
    if (this.wheel.isOpen) return this.wheel.key(event);
    if (
      event.key === "Escape" &&
      (this.selected || this.measuring || this.measurement)
    ) {
      this.selected = null;
      this.measuring = null;
      this.measurement = null;
      this.changed();
      return true;
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      this.selected
    ) {
      this.remove(this.selected);
      return true;
    }
    return false;
  }

  /** Starts or completes a measurement from `fromId`. */
  measureFrom(fromId: string, toId?: string): Measurement | null {
    const other =
      toId ?? [...this.pins].reverse().find((p) => p.id !== fromId)?.id ?? null;
    if (!other) {
      this.measuring = { from: fromId };
      this.changed();
      return null;
    }
    return this.measureBetween(fromId, other);
  }

  measureBetween(fromId: string, toId: string): Measurement {
    const from = this.find(fromId);
    const to = this.find(toId);
    if (!from || !to)
      throw new Error(`no pin ${from ? toId : fromId} to measure with`);
    const result = measure(from.point, to.point);
    this.measurement = { from: from.id, to: to.id, result };
    this.measuring = null;
    this.changed();
    return result;
  }

  /** Per frame: models scaled, turned and dropped; tags, card and measuring line placed. */
  update(camera: Camera, viewWidth: number, height: number) {
    const now = performance.now();
    const facing =
      Math.round(this.host.cameraYaw() / (Math.PI / 4)) * (Math.PI / 4);
    // Seen from high above a standing banner is a sliver; it leans back
    // toward the camera, in whole steps, so a map view still shows its face.
    const lean =
      Math.round(Math.max(0, this.host.cameraPitch() - LEAN_FROM) / LEAN_STEP) *
      LEAN_STEP;
    for (const pin of this.pins) {
      const scale = this.scaleAt(camera, pin.point, height);
      const lift = this.dropLift(pin.id, now) * PIN_HEIGHT * scale;
      const pop = pin.id === this.hovered || pin.id === this.selected ? POP : 1;
      for (const s of this.scenes) {
        const model = s.models.get(pin.id);
        if (!model) continue;
        model.group.position.set(
          pin.point[0],
          pin.point[1] + lift,
          pin.point[2],
        );
        model.group.rotation.set(-lean, facing, 0, "YXZ");
        model.group.scale.setScalar(scale * pop);
        model.group.updateMatrixWorld(true);
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
      this.screen.set(pin.id, {
        base: base.xy,
        top: top.xy,
        visible: base.visible && top.visible,
      });
      this.placeTag(pin, top.xy, base.visible && top.visible);
    }
    this.placeCard();
    this.placeMeasure();
  }

  /** The measuring line, drawn as whole-pixel dashes on the HUD canvas. */
  drawHud(context: CanvasRenderingContext2D) {
    const m = this.measurement;
    if (!m) return;
    const a = this.screen.get(m.from);
    const b = this.screen.get(m.to);
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

  /** Pins as a URL parameter value. */
  serialized() {
    return serializePins(this.pins);
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

  private clickPin(pin: Pin, x: number, y: number) {
    if (this.measuring && this.measuring.from !== pin.id) {
      this.finishMeasure(pin.id);
      return;
    }
    this.selected = pin.id;
    const at = this.screen.get(pin.id);
    const [wx, wy] = at ? at.top : [x, y];
    this.openWheel({ pin, point: pin.point }, wx, wy - 10, "click");
  }

  private hold(press: Press) {
    if (this.press !== press || press.moved) return;
    press.held = true;
    press.timer = null;
    const target = press.pin
      ? { pin: press.pin, point: press.pin.point }
      : this.groundTarget(press.x, press.y);
    if (!target) {
      press.held = false;
      return;
    }
    if (press.pin) this.selected = press.pin.id;
    this.host.releaseCamera();
    this.openWheel(target, press.x, press.y, "hold");
  }

  private finishMeasure(toId: string) {
    const from = this.measuring?.from;
    if (!from || from === toId) return;
    const result = this.measureBetween(from, toId);
    this.say(describeMeasurement(result));
  }

  private groundTarget(x: number, y: number): PinTarget | null {
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

  private addModels(pin: Pin) {
    const colors = this.colorsFor(pin);
    for (const s of this.scenes) {
      if (s.models.has(pin.id)) continue;
      const model = new PinModel(colors, pin.label, s.lighting);
      s.scene.add(model.group);
      s.models.set(pin.id, model);
    }
  }

  private restyle(pin: Pin) {
    for (const s of this.scenes)
      s.models.get(pin.id)?.restyle(this.colorsFor(pin), pin.label);
  }

  private colorsFor(pin: Pin) {
    const t = this.options.theme;
    const index = Number(pin.id.replace(/\D/g, "")) - 1;
    return {
      cloth:
        t.pinCloth[
          ((index % t.pinCloth.length) + t.pinCloth.length) % t.pinCloth.length
        ],
      pole: t.pinPole,
      cap: t.pinCap,
      letter: t.pinLetter,
    };
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

  /** The scale that keeps a pin `screenHeight` pixels tall, never below life size. */
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

  private dropLift(id: string, now: number): number {
    const at = this.dropped.get(id);
    if (at === undefined) return 0;
    const step = Math.floor((now - at) / DROP_STEP_MS);
    if (step >= DROP_STEPS.length - 1) {
      this.dropped.delete(id);
      return 0;
    }
    return DROP_STEPS[step];
  }

  private hitPin(x: number, y: number): Pin | null {
    let best: { pin: Pin; depth: number } | null = null;
    for (const pin of this.pins) {
      const s = this.screen.get(pin.id);
      if (!s?.visible) continue;
      const tall = Math.max(12, s.base[1] - s.top[1]);
      const left = s.base[0] - tall * 0.12;
      const right = s.base[0] + tall * 0.42;
      if (x < left || x > right || y < s.top[1] - 4 || y > s.base[1] + 4)
        continue;
      const depth = -s.base[1];
      if (!best || depth < best.depth) best = { pin, depth };
    }
    return best?.pin ?? null;
  }

  private placeTag(pin: Pin, at: [number, number], visible: boolean) {
    let tag = this.tags.get(pin.id);
    if (!tag) {
      tag = document.createElement("div");
      tag.className = `${this.options.prefix}-tag`;
      tag.dataset.pin = pin.id;
      this.ui.append(tag);
      this.tags.set(pin.id, tag);
    }
    if (tag.textContent !== pin.label) tag.textContent = pin.label;
    tag.classList.toggle("is-selected", pin.id === this.selected);
    tag.style.display = visible ? "" : "none";
    tag.style.transform = `translate(${Math.round(at[0] - tag.offsetWidth / 2)}px, ${Math.round(at[1] - tag.offsetHeight - 4)}px)`;
  }

  private placeCard() {
    const pin = this.selected ? this.find(this.selected) : null;
    const s = pin ? this.screen.get(pin.id) : null;
    if (!pin || !s?.visible || this.wheel.isOpen) {
      this.card.style.display = "none";
      return;
    }
    const signature = JSON.stringify([pin.label, pin.facts]);
    if (this.card.dataset.signature !== signature) {
      this.card.dataset.signature = signature;
      this.card.replaceChildren();
      const title = document.createElement("div");
      title.className = `${this.options.prefix}-card-title`;
      title.textContent = `Pin ${pin.label}`;
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
    const a = m ? this.screen.get(m.from) : null;
    const b = m ? this.screen.get(m.to) : null;
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
      label: "Measure",
      key: "m",
      run(ctx) {
        const pin = ctx.target.pin;
        if (!pin)
          return {
            action: "measure",
            ok: false,
            message: "pin this spot first",
          };
        const to =
          typeof ctx.args.to === "string"
            ? ctx.pins.find(ctx.args.to)?.id
            : undefined;
        if (typeof ctx.args.to === "string" && !to) {
          return {
            action: "measure",
            ok: false,
            message: `no pin ${ctx.args.to}`,
          };
        }
        const result = ctx.pins.measureFrom(pin.id, to);
        return result
          ? {
              action: "measure",
              ok: true,
              measurement: result,
              message: describeMeasurement(result),
            }
          : {
              action: "measure",
              ok: true,
              waiting: true,
              message: "Click a spot or a pin to measure to",
            };
      },
    },
    {
      id: "bookmark",
      label: "Bookmark",
      key: "b",
      async run(ctx) {
        const { point, pin } = ctx.target;
        const current = ctx.host.pose();
        const eye: Vec3 = [
          point[0] + current.eye[0] - current.look[0],
          point[1] + current.eye[1] - current.look[1],
          point[2] + current.eye[2] - current.look[2],
        ];
        const label = `${pin ? `${pin.label} ` : ""}${formatCoordinates(point)}`;
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
        const pin = ctx.target.pin;
        if (!pin)
          return {
            action: "remove",
            ok: false,
            message: "nothing pinned here",
          };
        ctx.pins.remove(pin.id);
        return { action: "remove", ok: true, message: `Removed ${pin.label}` };
      },
    },
    {
      id: "pin",
      label: "Pin here",
      key: "p",
      async run(ctx) {
        const pin = await ctx.pins.drop(ctx.target.point);
        return { action: "pin", ok: true, pin, message: `Pinned ${pin.label}` };
      },
    },
  ];
}
