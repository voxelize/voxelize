// In-game chat: Enter opens a line ("/" opens it with a command), the log
// sits bottom-left and fades. Public lines come through the engine's chat;
// whispers, local and guild lines through `platform.chat` events.

export type ChatLine = { channel: string; from?: string | null; to?: string | null; body: string };

/** How a line reads in the log. */
export function chatText(line: ChatLine): string {
  switch (line.channel) {
    case "whisper":
      return `${line.from} → ${line.to}: ${line.body}`;
    case "local":
      return `[local] ${line.from}: ${line.body}`;
    case "guild":
      return `[${line.to ?? "guild"}] ${line.from}: ${line.body}`;
    case "system":
      return line.body;
    default:
      return `${line.from ?? "?"}: ${line.body}`;
  }
}

/** Seconds a line stays visible while the chat is closed. */
export const FADE_SECONDS = 10;
const KEEP = 100;

export class ChatBox {
  readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private lines: { el: HTMLElement; at: number }[] = [];

  constructor(private readonly send: (body: string) => void, private readonly onOpenChange: (open: boolean) => void) {
    this.root = document.createElement("div");
    this.root.id = "chat";
    this.log = document.createElement("div");
    this.log.className = "chat-log";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.maxLength = 256;
    this.input.className = "chat-input";
    this.input.hidden = true;
    this.input.placeholder = "Say something (/help for channels)";
    this.input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        const body = this.input.value.trim();
        if (body) this.send(body);
        this.close();
      } else if (event.key === "Escape") {
        this.close();
      }
    });
    this.root.append(this.log, this.input);
    document.body.append(this.root);
    setInterval(() => this.fade(), 1000);
  }

  get isOpen() {
    return !this.input.hidden;
  }

  open(prefix = "") {
    this.input.hidden = false;
    this.input.value = prefix;
    this.root.classList.add("open");
    this.input.focus();
    this.onOpenChange(true);
  }

  close() {
    this.input.hidden = true;
    this.input.blur();
    this.root.classList.remove("open");
    this.onOpenChange(false);
  }

  add(line: ChatLine) {
    const el = document.createElement("div");
    el.className = `chat-line chat-${line.channel}`;
    el.textContent = chatText(line);
    this.log.append(el);
    this.lines.push({ el, at: Date.now() });
    while (this.lines.length > KEEP) this.lines.shift()!.el.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  private fade() {
    const now = Date.now();
    for (const l of this.lines) l.el.classList.toggle("faded", now - l.at > FADE_SECONDS * 1000);
  }
}
