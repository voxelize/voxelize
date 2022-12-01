import merge from "deepmerge";
import { OrthographicCamera, Scene, sRGBEncoding, WebGLRenderer } from "three";

import { World } from "../core/world/index";
import { DOMUtils } from "../utils";

const SLOT_SIZE = 40; // px
const BORDER_COLOR = "#393B44";

export type ItemSlotsParams = {
  wrapperClass: string;
  wrapperStyles: Partial<CSSStyleDeclaration>;

  slotClass: string;
  slotHoverClass: string;
  slotSelectedClass: string;
  slotEmptyClass: string;
  slotCountClass: string;

  slotStyles: Partial<CSSStyleDeclaration>;
  slotCountStyles: Partial<CSSStyleDeclaration>;

  horizontalCount: number;
  verticalCount: number;
};

const defaultParams: ItemSlotsParams = {
  wrapperClass: "item-slots",
  wrapperStyles: {},

  slotClass: "item-slots-slot",
  slotHoverClass: "item-slots-slot-hover",
  slotSelectedClass: "item-slots-slot-selected",
  slotEmptyClass: "item-slots-slot-empty",
  slotCountClass: "item-slots-slot-count",

  slotStyles: {},
  slotCountStyles: {},

  horizontalCount: 5,
  verticalCount: 1,
};

export class ItemSlot {
  public scene: Scene;

  public world: World;

  public camera: OrthographicCamera;

  public element: HTMLDivElement;

  public countElement: HTMLDivElement;

  public content: number;

  public count: number;

  constructor(world: World) {
    this.world = world;

    this.scene = new Scene();

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 3);

    this.element = document.createElement("div");
    this.countElement = document.createElement("div");
  }

  setContent = (content: number, count: number) => {
    this.content = content;
    this.count = count;

    this.countElement.innerText = count.toString();
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
}

export class ItemSlots {
  public params: ItemSlotsParams;

  public world: World;

  public wrapper: HTMLDivElement;

  public slots: ItemSlot[][];

  public canvas: HTMLCanvasElement;

  public renderer: WebGLRenderer;

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

  constructor(world: World, params: Partial<ItemSlotsParams> = {}) {
    this.params = merge(defaultParams, params);

    this.world = world;

    this.generate();
  }

  setContent = (row: number, col: number, content: number, count: number) => {
    const slot = this.slots[row][col];
    slot.setContent(content, count);
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
    return this.slots[row] ? this.slots[row][col] : null;
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
      slotSelectedClass,
      slotEmptyClass,
      slotCountClass,
      slotCountStyles,
      horizontalCount,
      verticalCount,
    } = this.params;

    const { slotWidth, slotHeight, slotMargin, slotPadding } = this;

    const width =
      (slotWidth + slotMargin * 2 + slotPadding * 2) * horizontalCount;
    const height =
      (slotHeight + slotMargin * 2 + slotPadding * 2) * verticalCount;

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.outputEncoding = sRGBEncoding;

    this.wrapper = document.createElement("div");
    this.wrapper.classList.add(wrapperClass);
    DOMUtils.applyStyles(this.wrapper, {
      ...wrapperStyles,
      width: `${width}px`,
      height: `${height}px`,
    });

    this.slots = [];

    for (let row = 0; row < verticalCount; row++) {
      this.slots[row] = [];

      for (let col = 0; col < horizontalCount; col++) {
        const slot = new ItemSlot(this.world);

        slot.applyClass(slotClass);
        slot.applyStyles(slotStyles);
        slot.applyCountClass(slotCountClass);
        slot.applyCountStyles(slotCountStyles);

        slot.applyStyles({
          position: "absolute",
          margin: `${slotMargin}px`,
          padding: `${slotPadding}px`,
          width: `${slotWidth}px`,
          height: `${slotHeight}px`,
          top: `${
            (slotHeight + slotMargin * 2 + slotPadding * 2) * row + slotMargin
          }px`,
          left: `${
            (slotWidth + slotMargin * 2 + slotPadding * 2) * col + slotMargin
          }px`,
        });

        this.slots[row][col] = slot;

        this.wrapper.appendChild(slot.element);
      }
    }

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    DOMUtils.applyStyles(this.canvas, {
      position: "absolute",
      top: "0",
      left: "0",
      zIndex: "-1",
    });

    let prevRow = null;
    let prevCol = null;

    this.canvas.onmouseenter = () => {
      this.canvas.onmousemove = (event) => {
        const { row, col } = this.getRowColFromEvent(event);

        if (row === -1 || col === -1) {
          if (prevRow !== null && prevCol !== null) {
            this.slots[prevRow][prevCol].element.classList.remove(
              slotHoverClass
            );
            DOMUtils.applyStyles(this.canvas, {
              cursor: "default",
            });
          }

          return;
        }

        if (
          prevRow !== null &&
          prevCol !== null &&
          (row !== prevRow || col !== prevCol)
        ) {
          this.slots[prevRow][prevCol].element.classList.remove(slotHoverClass);
        }

        this.slots[row][col].element.classList.add(slotHoverClass);
        DOMUtils.applyStyles(this.canvas, {
          cursor: "pointer",
        });

        prevRow = row;
        prevCol = col;
      };
    };

    this.canvas.onmouseleave = () => {
      if (prevRow !== null && prevCol !== null) {
        this.slots[prevRow][prevCol].element.classList.remove(slotHoverClass);
        DOMUtils.applyStyles(this.canvas, {
          cursor: "default",
        });
      }

      this.canvas.onmousemove = null;
    };

    this.wrapper.appendChild(this.canvas);
  };
}
