// Virtue (Paradise): the player's own standing, shown as a small glowing
// chip at the top of the screen, and everyone's title on their name tag.
// The server decides everything (docs/NETWORK_PROTOCOL.md, platform.virtue);
// this only shows it.

export type VirtueState = {
  points: number;
  level: number;
  title: string;
  toNext: number | null;
  builtToday: number;
  helpedToday: number;
  buildCap: number;
  helpCap: number;
  divine: boolean;
};

export type VirtueTag = { id: string; level: number; title: string; glow: boolean };

/** A name tag: in Paradise it carries the title, and Saints and above glow. */
export function peerLabel(username: string, tag: VirtueTag | undefined, paradise: boolean): string {
  if (!paradise || !tag || tag.level < 1) return username;
  return tag.glow ? `✦ ${username} · ${tag.title} ✦` : `${username} · ${tag.title}`;
}

/** The chip's text: "✦ Gardener · 345 · 255 to Builder of Light". */
export function virtueLine(v: VirtueState, nextTitle: string | null): string {
  const head = `✦ ${v.title} · ${v.points}`;
  if (v.toNext === null) return `${head} · Divine`;
  return `${head} · ${v.toNext} to ${nextTitle ?? "next"}`;
}

/** What today still allows: "today: built 120/300, helped 30/300". */
export function todayLine(v: VirtueState): string {
  return `today: built ${v.builtToday}/${v.buildCap}, helped ${v.helpedToday}/${v.helpCap}`;
}

/** Progress through the current level, 0..1. */
export function levelProgress(v: VirtueState, levels: number[]): number {
  if (v.level < 0) return 0;
  if (v.toNext === null) return 1;
  const from = levels[v.level] ?? 0;
  const to = v.points + v.toNext;
  return to > from ? Math.min(1, Math.max(0, (v.points - from) / (to - from))) : 1;
}

/** The thresholds and titles, as the server has them. */
export const LEVELS: [number, string][] = [
  [0, "Pilgrim"],
  [50, "Seeker"],
  [200, "Gardener"],
  [600, "Builder of Light"],
  [1500, "Guardian"],
  [3500, "Saint"],
  [6500, "Seraph"],
  [10000, "Divine"],
];

export class VirtueHud {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly text: HTMLElement;
  private readonly today: HTMLElement;
  state: VirtueState | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "virtue";
    this.root.hidden = true;
    this.text = document.createElement("div");
    this.text.className = "virtue-text";
    const track = document.createElement("div");
    track.className = "virtue-track";
    this.bar = document.createElement("div");
    this.bar.className = "virtue-bar";
    track.append(this.bar);
    this.today = document.createElement("div");
    this.today.className = "virtue-today";
    this.root.append(this.text, track, this.today);
    document.body.append(this.root);
  }

  /** Show the new state; returns whether the level went up. */
  update(v: VirtueState): boolean {
    const rose = this.state !== null && v.level > this.state.level;
    this.state = v;
    const next = LEVELS[v.level + 1]?.[1] ?? null;
    this.text.textContent = virtueLine(v, v.level < 0 ? "Pilgrim" : next);
    this.today.textContent = todayLine(v);
    this.bar.style.width = `${Math.round(levelProgress(v, LEVELS.map(([p]) => p)) * 100)}%`;
    this.root.classList.toggle("fallen", v.level < 0);
    this.root.classList.toggle("divine", v.divine);
    this.root.hidden = false;
    return rose;
  }
}
