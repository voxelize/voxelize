/**
 * A radial action wheel in the style of a game's ping wheel: icons in a
 * ring around a hub that names the highlighted action. Opened by a click it
 * waits for a click, a key or Esc; opened by a hold it follows the flick
 * and fires on release. It moves in whole steps, never eases.
 */

export type WheelItem = {
  id: string;
  label: string;
  /** A single key that fires it while the wheel is open. */
  key: string;
  /** Image URL of a 16x16 pixel icon. */
  icon: string;
  /** Why it cannot run now; null or absent when it can. */
  disabled?: string | null;
};

export type WheelMode = "click" | "hold";

export type WheelRequest = {
  /** Centre, in the parent's CSS pixels. */
  x: number;
  y: number;
  items: WheelItem[];
  mode: WheelMode;
  title: string;
  subtitle?: string;
  onPick: (id: string) => void;
  onClose?: () => void;
};

/**
 * The slot in direction (dx, dy) from the centre (screen axes, y down), or
 * null inside the dead zone. Slot 0 is straight up; they count clockwise.
 */
export function sectorAt(
  dx: number,
  dy: number,
  count: number,
  deadzone: number,
): number | null {
  if (count <= 0 || Math.hypot(dx, dy) < deadzone) return null;
  const full = Math.PI * 2;
  const angle = (Math.atan2(dx, -dy) + full) % full;
  return Math.floor((angle + Math.PI / count) / (full / count)) % count;
}

/** Offset of slot `index` of `count` from the centre, `radius` away (slot 0 up, clockwise). */
export function slotOffset(
  index: number,
  count: number,
  radius: number,
): [number, number] {
  const angle = (index / count) * Math.PI * 2;
  // `+ 0` turns a rounded -0 into 0.
  return [
    Math.round(Math.sin(angle) * radius) + 0,
    Math.round(-Math.cos(angle) * radius) + 0,
  ];
}

export class RadialWheel {
  private root: HTMLDivElement | null = null;

  private hub: HTMLDivElement | null = null;

  private slots: HTMLDivElement[] = [];

  private request: WheelRequest | null = null;

  private hot: number | null = null;

  private center: [number, number] = [0, 0];

  constructor(
    private readonly parent: HTMLElement,
    private readonly prefix: string,
    /** Distance from the hub to each slot, CSS pixels. */
    private readonly radius = 76,
    /** A flick shorter than this picks nothing. */
    private readonly deadzone = 18,
  ) {}

  get isOpen() {
    return this.request !== null;
  }

  get mode(): WheelMode | null {
    return this.request?.mode ?? null;
  }

  /** The highlighted item's id, if any. */
  get highlighted(): string | null {
    return this.hot === null ? null : this.request?.items[this.hot]?.id ?? null;
  }

  open(request: WheelRequest) {
    this.close(false);
    this.request = request;
    const margin = this.radius + 30;
    const below = this.radius + 72;
    const width = this.parent.clientWidth;
    const height = this.parent.clientHeight;
    const x = Math.round(
      Math.min(Math.max(request.x, margin), Math.max(margin, width - margin)),
    );
    const y = Math.round(
      Math.min(Math.max(request.y, margin), Math.max(margin, height - below)),
    );
    this.center = [x, y];
    const root = document.createElement("div");
    root.className = `${this.prefix}-wheel`;
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.dataset.mode = request.mode;
    // Presses on the wheel are the wheel's, never the camera's.
    root.addEventListener("pointerdown", (e) => e.stopPropagation());
    root.addEventListener("dblclick", (e) => e.stopPropagation());
    const pip = document.createElement("div");
    pip.className = `${this.prefix}-pip`;
    // The label sits under the ring, clear of the icons.
    const hub = document.createElement("div");
    hub.className = `${this.prefix}-panel ${this.prefix}-hub`;
    root.append(pip, hub);
    this.hub = hub;
    this.slots = request.items.map((item, i) => {
      const slot = document.createElement("div");
      slot.className = `${this.prefix}-slot${item.disabled ? " is-off" : ""}`;
      slot.dataset.action = item.id;
      slot.title = item.disabled
        ? `${item.label}: ${item.disabled}`
        : item.label;
      const icon = document.createElement("img");
      icon.src = item.icon;
      icon.alt = item.label;
      icon.draggable = false;
      const key = document.createElement("span");
      key.className = `${this.prefix}-key`;
      key.textContent = item.key.toUpperCase();
      slot.append(icon, key);
      slot.style.transform = "translate(0px, 0px) scale(0.4)";
      slot.style.opacity = "0";
      if (request.mode === "click") {
        slot.addEventListener("pointerenter", () => this.setHot(i));
        slot.addEventListener("pointerleave", () => this.setHot(null));
        slot.addEventListener("click", (e) => {
          e.stopPropagation();
          this.pick(i);
        });
      }
      root.append(slot);
      return slot;
    });
    this.parent.append(root);
    this.root = root;
    this.setHot(null);
    // One frame later, so the stepped transition runs from the hub outward.
    requestAnimationFrame(() => {
      if (this.root !== root) return;
      this.slots.forEach((slot, i) => {
        const [dx, dy] = slotOffset(i, this.slots.length, this.radius);
        slot.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
        slot.style.opacity = "1";
      });
    });
  }

  /** Hold mode: the pointer moved to (x, y) in the parent's CSS pixels. */
  point(x: number, y: number) {
    if (!this.request) return;
    const hot = sectorAt(
      x - this.center[0],
      y - this.center[1],
      this.request.items.length,
      this.deadzone,
    );
    this.setHot(hot);
  }

  /** Hold mode: letting go fires the highlighted action, or closes the wheel. */
  release() {
    if (this.hot !== null && !this.request?.items[this.hot]?.disabled) {
      this.pick(this.hot);
    } else {
      this.close();
    }
  }

  /** Handles a key while open; true when the key was the wheel's. */
  key(event: KeyboardEvent): boolean {
    if (!this.request) return false;
    if (event.key === "Escape") {
      this.close();
      return true;
    }
    const items = this.request.items;
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= items.length) {
      this.pick(digit - 1);
      return true;
    }
    const index = items.findIndex(
      (item) => item.key.toLowerCase() === event.key.toLowerCase(),
    );
    if (index >= 0) this.pick(index);
    return true;
  }

  close(notify = true) {
    const request = this.request;
    this.root?.remove();
    this.root = null;
    this.hub = null;
    this.slots = [];
    this.request = null;
    this.hot = null;
    if (notify) request?.onClose?.();
  }

  private pick(index: number) {
    const request = this.request;
    const item = request?.items[index];
    if (!request || !item) return;
    if (item.disabled) {
      this.setHot(index);
      return;
    }
    this.close(false);
    request.onPick(item.id);
  }

  private setHot(index: number | null) {
    this.hot = index;
    this.slots.forEach((slot, i) =>
      slot.classList.toggle("is-hot", i === index),
    );
    const request = this.request;
    if (!request || !this.hub) return;
    const item = index === null ? null : request.items[index];
    this.hub.replaceChildren();
    const line = document.createElement("div");
    const sub = document.createElement("div");
    sub.className = `${this.prefix}-hub-sub`;
    if (item) {
      line.textContent = `${item.label}  [${item.key.toUpperCase()}]`;
      sub.textContent = item.disabled ?? request.title;
    } else {
      line.textContent = request.title;
      sub.textContent =
        request.subtitle ??
        (request.mode === "hold"
          ? "flick to an action, let go"
          : "pick an action, Esc to close");
    }
    this.hub.append(line, sub);
    this.hub.style.transform = `translate(${-Math.round(this.hub.offsetWidth / 2)}px, ${this.radius + 30}px)`;
  }
}
