// Work (J): today's quests with progress, and the job the player has taken
// up. Progress and pay are decided by the game server.

import type { Content } from "./content";

export type QuestView = { key: string; name: string; description: string; crowns: number; xp: number; count: number; progress: number; done: boolean };
export type WorkState = { day: number; quests: QuestView[]; job: string | null; pending: number };
export type JobDef = { key: string; name: string; description: string; icon: string; pays: { trigger: { kind: string; target?: string | null }; cents: number }[] };

/** "64 / 64" style progress, capped at the goal. */
export function progressLine(q: QuestView): string {
  return `${Math.min(q.progress, q.count)} / ${q.count}`;
}

/** What a job pays, for the panel: "stone 0.04, iron_ore 1.00". */
export function payLine(job: JobDef, name: (key: string) => string = (k) => k): string {
  return job.pays
    .map((p) => `${p.trigger.kind} ${p.trigger.target ? name(p.trigger.target) : "anything"}: ${(p.cents / 100).toFixed(2)}`)
    .join(", ");
}

/** A payout notice. */
export function rewardLine(r: { source: string; reason: string; paid: number; requested: number }): string {
  const what = r.source === "job" ? `work as ${r.reason}` : `quest ${r.reason}`;
  if (r.paid === 0) return `No Crowns for ${what}: today's limit is reached`;
  return `Paid ${r.paid} Crowns for ${what}${r.paid < r.requested ? " (daily limit reached)" : ""}`;
}

export class WorkPanel {
  readonly root: HTMLElement;
  private state: WorkState | null = null;

  constructor(
    private readonly content: Content,
    private readonly actions: { setJob: (job: string | null) => void },
  ) {
    this.root = document.createElement("section");
    this.root.id = "work";
    this.root.className = "panel";
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  set(state: WorkState) {
    this.state = state;
    if (this.isOpen) this.render();
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (this.isOpen) this.render();
  }

  private render() {
    const nodes: Node[] = [];
    const h = (tag: string, text: string) => Object.assign(document.createElement(tag), { textContent: text });
    nodes.push(h("h2", "Quests and jobs"));
    const s = this.state;
    nodes.push(h("h3", "Today's quests"));
    const quests = document.createElement("ul");
    quests.className = "achievement-list";
    for (const q of s?.quests ?? []) {
      const li = document.createElement("li");
      li.className = q.done ? "done" : "";
      li.append(h("strong", `${q.done ? "✓ " : ""}${q.name}`), ` — ${q.description} · ${progressLine(q)} · ${q.crowns} Crowns, ${q.xp} xp`);
      quests.append(li);
    }
    nodes.push(quests);
    const jobs = (this.content.pack as { jobs?: JobDef[] }).jobs ?? [];
    nodes.push(h("h3", `Job: ${jobs.find((j) => j.key === s?.job)?.name ?? "none"}${s?.pending ? ` · ${s.pending} Crowns on the way` : ""}`));
    const name = (k: string) => this.content.itemsByKey.get(k)?.name ?? this.content.pack.blocks.find((b) => b.key === k)?.name ?? k;
    for (const job of jobs) {
      const row = document.createElement("div");
      row.className = "work-job";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = job.key === s?.job ? "Quit" : "Take up";
      button.addEventListener("click", () => this.actions.setJob(job.key === s?.job ? null : job.key));
      row.append(h("strong", job.name), ` — ${job.description} `, h("div", payLine(job, name)), button);
      nodes.push(row);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Done";
    close.addEventListener("click", () => (this.root.hidden = true));
    nodes.push(close);
    this.root.replaceChildren(...nodes);
  }
}
