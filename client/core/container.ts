import { Client } from "..";
import { DOMUtils } from "../utils";

/**
 * Parameters to initialize the Voxelize {@link Container}.
 */
type ContainerParams = {
  /**
   * The DOM element that wraps all Voxelize UI components.
   */
  domElement: HTMLElement;

  /**
   * The `HTMLCanvasElement` that Voxelize draws on.
   */
  canvas: HTMLCanvasElement;

  /**
   * The styles applied to the crosshair.
   */
  crosshairStyles?: CSSStyleDeclaration;
};

const defaultParams: ContainerParams = {
  domElement: document.body,
  canvas: document.createElement("canvas"),
};

/**
 * The **built-in** class managing the container of the game. Does the following:
 * - Create/use passed in `HTMLDivElement` to contain the game and its UI components.
 * - Create/use passed in `HTMLCanvasElement` to draw the game on.
 *
 * # Example
 * Bind the key <kbd>k</kbd> to toggle full screen:
 * ```ts
 * client.inputs.bind("k", client.container.toggleFullScreen, "in-game");
 * ```
 */
class Container {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Parameters to initialize the Voxelize container.
   */
  public params: ContainerParams;

  /**
   * The `div` containing the game, parent to `container.canvas`
   *
   * @type {HTMLElement}
   * @memberof Container
   */
  public domElement: HTMLElement;

  /**
   * The `canvas` that the game draws on, child of `container.domElement`
   */
  public canvas: HTMLCanvasElement;

  /**
   * A div that draws the crosshair of the container.
   */
  public crosshair: HTMLDivElement;

  /**
   * Construct a new Voxelize container.
   *
   * @hidden
   */
  constructor(client: Client, params: Partial<ContainerParams> = {}) {
    this.client = client;

    const { domElement, canvas, crosshairStyles } = (this.params = {
      ...defaultParams,
      ...params,
    });

    this.crosshair = document.createElement("div");

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

    DOMUtils.applyStyles(this.crosshair, {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: "10px",
      height: "10px",
      border: "2px solid #eee9",
    });

    if (crosshairStyles) {
      DOMUtils.applyStyles(this.crosshair, crosshairStyles);
    }

    const styles = document.createElement("style");
    styles.innerHTML = `
      @import url("https://fonts.googleapis.com/css2?family=Syne+Mono&display=swap");
    `;
    document.head.appendChild(styles);

    this.canvas = canvas;

    this.domElement = domElement;
    this.domElement.appendChild(this.canvas);
    this.domElement.appendChild(this.crosshair);

    DOMUtils.applyStyles(this.domElement, {
      position: "relative",
      fontFamily: `"Fira Mono", monospace`,
    });
  }

  /**
   * Toggle fullscreen for Voxelize.
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
   * Show the crosshair.
   */
  showCrosshair = () => {
    this.crosshair.style.display = "block";
  };

  /**
   * Hide the crosshair.
   */
  hideCrosshair = () => {
    this.crosshair.style.display = "none";
  };
}

export type { ContainerParams };

export { Container };
