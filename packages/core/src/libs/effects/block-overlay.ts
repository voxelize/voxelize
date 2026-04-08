import { uniform } from "three/tsl";
import { Color, PerspectiveCamera, Vector3 } from "three/webgpu";

import { World } from "../../core/world";

export class BlockOverlayEffect {
  private _overlays: Map<number | string, [Color, number]> = new Map();
  private _oldId = 0;

  readonly colorUniform = uniform(new Color(0, 0, 0));
  readonly opacityUniform = uniform(0.0);

  constructor(
    public world: World,
    public camera: PerspectiveCamera,
  ) {}

  addOverlay = (idOrName: number | string, color: Color, opacity: number) => {
    this._overlays.set(
      typeof idOrName === "number" ? idOrName : idOrName.toLowerCase(),
      [color, opacity],
    );
  };

  update = () => {
    if (!this.world.isInitialized) return;

    const position = new Vector3();
    this.camera.getWorldPosition(position);
    const id = this.world.getVoxelAt(position.x, position.y, position.z);

    if (this._oldId !== id) {
      this._oldId = id;
    } else {
      return;
    }

    const block = this.world.getBlockById(id);
    const entry =
      this._overlays.get(id) || this._overlays.get(block.name.toLowerCase());

    if (!entry) {
      this.opacityUniform.value = 0;
    } else {
      this.colorUniform.value.copy(entry[0]);
      this.opacityUniform.value = entry[1];
    }
  };
}
