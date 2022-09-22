import { Group } from "three";

import { CanvasBox } from "./canvas-box";

export class Character extends Group {
  public head: CanvasBox;
  public body: CanvasBox;
  public leftArm: CanvasBox;
  public rightArm: CanvasBox;
  public leftLeg: CanvasBox;
  public rightLeg: CanvasBox;
}
