import merge from "deepmerge";
import {
  DirectionalLight,
  Object3D,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";

import { CameraPerspective, noop } from "../common";
import { Inputs } from "../core/inputs";
import { DOMUtils } from "../utils";

export type ItemSlotsOptions = {
  wrapperClass: string;
  wrapperStyles: Partial<CSSStyleDeclaration>;

  slotClass: string;
  slotHoverClass: string;
  slotFocusClass: string;
  slotSubscriptClass: string;

  slotStyles: Partial<CSSStyleDeclaration>;
  slotSubscriptStyles: Partial<CSSStyleDeclaration>;

  horizontalCount: number;
  verticalCount: number;
  focusFirstByDefault: boolean;
  activatedByDefault: boolean;

  zoom: number;
  perspective: CameraPerspective;
  scrollable?: boolean;
};

const defaultOptions: ItemSlotsOptions = {
  wrapperClass: "item-slots",
  wrapperStyles: {},

  slotClass: "item-slots-slot",
  slotHoverClass: "item-slots-slot-hover",
  slotFocusClass: "item-slots-slot-focus",
  slotSubscriptClass: "item-slots-slot-subscript",

  slotStyles: {},
  slotSubscriptStyles: {},

  horizontalCount: 5,
  verticalCount: 1,
  focusFirstByDefault: true,
  activatedByDefault: true,

  zoom: 1,
  perspective: "pxyz",
  scrollable: true,
};

export class ItemSlot<T = number> {
  public row: number;

  public col: number;

  public scene: Scene;

  public object: Object3D;

  public light: DirectionalLight;

  public camera: OrthographicCamera = new OrthographicCamera(
    -1,
    1,
    1,
    -1,
    0,
    10
  );

  public element: HTMLDivElement;

  public subscriptElement: HTMLDivElement;

  public subscript: string;

  public content: T;

  public zoom = 1;

  public lightRotationOffset = -Math.PI / 8;

  public offset: Vector3 = new Vector3();

  constructor(row: number, col: number) {
    this.row = row;
    this.col = col;

    this.scene = new Scene();

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);

    this.element = document.createElement("div");
    this.subscriptElement = document.createElement("div");
    this.element.appendChild(this.subscriptElement);

    this.offset = new Vector3();

    this.light = new DirectionalLight(0xffffff, 3);
    this.scene.add(this.light);

    this.updateCamera();
  }

  getObject = () => this.object;

  setObject = (object: Object3D) => {
    if (this.object) {
      this.scene.remove(this.object);
    }

    this.object = object;
    this.scene.add(object);
  };

  getContent = () => this.content;

  setContent = (content: T) => {
    this.content = content;
  };

  getSubscript = () => this.subscript;

  setSubscript = (subscript: string) => {
    this.subscript = subscript;
    this.subscriptElement.innerText = subscript;
  };

  setZoom = (zoom: number) => {
    this.zoom = zoom;
    this.camera.far = zoom * 3 + 1;
    this.updateCamera();
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

  removeClass = (className: string) => {
    this.element.classList.remove(className);
  };

  applySubscriptClass = (className: string) => {
    this.subscriptElement.classList.add(className);
  };

  removeSubscriptClass = (className: string) => {
    this.subscriptElement.classList.remove(className);
  };

  applyStyles = (styles: Partial<CSSStyleDeclaration>) => {
    DOMUtils.applyStyles(this.element, styles);
  };

  applySubscriptStyles = (styles: Partial<CSSStyleDeclaration>) => {
    DOMUtils.applyStyles(this.subscriptElement, styles);
  };

  private updateCamera = () => {
    this.camera.position.copy(
      this.offset.clone().multiplyScalar((this.zoom || 1) * 3.5)
    );

    this.camera.lookAt(0, 0, 0);

    const lightPosition = this.camera.position.clone();
    // Rotate light position by y axis 45 degrees.
    lightPosition.applyAxisAngle(
      new Vector3(0, 1, 0),
      this.lightRotationOffset
    );

    this.light.position.copy(lightPosition);
  };
}

export class ItemSlots<T = number> {
  public options: ItemSlotsOptions;

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

  public onSlotClick: (slot: ItemSlot<T>) => void = noop;
  public onSlotUpdate: (slot: ItemSlot<T>) => void = noop;
  public onFocusChange: (prevSlot: ItemSlot<T>, nextSlot: ItemSlot<T>) => void =
    noop;

  private slots: ItemSlot<T>[][];

  private animationFrame = -1;

  constructor(options: Partial<ItemSlotsOptions> = {}) {
    const { focusFirstByDefault, activatedByDefault } = (this.options = merge(
      defaultOptions,
      options
    ));

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

  setObject = (row: number, col: number, object: Object3D) => {
    if (!this.slots[row] || !this.slots[row][col]) {
      return;
    }

    const slot = this.slots[row][col];
    slot.setObject(object);
    this.onSlotUpdate?.(slot);
  };

  setContent = (row: number, col: number, content: T) => {
    if (!this.slots[row] || !this.slots[row][col]) {
      return;
    }

    const slot = this.slots[row][col];
    slot.setContent(content);
    this.onSlotUpdate?.(slot);
  };

  setSubscript = (row: number, col: number, subscript: string) => {
    if (!this.slots[row] || !this.slots[row][col]) {
      return;
    }

    const slot = this.slots[row][col];
    slot.setSubscript(subscript);
    this.onSlotUpdate?.(slot);
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
      slot.element.classList.remove(this.options.slotFocusClass);
    }

    this.focusedRow = row;
    this.focusedCol = col;

    const slot = this.slots[this.focusedRow][this.focusedCol];

    this.onFocusChange(
      hadPrevious ? this.slots[this.focusedRow][this.focusedCol] : null,
      slot
    );

    slot.element.classList.add(this.options.slotFocusClass);
    this.onSlotClick(slot);
  };

  getObject = (row: number, col: number) => {
    if (!this.slots[row] || !this.slots[row][col]) {
      return null;
    }

    return this.slots[row][col].object;
  };

  getContent = (row: number, col: number) => {
    if (!this.slots[row] || !this.slots[row][col]) {
      return null;
    }

    return this.slots[row][col].content;
  };

  getSubscript = (row: number, col: number) => {
    if (!this.slots[row] || !this.slots[row][col]) {
      return null;
    }

    return this.slots[row][col].subscript;
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
    const { verticalCount, horizontalCount } = this.options;

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
    if (row < 0 || row >= this.options.verticalCount) return null;
    if (col < 0 || col >= this.options.horizontalCount) return null;

    return this.slots[row][col];
  };

  connect = (inputs: Inputs, namespace = "*") => {
    const { slotHoverClass, scrollable } = this.options;

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

    const unbind = scrollable
      ? inputs.scroll(
          // Scrolling up, inventory goes left and up
          () => {
            if (!this.activated) return;
            if (this.focusedRow === -1 || this.focusedCol === -1) return;

            const { horizontalCount, verticalCount } = this.options;

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

            const { horizontalCount, verticalCount } = this.options;

            const row = this.focusedRow;
            const col = this.focusedCol;

            if (col === horizontalCount - 1) {
              this.setFocused(row === verticalCount - 1 ? 0 : row + 1, 0);
            } else {
              this.setFocused(row, col + 1);
            }
          },
          namespace
        )
      : noop;

    return () => {
      try {
        unbind();
        this.canvas.onmousedown = null;
        this.canvas.onmouseenter = null;
        this.canvas.onmouseleave = null;
      } catch (e) {
        // Ignore
      }
    };
  };

  render = () => {
    this.animationFrame = requestAnimationFrame(this.render);

    if (!this.activated) return;

    const { horizontalCount, verticalCount } = this.options;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.renderer.setSize(width, height, false);
    }

    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.setScissorTest(true);

    const canvasRect = this.renderer.domElement.getBoundingClientRect();

    let hasRendered = false;

    for (let i = 0; i < verticalCount; i++) {
      for (let j = 0; j < horizontalCount; j++) {
        const { scene, camera, element, object } = this.slots[i][j];

        if (!object) continue;

        const rect = element.getBoundingClientRect();

        if (
          rect.top + rect.height < canvasRect.top ||
          rect.top > canvasRect.top + canvasRect.height ||
          rect.left + rect.width < canvasRect.left ||
          rect.left > canvasRect.left + canvasRect.width
        ) {
          continue;
        }

        hasRendered = true;

        const width =
          rect.right - rect.left - this.slotMargin * 2 - this.slotPadding * 2;
        const height =
          rect.bottom - rect.top - this.slotMargin * 2 - this.slotPadding * 2;

        if (width <= 0 || height <= 0) continue;

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

    if (!hasRendered) {
      // Render transparent background
      this.renderer.setViewport(0, 0, width, height);
      this.renderer.setScissor(0, 0, width, height);
      this.renderer.render(this.slots[0][0].scene, this.slots[0][0].camera);
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
      slotSubscriptClass,
      slotSubscriptStyles,
      horizontalCount,
      verticalCount,
      zoom,
      perspective,
    } = this.options;

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
        const slot = new ItemSlot<T>(row, col);

        slot.applyClass(slotClass);
        slot.applyStyles(slotStyles);
        slot.applySubscriptClass(slotSubscriptClass);
        slot.applySubscriptStyles(slotSubscriptStyles);

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

    this.wrapper.appendChild(this.canvas);

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setSize(width, height);
  };
}
