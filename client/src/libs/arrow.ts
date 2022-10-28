import {
  ArrowHelper,
  Color,
  CylinderBufferGeometry,
  Mesh,
  MeshBasicMaterial,
} from "three";

export type ArrowParams = {
  radius: number;
  height: number;
  coneRadius: number;
  coneHeight: number;
  color: string | Color;
};

const defaultParams: ArrowParams = {
  radius: 0.1,
  height: 0.8,
  coneRadius: 0.2,
  coneHeight: 0.2,
  color: "red",
};

export class Arrow extends ArrowHelper {
  public params: ArrowParams;

  constructor(params: Partial<ArrowParams> = {}) {
    super();

    const { radius, height, coneRadius, coneHeight } = (this.params = {
      ...defaultParams,
      ...params,
    });

    const color =
      typeof this.params.color === "string"
        ? new Color(this.params.color)
        : this.params.color;

    [...this.children].forEach((child) => this.remove(child));

    this.add(
      new Mesh(
        new CylinderBufferGeometry(radius, radius, height),
        new MeshBasicMaterial({ color })
      )
    );

    const cone = new Mesh(
      new CylinderBufferGeometry(0, coneRadius, coneHeight),
      new MeshBasicMaterial({ color })
    );
    cone.position.y = (coneHeight + height) / 2;

    this.add(cone);
  }
}
