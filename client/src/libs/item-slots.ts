import merge from "deepmerge";
import {
  Mesh,
  Object3D,
  OrthographicCamera,
  Scene,
  sRGBEncoding,
  Vector3,
  WebGLRenderer,
} from "three";

import { CameraPerspective, noop } from "../common";
import { Inputs } from "../core/inputs";
import { World } from "../core/world/index";
import { DOMUtils } from "../utils";

export type ItemSlotsParams = {
  wrapperClass: string;
  wrapperStyles: Partial<CSSStyleDeclaration>;

  slotClass: string;
  slotHoverClass: string;
  slotFocusClass: string;
  slotCountClass: string;

  slotStyles: Partial<CSSStyleDeclaration>;
  slotCountStyles: Partial<CSSStyleDeclaration>;

  horizontalCount: number;
  verticalCount: number;
  focusFirstByDefault: boolean;
  activatedByDefault: boolean;

  zoom: number;
  perspective: CameraPerspective;
};

const defaultParams: ItemSlotsParams = {
  wrapperClass: "item-slots",
  wrapperStyles: {},

  slotClass: "item-slots-slot",
  slotHoverClass: "item-slots-slot-hover",
  slotFocusClass: "item-slots-slot-focus",
  slotCountClass: "item-slots-slot-count",

  slotStyles: {},
  slotCountStyles: {},

  horizontalCount: 5,
  verticalCount: 1,
  focusFirstByDefault: true,
  activatedByDefault: true,

  zoom: 3,
  perspective: "pxyz",
};

export class ItemSlot {
  public row: number;

  public col: number;

  public scene: Scene;

  public object: Object3D;

  public world: World;

  public camera: OrthographicCamera;

  public element: HTMLDivElement;

  public countElement: HTMLDivElement;

  public content: number;

  public count: number;

  public zoom: number;

  public offset: Vector3;

  constructor(row: number, col: number) {
    this.row = row;
    this.col = col;

    this.scene = new Scene();

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);

    this.element = document.createElement("div");
    this.countElement = document.createElement("div");

    this.offset = new Vector3();

    this.updateCamera();
  }

  setObject = (object: Object3D) => {
    this.scene.remove(this.scene.children[0]);

    this.object = object;
    this.scene.add(object);
  };

  setZoom = (zoom: number) => {
    this.zoom = zoom;
    this.camera.far = zoom * 3 + 1;
  };

  setContent = (content: number, count: number) => {
    this.content = content;
    this.count = count;

    this.countElement.innerText = count.toString();
  };

  setPerspective = (perspective: CameraPerspective) => {
    const negative = perspective.startsWith("n") ? -1 : 1;

    const xFactor = perspective.includes("x") ? 1 : 0;
    const yFactor = perspective.includes("y") ? 1 : 0;
    const zFactor = perspective.includes("z") ? 1 : 0;

    this.offset.set(xFactor, yFactor, zFactor).multiplyScalar(negative);

    this.updateCamera();
  };

  applyClass = (className: string) => {
    this.element.classList.add(className);
  };

  applyCountClass = (className: string) => {
    this.countElement.classList.add(className);
  };

  applyStyles = (styles: Partial<CSSStyleDeclaration>) => {
    DOMUtils.applyStyles(this.element, styles);
  };

  applyCountStyles = (styles: Partial<CSSStyleDeclaration>) => {
    DOMUtils.applyStyles(this.countElement, styles);
  };

  private updateCamera = () => {
    this.camera.position.copy(
      this.offset.clone().multiplyScalar(this.zoom || 1)
    );
    this.camera.lookAt(0, 0, 0);
  };
}

export class ItemSlots {
  public params: ItemSlotsParams;

  public world: World;

  public wrapper: HTMLDivElement;

  public canvas: HTMLCanvasElement;

  public renderer: WebGLRenderer;

  public focusedRow = -1;

  public focusedCol = -1;

  public activated = false;

  public slotMargin =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--item-slots-slot-margin"
      )
    ) || 0;

  public slotPadding =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--item-slots-slot-padding"
      )
    ) || 0;

  public slotWidth =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--item-slots-slot-width"
      )
    ) || 40;

  public slotHeight =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--item-slots-slot-height"
      )
    ) || 40;

  public slotTotalWidth =
    this.slotWidth + this.slotMargin * 2 + this.slotPadding;

  public slotTotalHeight =
    this.slotHeight + this.slotMargin * 2 + this.slotPadding;

  public onSlotClick: (slot: ItemSlot) => void = noop;
  public onFocusChange: (prevSlot: ItemSlot, nextSlot: ItemSlot) => void = noop;

  private slots: ItemSlot[][];

  private animationFrame = -1;

  constructor(world: World, params: Partial<ItemSlotsParams> = {}) {
    const { focusFirstByDefault, activatedByDefault } = (this.params = merge(
      defaultParams,
      params
    ));

    this.world = world;

    this.generate();

    if (focusFirstByDefault) {
      this.setFocused(0, 0);
    }

    if (activatedByDefault) {
      this.activate();
    }
  }

  activate = () => {
    if (this.activated) return;

    this.activated = true;

    DOMUtils.applyStyles(this.wrapper, {
      display: "flex",
    });

    this.render();
  };

  deactivate = () => {
    if (!this.activated) return;

    this.activated = false;

    DOMUtils.applyStyles(this.wrapper, {
      display: "none",
    });

    cancelAnimationFrame(this.animationFrame);
  };

  setContent = (row: number, col: number, content: number, count: number) => {
    const slot = this.slots[row][col];
    slot.setContent(content, count);
  };

  setFocused = (row: number, col: number) => {
    if (row === this.focusedRow && col === this.focusedCol) {
      return;
    }

    const hadPrevious =
      this.focusedRow !== -1 &&
      this.focusedCol !== -1 &&
      (this.focusedRow !== row || this.focusedCol !== col);

    if (hadPrevious) {
      const slot = this.slots[this.focusedRow][this.focusedCol];
      slot.element.classList.remove(this.params.slotFocusClass);
    }

    this.focusedRow = row;
    this.focusedCol = col;

    const slot = this.slots[this.focusedRow][this.focusedCol];

    if (hadPrevious) {
      this.onFocusChange(this.slots[this.focusedRow][this.focusedCol], slot);
    }

    slot.element.classList.add(this.params.slotFocusClass);
    this.onSlotClick(slot);
  };

  getFocused = () => {
    if (this.focusedRow === -1 || this.focusedCol === -1) {
      return null;
    }

    return this.slots[this.focusedRow][this.focusedCol];
  };

  getRowColFromEvent = (event: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const row = y / this.slotTotalHeight;
    const col = x / this.slotTotalWidth;

    const { slotMargin, slotPadding } = this;
    const { verticalCount, horizontalCount } = this.params;

    if (row < 0 || row >= verticalCount) return { row: -1, col: -1 };
    if (col < 0 || col >= horizontalCount) return { row: -1, col: -1 };
    if (row % 1 < (slotMargin + slotPadding) / this.slotHeight)
      return { row: -1, col: -1 };
    if (row % 1 > 1 - (slotMargin + slotPadding) / this.slotHeight)
      return { row: -1, col: -1 };
    if (col % 1 < (slotMargin + slotPadding) / this.slotWidth)
      return { row: -1, col: -1 };
    if (col % 1 > 1 - (slotMargin + slotPadding) / this.slotWidth)
      return { row: -1, col: -1 };

    return {
      row: Math.floor(row),
      col: Math.floor(col),
    };
  };

  getSlot = (row: number, col: number) => {
    if (row < 0 || row >= this.params.verticalCount) return null;
    if (col < 0 || col >= this.params.horizontalCount) return null;

    return this.slots[row][col];
  };

  connect = (inputs: Inputs, namespace = "*") => {
    const unbind = inputs.scroll(
      // Scrolling up, inventory goes left and up
      () => {
        if (!this.activated) return;
        if (this.focusedRow === -1 || this.focusedCol === -1) return;

        const { horizontalCount, verticalCount } = this.params;

        const row = this.focusedRow;
        const col = this.focusedCol;

        if (col === 0) {
          this.setFocused(
            row === 0 ? verticalCount - 1 : row - 1,
            horizontalCount - 1
          );
        } else {
          this.setFocused(row, col - 1);
        }
      },
      // Scrolling down, inventory goes right and down
      () => {
        if (!this.activated) return;
        if (this.focusedRow === -1 || this.focusedCol === -1) return;

        const { horizontalCount, verticalCount } = this.params;

        const row = this.focusedRow;
        const col = this.focusedCol;

        if (col === horizontalCount - 1) {
          this.setFocused(row === verticalCount - 1 ? 0 : row + 1, 0);
        } else {
          this.setFocused(row, col + 1);
        }
      },
      namespace
    );

    return () => {
      try {
        unbind();
      } catch (e) {
        // Ignore
      }
    };
  };

  render = () => {
    this.animationFrame = requestAnimationFrame(this.render);

    if (!this.activated) return;

    const { horizontalCount, verticalCount } = this.params;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.renderer.setSize(width, height, false);
    }

    // this.renderer.setClearColor(0xffffff);
    this.renderer.setScissorTest(false);
    this.renderer.clear();

    // this.renderer.setClearColor(0xe0e0e0);
    this.renderer.setScissorTest(true);

    const canvasRect = this.renderer.domElement.getBoundingClientRect();

    for (let i = 0; i < verticalCount; i++) {
      for (let j = 0; j < horizontalCount; j++) {
        const { scene, camera, element } = this.slots[i][j];
        const rect = element.getBoundingClientRect();

        if (
          rect.top + rect.height < canvasRect.top ||
          rect.top > canvasRect.top + canvasRect.height ||
          rect.left + rect.width < canvasRect.left ||
          rect.left > canvasRect.left + canvasRect.width
        ) {
          continue;
        }

        const width =
          rect.right - rect.left - this.slotMargin * 2 - this.slotPadding * 2;
        const height =
          rect.bottom - rect.top - this.slotMargin * 2 - this.slotPadding * 2;
        const left =
          rect.left - canvasRect.left + this.slotMargin + this.slotPadding;
        const bottom =
          canvasRect.height -
          (rect.bottom - canvasRect.top) +
          this.slotMargin +
          this.slotPadding;

        this.renderer.setViewport(left, bottom, width, height);
        this.renderer.setScissor(left, bottom, width, height);
        this.renderer.render(scene, camera);
      }
    }
  };

  get element() {
    return this.wrapper;
  }

  private generate = () => {
    const {
      wrapperClass,
      wrapperStyles,
      slotClass,
      slotStyles,
      slotHoverClass,
      slotFocusClass,
      slotCountClass,
      slotCountStyles,
      horizontalCount,
      verticalCount,
      zoom,
      perspective,
    } = this.params;

    const { slotWidth, slotHeight, slotMargin, slotPadding } = this;

    const width =
      (slotWidth + slotMargin * 2 + slotPadding * 2) * horizontalCount;
    const height =
      (slotHeight + slotMargin * 2 + slotPadding * 2) * verticalCount;

    this.wrapper = document.createElement("div");
    this.wrapper.classList.add(wrapperClass);
    DOMUtils.applyStyles(this.wrapper, {
      ...wrapperStyles,
      width: `${width}px`,
      height: `${height}px`,
      display: "none",
    });

    this.slots = [];

    for (let row = 0; row < verticalCount; row++) {
      this.slots[row] = [];

      for (let col = 0; col < horizontalCount; col++) {
        const slot = new ItemSlot(row, col);

        slot.applyClass(slotClass);
        slot.applyStyles(slotStyles);
        slot.applyCountClass(slotCountClass);
        slot.applyCountStyles(slotCountStyles);

        slot.applyStyles({
          position: "absolute",
          top: `${
            (slotHeight + slotMargin * 2 + slotPadding * 2) * row + slotMargin
          }px`,
          left: `${
            (slotWidth + slotMargin * 2 + slotPadding * 2) * col + slotMargin
          }px`,
        });

        slot.setZoom(zoom);
        slot.setPerspective(perspective);

        this.slots[row][col] = slot;

        this.wrapper.appendChild(slot.element);
      }
    }

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    DOMUtils.applyStyles(this.canvas, {
      position: "absolute",
      background: "transparent",
      top: "0",
      left: "0",
      zIndex: "-1",
    });

    let mouseHoverPrevRow = null;
    let mouseHoverPrevCol = null;

    this.canvas.onmouseenter = () => {
      if (!this.activated) return;

      this.canvas.onmousemove = (event) => {
        const { row, col } = this.getRowColFromEvent(event);

        if (row === -1 || col === -1) {
          if (mouseHoverPrevRow !== null && mouseHoverPrevCol !== null) {
            this.slots[mouseHoverPrevRow][
              mouseHoverPrevCol
            ].element.classList.remove(slotHoverClass);
            DOMUtils.applyStyles(this.canvas, {
              cursor: "default",
            });
          }

          return;
        }

        if (
          mouseHoverPrevRow !== null &&
          mouseHoverPrevCol !== null &&
          (row !== mouseHoverPrevRow || col !== mouseHoverPrevCol)
        ) {
          this.slots[mouseHoverPrevRow][
            mouseHoverPrevCol
          ].element.classList.remove(slotHoverClass);
        }

        this.slots[row][col].element.classList.add(slotHoverClass);
        DOMUtils.applyStyles(this.canvas, {
          cursor: "pointer",
        });

        mouseHoverPrevRow = row;
        mouseHoverPrevCol = col;
      };
    };

    this.canvas.onmouseleave = () => {
      if (!this.activated) return;

      if (mouseHoverPrevRow !== null && mouseHoverPrevCol !== null) {
        this.slots[mouseHoverPrevRow][
          mouseHoverPrevCol
        ].element.classList.remove(slotHoverClass);
        DOMUtils.applyStyles(this.canvas, {
          cursor: "default",
        });
      }

      this.canvas.onmousemove = null;
    };

    this.canvas.onmousedown = (event) => {
      if (!this.activated) return;

      const { row, col } = this.getRowColFromEvent(event);
      if (row === -1 || col === -1) return;

      this.setFocused(row, col);
    };

    this.wrapper.appendChild(this.canvas);

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: true,
    });
    this.renderer.outputEncoding = sRGBEncoding;
    this.renderer.setSize(width, height);
  };
}
