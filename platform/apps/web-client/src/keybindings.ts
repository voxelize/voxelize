// Rebindable keys. The engine's movement keys are fixed to W/A/S/D, Space,
// left Shift and R, so the game unbinds them and drives the controls'
// movement flags from its own key map; every other game key reads the same
// map. Codes are KeyboardEvent.code values (layout independent).

export type Action =
  | "forward"
  | "left"
  | "back"
  | "right"
  | "jump"
  | "sneak"
  | "sprint"
  | "inventory"
  | "drop"
  | "fly"
  | "camera";

export type KeyMap = Record<Action, string>;

export const ACTIONS: { action: Action; label: string; key: string }[] = [
  { action: "forward", label: "Walk forward", key: "KeyW" },
  { action: "left", label: "Strafe left", key: "KeyA" },
  { action: "back", label: "Walk back", key: "KeyS" },
  { action: "right", label: "Strafe right", key: "KeyD" },
  { action: "jump", label: "Jump / fly up", key: "Space" },
  { action: "sneak", label: "Sneak / fly down", key: "ShiftLeft" },
  { action: "sprint", label: "Sprint", key: "KeyR" },
  { action: "inventory", label: "Inventory", key: "KeyE" },
  { action: "drop", label: "Drop item", key: "KeyQ" },
  { action: "fly", label: "Toggle flight (creative)", key: "KeyF" },
  { action: "camera", label: "Change camera", key: "KeyC" },
];

export const DEFAULT_KEYS: KeyMap = Object.fromEntries(ACTIONS.map((a) => [a.action, a.key])) as KeyMap;

/** The engine's own movement bindings, and the movement flag each sets. */
export const ENGINE_MOVES: Partial<Record<Action, { code: string; movement: string }>> = {
  forward: { code: "KeyW", movement: "front" },
  left: { code: "KeyA", movement: "left" },
  back: { code: "KeyS", movement: "back" },
  right: { code: "KeyD", movement: "right" },
  jump: { code: "Space", movement: "up" },
  sneak: { code: "ShiftLeft", movement: "down" },
  sprint: { code: "KeyR", movement: "sprint" },
};

const CODE = /^[A-Za-z][A-Za-z0-9]{0,19}$/;
/** Keys the game keeps for itself (menus, hotbar). */
export const RESERVED = ["Escape", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"];

/** A stored key map with anything unknown or invalid set back to default. */
export function sanitizeKeys(raw: unknown): KeyMap {
  const out: KeyMap = { ...DEFAULT_KEYS };
  if (!raw || typeof raw !== "object") return out;
  for (const { action } of ACTIONS) {
    const code = (raw as Record<string, unknown>)[action];
    if (typeof code === "string" && CODE.test(code) && !RESERVED.includes(code)) out[action] = code;
  }
  return out;
}

/** Groups of actions that share a key (each group has two or more). */
export function conflicts(keys: KeyMap): Action[][] {
  const byCode = new Map<string, Action[]>();
  for (const { action } of ACTIONS) byCode.set(keys[action], [...(byCode.get(keys[action]) ?? []), action]);
  return [...byCode.values()].filter((group) => group.length > 1);
}

/** The action a key code triggers, if any. */
export function actionFor(keys: KeyMap, code: string): Action | undefined {
  return ACTIONS.find(({ action }) => keys[action] === code)?.action;
}

/** A readable name for a key code. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  const arrows: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  if (arrows[code]) return arrows[code];
  const sided = code.match(/^(Shift|Control|Alt|Meta)(Left|Right)$/);
  if (sided) return `${sided[2]} ${sided[1] === "Control" ? "Ctrl" : sided[1]}`;
  return code;
}
