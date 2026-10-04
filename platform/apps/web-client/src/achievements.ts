// Achievements (Y): the tree from the content pack, with what this player
// has earned. The server decides; this only shows it.

import type { Content } from "./content";

export type AchievementDef = {
  key: string;
  name: string;
  description: string;
  parent?: string | null;
  icon: string;
  xp: number;
  trigger: { kind: string; target?: string | null; count: number };
};

/** Achievements in tree order (each after its parent) with their depth. */
export function achievementTree(defs: AchievementDef[]): { def: AchievementDef; depth: number }[] {
  const children = new Map<string | null, AchievementDef[]>();
  for (const d of defs) {
    const parent = d.parent && defs.some((p) => p.key === d.parent) ? d.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), d]);
  }
  const out: { def: AchievementDef; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const d of children.get(parent) ?? []) {
      out.push({ def: d, depth });
      walk(d.key, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export class AchievementsPanel {
  readonly root: HTMLElement;
  private done = new Set<string>();

  constructor(private readonly content: Content) {
    this.root = document.createElement("section");
    this.root.id = "achievements";
    this.root.className = "panel";
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  setDone(done: string[]) {
    this.done = new Set(done);
    if (this.isOpen) this.render();
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (this.isOpen) this.render();
  }

  private render() {
    const defs = (this.content.pack as { achievements?: AchievementDef[] }).achievements ?? [];
    const title = document.createElement("h2");
    title.textContent = `Achievements · ${this.done.size} of ${defs.length}`;
    const list = document.createElement("ul");
    list.className = "achievement-list";
    for (const { def, depth } of achievementTree(defs)) {
      const li = document.createElement("li");
      li.className = this.done.has(def.key) ? "done" : "";
      li.style.paddingLeft = `${depth * 16}px`;
      const name = document.createElement("strong");
      name.textContent = `${this.done.has(def.key) ? "✓ " : ""}${def.name}`;
      li.append(name, ` — ${def.description}${def.xp ? ` (+${def.xp} xp)` : ""}`);
      list.append(li);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Done";
    close.addEventListener("click", () => (this.root.hidden = true));
    this.root.replaceChildren(title, list, close);
  }
}
