/**
 * Pointer lock for automated browsers (puppeteer, CDP, WebDriver), without
 * the system's.
 *
 * A real pointer lock taken by headless Chrome on macOS grabs and moves the
 * system cursor of whoever is sitting at the machine, every time a script
 * clicks the canvas. Under automation (`navigator.webdriver`) the document's
 * lock is replaced by a stand-in: `requestPointerLock`, `exitPointerLock`,
 * `pointerLockElement` and `pointerlockchange` behave as a granted lock does,
 * and the real cursor is never touched. Mouse events a script dispatches
 * still carry `movementX`/`movementY`, so looking around works the same.
 *
 * A script that truly needs the real lock sets
 * `window.__voxelizeRealPointerLock = true` before the page loads
 * (`page.evaluateOnNewDocument`).
 */

const INSTALLED = Symbol.for("voxelize.automationPointerLock");

type Flagged = { [INSTALLED]?: boolean; __voxelizeRealPointerLock?: boolean };

export function installAutomationPointerLock(doc: Document) {
  const win = doc.defaultView as (Window & Flagged) | null;
  if (!win || !win.navigator.webdriver) return;
  if (win.__voxelizeRealPointerLock === true) return;
  if (win[INSTALLED]) return;
  win[INSTALLED] = true;

  let locked: Element | null = null;
  const announce = () =>
    queueMicrotask(() => doc.dispatchEvent(new Event("pointerlockchange")));

  Object.defineProperty(Document.prototype, "pointerLockElement", {
    configurable: true,
    get: () => locked,
  });
  const take = (element: Element) => {
    if (locked === element) return;
    locked = element;
    announce();
  };
  function requestStandIn(this: Element) {
    take(this);
    return Promise.resolve();
  }
  Element.prototype.requestPointerLock =
    requestStandIn as Element["requestPointerLock"];
  Document.prototype.exitPointerLock = function () {
    if (!locked) return;
    locked = null;
    announce();
  };
}
