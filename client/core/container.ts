import { Client } from "..";
import { DOMUtils } from "../utils";

type ContainerParams = {
  domElement: HTMLElement;
  canvas: HTMLCanvasElement;
};

const defaultParams: ContainerParams = {
  domElement: document.body,
  canvas: document.createElement("canvas"),
};

/**
 * The class managing the container of the game. Does the following:
 * - Create/use passed in `HTMLDivElement` to contain the game
 * - Create/use passed in `HTMLCanvasElement` to draw the game on
 *
 * @class Container
 */
class Container {
  /**
   * An object storing the parameters passed on `Container` construction
   *
   * @type {ContainerParams}
   * @memberof Container
   */
  public params: ContainerParams;

  /**
   * A flag to indicate whether the game is locked, in other words, if
   * the pointer-lock controls are locked
   *
   * @memberof Container
   */
  public focused = false;

  /**
   * The `div` containing the game, parent to `container.canvas`
   *
   * @type {HTMLElement}
   * @memberof Container
   */
  public domElement: HTMLElement;

  /**
   * The `canvas` that the game draws on, child of `container.domElement`
   *
   * @type {HTMLCanvasElement}
   * @memberof Container
   */
  public canvas: HTMLCanvasElement;

  private unbinds: (() => void)[] = [];

  constructor(public client: Client, params: Partial<ContainerParams> = {}) {
    const { domElement, canvas } = (this.params = {
      ...defaultParams,
      ...params,
    });

    if (domElement) {
      Array.from(domElement.children).forEach((ele) => {
        DOMUtils.applyStyles(ele as HTMLElement, {
          zIndex: "100",
        });
      });
    }

    DOMUtils.applyStyles(canvas, {
      position: "absolute",
      margin: "0",
      outline: "none",
      padding: "0",
      width: "100%",
      height: "100%",
    });

    const styles = document.createElement("style");
    styles.innerHTML = `
      @import url("https://fonts.googleapis.com/css2?family=Syne+Mono&display=swap");
    `;
    document.head.appendChild(styles);

    this.canvas = canvas;

    this.domElement = domElement;
    this.domElement.appendChild(this.canvas);
    this.domElement.id = "voxelize-container";

    DOMUtils.applyStyles(this.domElement, {
      position: "relative",
      fontFamily: `"Fira Mono", monospace`,
    });

    // add listeners
    const onBlur = () => {
      this.client.emit("blur");
      this.focused = false;
    };

    const onFocus = () => {
      this.client.emit("focus");
      this.focused = true;
    };

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    this.unbinds.push(
      () => window.removeEventListener("blur", onBlur),
      () => window.removeEventListener("focus", onFocus)
    );

    this.fitCanvas();
  }

  /**
   * Toggle fullscreen for game
   *
   * @memberof Container
   */
  toggleFullScreen = () => {
    const elem = document.body as any;
    const doc = document as any;

    if (
      (doc.fullScreenElement !== undefined && doc.fullScreenElement === null) ||
      (doc.msFullscreenElement !== undefined &&
        doc.msFullscreenElement === null) ||
      (doc.mozFullScreen !== undefined && !doc.mozFullScreen) ||
      (doc.webkitIsFullScreen !== undefined && !doc.webkitIsFullScreen)
    ) {
      if (elem.requestFullScreen) {
        elem.requestFullScreen();
      } else if (elem.mozRequestFullScreen) {
        elem.mozRequestFullScreen();
      } else if (elem.webkitRequestFullScreen) {
        // @ts-ignore
        elem.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }
    } else {
      if (doc.cancelFullScreen) {
        doc.cancelFullScreen();
      } else if (doc.mozCancelFullScreen) {
        doc.mozCancelFullScreen();
      } else if (doc.webkitCancelFullScreen) {
        doc.webkitCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen();
      }
    }
  };

  /**
   * Fit `container.canvas` inside `container.domElement`
   *
   * @memberof Container
   */
  fitCanvas = () => {
    this.canvas.width = this.domElement.offsetWidth;
    this.canvas.height = this.domElement.offsetHeight;
    DOMUtils.applyStyles(this.canvas, {
      width: `${this.domElement.offsetWidth}px`,
      height: `${this.domElement.offsetHeight}px`,
    });
  };

  /**
   * Disposal of container, unbinds all existing event listeners
   * on `domElement` and `canvas`
   *
   * @memberof Container
   */
  dispose = () => {
    this.unbinds.forEach((fn) => fn());
  };
}

export type { ContainerParams };

export { Container };
