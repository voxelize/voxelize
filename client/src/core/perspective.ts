import { PerspectiveCamera } from "three";

import { Inputs } from "./inputs";
import { World } from "./world";

export class Perspective {
  public state: "first" | "second" | "third" = "first";

  /**
   * The camera that is being used for this perspective.
   */
  public camera: PerspectiveCamera;

  /**
   * The context of the perspective.
   */
  public world: World;

  constructor(camera: PerspectiveCamera, world: World) {
    // this.connect();
  }

  // connect = () => {};

  // update = (delta: number) => {};

  // dispose = () => {};
}
