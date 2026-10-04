// Player settings (accessibility and graphics). Stored per browser in
// localStorage, which may be unavailable (private mode), so every access
// is guarded and defaults always work.

import { COLOUR_VISIONS, ColourVision } from "./colour-vision";
import { ACTIONS, conflicts, DEFAULT_KEYS, keyLabel, KeyMap, RESERVED, sanitizeKeys } from "./keybindings";

export type Settings = {
  sensitivity: number;
  fov: number;
  renderDistance: number;
  uiScale: number;
  volume: number;
  invertY: boolean;
  colourVision: ColourVision;
  keys: KeyMap;
};

export const DEFAULTS: Settings = {
  sensitivity: 100,
  fov: 75,
  renderDistance: 6,
  uiScale: 1,
  volume: 0.6,
  invertY: false,
  colourVision: "normal",
  keys: { ...DEFAULT_KEYS },
};

const KEY = "platform.settings";

export const RANGES: Record<Exclude<keyof Settings, "invertY" | "colourVision" | "keys">, [number, number, number, string]> = {
  sensitivity: [20, 300, 5, "Mouse sensitivity"],
  fov: [50, 110, 1, "Field of view"],
  renderDistance: [2, 12, 1, "Render distance (chunks)"],
  uiScale: [0.6, 1.6, 0.05, "Interface size"],
  volume: [0, 1, 0.05, "Volume"],
};

/** Clamp and fill a possibly stale or tampered stored object. */
export function sanitize(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS, keys: { ...DEFAULT_KEYS } };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const [key, [min, max]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number, number, string]][]) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.min(max, Math.max(min, v));
  }
  if (typeof r.invertY === "boolean") out.invertY = r.invertY;
  if (COLOUR_VISIONS.some((c) => c.kind === r.colourVision)) out.colourVision = r.colourVision as ColourVision;
  out.keys = sanitizeKeys(r.keys);
  return out;
}

export function loadSettings(): Settings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { ...DEFAULTS, keys: { ...DEFAULT_KEYS } };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not persisted (private mode); the settings still apply this session.
  }
}

/** Build the settings panel; `apply` runs on every change. */
export function settingsPanel(initial: Settings, apply: (s: Settings) => void): HTMLElement {
  const panel = document.createElement("section");
  panel.id = "settings";
  panel.className = "panel";
  panel.hidden = true;
  const title = document.createElement("h2");
  title.textContent = "Settings";
  panel.append(title);
  const state = { ...initial, keys: { ...initial.keys } };
  const changed = () => {
    saveSettings(state);
    apply({ ...state, keys: { ...state.keys } });
  };
  for (const [key, [min, max, step, label]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number, number, string]][]) {
    const row = document.createElement("label");
    row.className = "setting";
    const text = document.createElement("span");
    const value = document.createElement("output");
    const input = document.createElement("input");
    input.type = "range";
    Object.assign(input, { min: String(min), max: String(max), step: String(step), value: String(state[key]) });
    text.textContent = label;
    value.textContent = String(state[key]);
    input.addEventListener("input", () => {
      state[key] = Number(input.value);
      value.textContent = input.value;
      changed();
    });
    row.append(text, input, value);
    panel.append(row);
  }
  const invert = document.createElement("label");
  invert.className = "setting";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = state.invertY;
  box.addEventListener("change", () => {
    state.invertY = box.checked;
    changed();
  });
  invert.append(Object.assign(document.createElement("span"), { textContent: "Invert vertical look" }), box);
  panel.append(invert);

  // Colour vision.
  const vision = document.createElement("label");
  vision.className = "setting";
  const select = document.createElement("select");
  for (const { kind, label } of COLOUR_VISIONS) select.append(new Option(label, kind, false, kind === state.colourVision));
  select.addEventListener("change", () => {
    state.colourVision = select.value as ColourVision;
    changed();
  });
  vision.append(Object.assign(document.createElement("span"), { textContent: "Colour vision aid" }), select);
  panel.append(vision);

  // Controls: click a key, then press the new one (Escape cancels).
  const heading = document.createElement("h3");
  heading.textContent = "Controls";
  const warning = document.createElement("p");
  warning.className = "muted key-warning";
  panel.append(heading);
  const buttons = new Map<string, HTMLButtonElement>();
  const refresh = () => {
    for (const { action } of ACTIONS) buttons.get(action)!.textContent = keyLabel(state.keys[action]);
    const clash = conflicts(state.keys);
    warning.textContent = clash.length
      ? `Same key for: ${clash.map((g) => g.map((a) => ACTIONS.find((x) => x.action === a)!.label).join(" & ")).join("; ")}`
      : "";
  };
  for (const { action, label } of ACTIONS) {
    const row = document.createElement("label");
    row.className = "setting";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key-button";
    button.addEventListener("click", () => {
      button.textContent = "Press a key…";
      const capture = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        removeEventListener("keydown", capture, true);
        if (event.code !== "Escape" && !RESERVED.includes(event.code)) {
          state.keys[action] = event.code;
          changed();
        }
        refresh();
      };
      addEventListener("keydown", capture, true);
    });
    buttons.set(action, button);
    row.append(Object.assign(document.createElement("span"), { textContent: label }), button);
    panel.append(row);
  }
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset keys";
  reset.addEventListener("click", () => {
    state.keys = { ...DEFAULT_KEYS };
    changed();
    refresh();
  });
  panel.append(warning, reset);
  refresh();
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Done";
  close.addEventListener("click", () => (panel.hidden = true));
  panel.append(close);
  document.body.append(panel);
  return panel;
}
