export type StyleDecl = Partial<CSSStyleDeclaration>;

export const applyStyles = (
  element: HTMLElement | undefined | null,
  styles: StyleDecl,
): void => {
  if (!element) return;
  for (const key of Object.keys(styles) as (keyof CSSStyleDeclaration)[]) {
    const value = styles[key];
    if (value === undefined) continue;
    const style = element.style as unknown as Record<string, unknown>;
    style[key as string] = value;
  }
};

export const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    id?: string;
    text?: string;
    title?: string;
    attrs?: Record<string, string>;
    styles?: StyleDecl;
    parent?: HTMLElement;
  } = {},
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.id) el.id = options.id;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.title) el.title = options.title;
  if (options.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) {
      el.setAttribute(k, v);
    }
  }
  if (options.styles) applyStyles(el, options.styles);
  if (options.parent) options.parent.appendChild(el);
  return el;
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const round = (value: number, step: number): number => {
  if (!step) return value;
  const inv = 1 / step;
  return Math.round(value * inv) / inv;
};

export const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
};
