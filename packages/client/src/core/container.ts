import { Client } from "..";
import { Helper } from "../utils";

type ContainerParams = {
  domElement: HTMLElement;
  canvas: HTMLCanvasElement;
};

const defaultParams: ContainerParams = {
  domElement: document.body,
  canvas: document.createElement("canvas"),
};

class Container {
  public params: ContainerParams;

  public focused = false;

  public domElement: HTMLElement;
  public canvas: HTMLCanvasElement;

  private unbinds: (() => void)[] = [];

  constructor(public client: Client, params: Partial<ContainerParams> = {}) {
    const { domElement, canvas } = (this.params = {
      ...defaultParams,
      ...params,
    });

    const afloat = document.createElement("div");
    Helper.applyStyles(afloat, {
      position: "absolute",
      top: "0",
      left: "0",
      maxWidth: "100vw",
      zIndex: "100",
    });

    if (domElement) {
      Array.from(domElement.children).forEach((ele) => {
        domElement.removeChild(ele);
        afloat.appendChild(ele);
      });
      domElement.appendChild(afloat);
    }

    Helper.applyStyles(canvas, {
      position: "absolute",
      margin: "0",
      outline: "none",
      padding: "0",
      top: "0px",
      left: "0px",
      bottom: "0px",
      right: "0px",
    });

    const styles = document.createElement("style");
    styles.innerHTML = `
      @import url("https://fonts.googleapis.com/css2?family=Fira+Mono&display=swap");
    `;
    document.head.appendChild(styles);

    this.canvas = canvas;

    this.domElement = domElement;
    this.domElement.appendChild(this.canvas);
    this.domElement.id = "voxelize-container";

    Helper.applyStyles(this.domElement, {
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

  fitCanvas = () => {
    Helper.applyStyles(this.canvas, {
      width: `${this.domElement.offsetWidth}px`,
      height: `${this.domElement.offsetHeight}px`,
    });
  };

  dispose = () => {
    this.unbinds.forEach((fn) => fn());
  };
}

export type { ContainerParams };

export { Container };
