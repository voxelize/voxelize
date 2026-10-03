// Player settings (accessibility and graphics). Stored per browser in
// localStorage, which may be unavailable (private mode), so every access
// is guarded and defaults always work.

export type Settings = {
  sensitivity: number;
  fov: number;
  renderDistance: number;
  uiScale: number;
  volume: number;
  invertY: boolean;
};

export const DEFAULTS: Settings = {
  sensitivity: 100,
  fov: 75,
  renderDistance: 6,
  uiScale: 1,
  volume: 0.6,
  invertY: false,
};

const KEY = "platform.settings";

export const RANGES: Record<Exclude<keyof Settings, "invertY">, [number, number, number, string]> = {
  sensitivity: [20, 300, 5, "Mouse sensitivity"],
  fov: [50, 110, 1, "Field of view"],
  renderDistance: [2, 12, 1, "Render distance (chunks)"],
  uiScale: [0.6, 1.6, 0.05, "Interface size"],
  volume: [0, 1, 0.05, "Volume"],
};

/** Clamp and fill a possibly stale or tampered stored object. */
export function sanitize(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const [key, [min, max]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number, number, string]][]) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.min(max, Math.max(min, v));
  }
  if (typeof r.invertY === "boolean") out.invertY = r.invertY;
  return out;
}

export function loadSettings(): Settings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { ...DEFAULTS };
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
  const state = { ...initial };
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
      saveSettings(state);
      apply({ ...state });
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
    saveSettings(state);
    apply({ ...state });
  });
  invert.append(Object.assign(document.createElement("span"), { textContent: "Invert vertical look" }), box);
  panel.append(invert);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Done";
  close.addEventListener("click", () => (panel.hidden = true));
  panel.append(close);
  document.body.append(panel);
  return panel;
}
