// Touch controls for phones and tablets: a movement joystick on the left,
// drag anywhere on the right to look, and buttons for jump, crouch, sprint,
// mine/attack (hold), place/use, inventory and drop.

export type TouchActions = {
  move: (x: number, y: number) => void;
  look: (dx: number, dy: number) => void;
  jump: (down: boolean) => void;
  crouch: (down: boolean) => void;
  sprint: (on: boolean) => void;
  primary: (down: boolean) => void;
  secondary: () => void;
  inventory: () => void;
  drop: () => void;
};

export const isTouchDevice = () =>
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

export function mountTouchControls(actions: TouchActions): HTMLElement {
  const root = document.createElement("div");
  root.id = "touch";
  root.innerHTML = `
    <div class="joystick"><div class="knob"></div></div>
    <div class="look-area"></div>
    <div class="buttons">
      <button data-b="primary" aria-label="Mine or attack">⛏</button>
      <button data-b="secondary" aria-label="Place or use">▣</button>
      <button data-b="jump" aria-label="Jump">⤒</button>
      <button data-b="crouch" aria-label="Crouch">⤓</button>
      <button data-b="sprint" aria-label="Sprint">»</button>
      <button data-b="inventory" aria-label="Inventory">☰</button>
      <button data-b="drop" aria-label="Drop">⇣</button>
    </div>`;
  document.body.append(root);

  const stick = root.querySelector(".joystick") as HTMLElement;
  const knob = root.querySelector(".knob") as HTMLElement;
  let stickId: number | null = null;
  const moveStick = (t: Touch) => {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (t.clientX - (r.left + radius)) / radius;
    let y = (t.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    knob.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`;
    actions.move(x, -y);
  };
  stick.addEventListener("touchstart", (e) => {
    stickId = e.changedTouches[0].identifier;
    moveStick(e.changedTouches[0]);
    e.preventDefault();
  });
  stick.addEventListener("touchmove", (e) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === stickId) moveStick(t);
    e.preventDefault();
  });
  const endStick = () => {
    stickId = null;
    knob.style.transform = "";
    actions.move(0, 0);
  };
  stick.addEventListener("touchend", endStick);
  stick.addEventListener("touchcancel", endStick);

  const look = root.querySelector(".look-area") as HTMLElement;
  const last = new Map<number, [number, number]>();
  look.addEventListener("touchstart", (e) => {
    for (const t of Array.from(e.changedTouches)) last.set(t.identifier, [t.clientX, t.clientY]);
    e.preventDefault();
  });
  look.addEventListener("touchmove", (e) => {
    for (const t of Array.from(e.changedTouches)) {
      const prev = last.get(t.identifier);
      if (prev) actions.look(t.clientX - prev[0], t.clientY - prev[1]);
      last.set(t.identifier, [t.clientX, t.clientY]);
    }
    e.preventDefault();
  });
  look.addEventListener("touchend", (e) => {
    for (const t of Array.from(e.changedTouches)) last.delete(t.identifier);
  });

  let sprinting = false;
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>(".buttons button"))) {
    const b = button.dataset.b!;
    const press = (down: boolean) => {
      button.classList.toggle("down", down);
      if (b === "primary") actions.primary(down);
      if (b === "jump") actions.jump(down);
      if (b === "crouch") actions.crouch(down);
      if (!down) return;
      if (b === "secondary") actions.secondary();
      if (b === "inventory") actions.inventory();
      if (b === "drop") actions.drop();
      if (b === "sprint") {
        sprinting = !sprinting;
        button.classList.toggle("on", sprinting);
        actions.sprint(sprinting);
      }
    };
    button.addEventListener("touchstart", (e) => {
      press(true);
      e.preventDefault();
    });
    button.addEventListener("touchend", (e) => {
      press(false);
      e.preventDefault();
    });
  }
  return root;
}
