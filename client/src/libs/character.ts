import {
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Quaternion,
  Vector3,
} from "three";

import { MathUtils as VoxMathUtils } from "../utils";

import { CanvasBox, CanvasBoxParams } from "./canvas-box";
import { NameTag } from "./nametag";

export type HeadParams = CanvasBoxParams & {
  neckGap?: number;
};

export type BodyParams = CanvasBoxParams;

export type LegParams = CanvasBoxParams & {
  betweenLegsGap?: number;
};

export type ArmsParams = CanvasBoxParams & {
  shoulderDrop?: number;
  shoulderGap?: number;
};

export type CharacterParams = {
  swingLerp?: number;
  walkingSpeed?: number;
  idleArmSwing?: number;
  positionLerp?: number;
  rotationLerp?: number;
  head?: Partial<HeadParams>;
  body?: Partial<BodyParams>;
  legs?: Partial<LegParams>;
  arms?: Partial<ArmsParams>;
};

const defaultCharacterParams: CharacterParams = {
  swingLerp: 0.8,
  walkingSpeed: 1.4,
  positionLerp: 0.7,
  rotationLerp: 0.2,
  idleArmSwing: 0.06,
};

const defaultHeadParams: HeadParams = {
  gap: 0.1,
  layers: 1,
  side: DoubleSide,
  width: 0.5,
  widthSegments: 16,
  height: 0.25,
  heightSegments: 8,
  depth: 0.5,
  depthSegments: 16,
  neckGap: 0.05,
};

const defaultBodyParams: BodyParams = {
  gap: 0.1,
  layers: 1,
  side: DoubleSide,
  width: 1,
  widthSegments: 16,
};

const defaultArmsParams: ArmsParams = {
  gap: 0.1,
  layers: 1,
  side: DoubleSide,
  width: 0.25,
  height: 0.5,
  depth: 0.25,
  widthSegments: 8,
  heightSegments: 16,
  depthSegments: 8,
  shoulderGap: 0.05,
  shoulderDrop: 0.25,
};

const defaultLegsParams: LegParams = {
  gap: 0.1,
  layers: 1,
  side: DoubleSide,
  width: 0.25,
  height: 0.25,
  depth: 0.25,
  widthSegments: 3,
  heightSegments: 3,
  depthSegments: 3,
  betweenLegsGap: 0.2,
};

const drawCrown = (context: CanvasRenderingContext2D) => {
  const gold = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 2],
    [2, 2],
    [2, 1],
    [3, 0],
    [3, 2],
    [4, 0],
    [4, 2],
    [5, 1],
    [5, 2],
    [6, 2],
    [7, 0],
    [7, 1],
    [7, 2],
  ];

  const blue = [
    [1, 1],
    [6, 1],
  ];

  context.fillStyle = "#f7ea00";
  gold.forEach(([x, y]) => context.fillRect(x, y, 1, 1));

  context.fillStyle = "#51c2d5";
  blue.forEach(([x, y]) => context.fillRect(x, y, 1, 1));

  context.fillStyle = "#ff005c";
  context.fillRect(3, 1, 1, 1);
  context.fillRect(4, 1, 1, 1);
};

/**
 * The default Voxelize character.
 */
export class Character extends Group {
  public params: CharacterParams;

  public headGroup: Group;
  public bodyGroup: Group;
  public leftArmGroup: Group;
  public rightArmGroup: Group;
  public leftLegGroup: Group;
  public rightLegGroup: Group;
  public head: CanvasBox;
  public body: CanvasBox;
  public leftArm: CanvasBox;
  public rightArm: CanvasBox;
  public leftLeg: CanvasBox;
  public rightLeg: CanvasBox;
  public nametag: NameTag;
  public crown: CanvasBox;

  public speed = 0;

  public newPosition = new Vector3();
  public newBodyDirection = new Quaternion();
  public newDirection = new Quaternion();

  onMove: () => void;
  onIdle: () => void;

  constructor(params: Partial<CharacterParams> = {}) {
    super();

    this.params = {
      ...defaultCharacterParams,
      ...params,
      head: {
        ...defaultHeadParams,
        ...(params.head || {}),
        depth:
          params.head?.depth || params.head?.width || defaultHeadParams.width,
        height:
          params.head?.height ||
          defaultHeadParams.height ||
          defaultHeadParams.width,
      },
      body: {
        ...defaultBodyParams,
        ...(params.body || {}),
        depth:
          params.body?.depth ||
          defaultBodyParams.depth ||
          defaultBodyParams.width,
        height:
          params.body?.height ||
          defaultBodyParams.height ||
          defaultBodyParams.width,
      },
      arms: {
        ...defaultArmsParams,
        ...(params.arms || {}),
        depth: params.arms?.depth || defaultArmsParams.width,
        height: params.arms?.height || defaultArmsParams.height,
      },
      legs: {
        ...defaultLegsParams,
        ...(params.legs || {}),
        depth: params.legs?.depth || defaultLegsParams.width,
        height: params.legs?.height || defaultLegsParams.height,
      },
    };

    this.createModel();
    this.addAccessories();
  }

  update = () => {
    this.calculateDelta();
    this.playArmSwingAnimation();
    this.playWalkingAnimation();
    this.lerpAll();
  };

  calculateDelta = () => {
    const p1 = this.position.clone();
    const p2 = this.newPosition.clone();
    p1.y = p2.y = 0;
    const dist = p1.distanceTo(p2);
    if (dist > 0.00001) {
      if (this.speed === 0) this.onMove?.();
      this.speed = this.params.walkingSpeed;
    } else {
      if (this.speed > 0) this.onIdle?.();
      this.speed = 0;
    }
  };

  lerpAll = () => {
    // POSITION FIRST!!!!
    // or else network latency will result in a weird
    // animation defect where body glitches out.
    if (this.newPosition.length() !== 0) {
      this.position.lerp(this.newPosition, this.params.positionLerp);
    }

    // Head rotates immediately.
    if (this.newDirection.length() !== 0) {
      this.headGroup.rotation.setFromQuaternion(this.newDirection);
    }

    if (this.newBodyDirection.length() !== 0) {
      this.bodyGroup.quaternion.slerp(
        this.newBodyDirection,
        this.params.rotationLerp
      );
    }
  };

  playArmSwingAnimation = () => {
    const scale = 100;
    const speed = Math.max(this.speed, this.params.idleArmSwing);
    const amplitude = speed * 1;

    this.leftArmGroup.rotation.x = MathUtils.lerp(
      this.leftArmGroup.rotation.x,
      Math.sin((performance.now() * speed) / scale) * amplitude,
      this.params.swingLerp
    );
    this.leftArmGroup.rotation.z = MathUtils.lerp(
      this.leftArmGroup.rotation.z,
      Math.cos((performance.now() * speed) / scale) ** 2 * amplitude * 0.1,
      this.params.swingLerp
    );

    this.rightArmGroup.rotation.x = MathUtils.lerp(
      this.rightArmGroup.rotation.x,
      Math.sin((performance.now() * speed) / scale + Math.PI) * amplitude,
      this.params.swingLerp
    );
    this.rightArmGroup.rotation.z = MathUtils.lerp(
      this.rightArmGroup.rotation.z,
      -(Math.sin((performance.now() * speed) / scale) ** 2 * amplitude * 0.1),
      this.params.swingLerp
    );
  };

  playWalkingAnimation = () => {
    const scale = 100;
    const amplitude = this.speed * 1;

    this.leftLegGroup.rotation.x =
      -Math.sin((performance.now() * this.speed) / scale) * amplitude;
    this.rightLegGroup.rotation.x =
      Math.sin((performance.now() * this.speed) / scale) * amplitude;
  };

  set = (position: number[], direction: number[]) => {
    this.newPosition.set(position[0], position[1], position[2]);

    this.newDirection.copy(
      VoxMathUtils.directionToQuaternion(
        direction[0],
        direction[1],
        direction[2]
      )
    );
    this.newBodyDirection.copy(
      VoxMathUtils.directionToQuaternion(direction[0], 0, direction[2])
    );
  };

  set username(username: string) {
    if (!username) return;

    if (!this.nametag) {
      this.nametag = new NameTag(username, {
        yOffset: this.totalHeight * 1.1,
        fontSize: 0.2,
      });
      this.add(this.nametag);
    }

    this.nametag.text = username;
  }

  get username() {
    return this.nametag.text;
  }

  get eyeHeight() {
    return (
      this.params.legs.height +
      this.params.body.height +
      this.params.head.neckGap +
      this.params.head.height / 2
    );
  }

  get totalHeight() {
    return (
      this.params.legs.height +
      this.params.body.height +
      this.params.head.neckGap +
      this.params.head.height
    );
  }

  private createModel = () => {
    const head = new CanvasBox({
      ...defaultHeadParams,
      ...(this.params.head ? this.params.head : {}),
    });

    const body = new CanvasBox({
      ...defaultBodyParams,
      ...(this.params.body ? this.params.body : {}),
    });

    const leftArm = new CanvasBox({
      ...defaultArmsParams,
      ...(this.params.arms ? this.params.arms : {}),
    });

    const rightArm = new CanvasBox({
      ...defaultArmsParams,
      ...(this.params.arms ? this.params.arms : {}),
    });

    const leftLeg = new CanvasBox({
      ...defaultLegsParams,
      ...(this.params.legs ? this.params.legs : {}),
    });

    const rightLeg = new CanvasBox({
      ...defaultLegsParams,
      ...(this.params.legs ? this.params.legs : {}),
    });

    this.headGroup = new Group();
    this.bodyGroup = new Group();
    this.leftArmGroup = new Group();
    this.rightArmGroup = new Group();
    this.leftLegGroup = new Group();
    this.rightLegGroup = new Group();

    this.headGroup.add(head);
    head.position.y += head.height / 2;
    this.headGroup.position.y += body.height + leftLeg.height;

    if (this.params.head && this.params.head.neckGap) {
      this.headGroup.position.y += this.params.head.neckGap;
    }

    this.bodyGroup.add(body);
    body.position.y += body.height / 2;
    this.bodyGroup.position.y += leftLeg.height;

    this.leftArmGroup.add(leftArm);
    leftArm.position.y -= leftArm.height / 2;
    leftArm.position.x -= leftArm.width / 2;
    this.leftArmGroup.position.y += body.height;
    this.leftArmGroup.position.x -= body.width / 2;

    this.rightArmGroup.add(rightArm);
    rightArm.position.y -= rightArm.height / 2;
    rightArm.position.x += rightArm.width / 2;
    this.rightArmGroup.position.y += body.height;
    this.rightArmGroup.position.x += body.width / 2;

    if (this.params.arms) {
      if (this.params.arms.shoulderDrop) {
        this.leftArmGroup.position.y -= this.params.arms.shoulderDrop;
        this.rightArmGroup.position.y -= this.params.arms.shoulderDrop;
      }

      if (this.params.arms.shoulderGap) {
        this.leftArmGroup.position.x -= this.params.arms.shoulderGap;
        this.rightArmGroup.position.x += this.params.arms.shoulderGap;
      }
    }

    this.leftLegGroup.add(leftLeg);
    leftLeg.position.y -= leftLeg.height / 2;
    leftLeg.position.x -= leftLeg.width / 2;

    this.rightLegGroup.add(rightLeg);
    rightLeg.position.y -= rightLeg.height / 2;
    rightLeg.position.x += rightLeg.width / 2;

    if (this.params.legs && this.params.legs.betweenLegsGap) {
      this.leftLegGroup.position.x -= this.params.legs.betweenLegsGap / 2;
      this.rightLegGroup.position.x += this.params.legs.betweenLegsGap / 2;
    }

    head.paint("all", new Color("#96baff"));
    head.paint("front", new Color("#f99999"));
    body.paint("all", new Color("#2b2e42"));
    leftArm.paint("all", new Color("#548ca8"));
    rightArm.paint("all", new Color("#548ca8"));
    leftLeg.paint("all", new Color("#96baff"));
    rightLeg.paint("all", new Color("#96baff"));

    this.add(this.headGroup, this.bodyGroup);

    this.bodyGroup.add(
      this.leftArmGroup,
      this.rightArmGroup,
      this.leftLegGroup,
      this.rightLegGroup
    );

    this.headGroup.position.y -= this.eyeHeight;
    this.bodyGroup.position.y -= this.eyeHeight;

    this.head = head;
    this.body = body;
    this.leftArm = leftArm;
    this.rightArm = rightArm;
    this.leftLeg = leftLeg;
    this.rightLeg = rightLeg;
  };

  private addAccessories = () => {
    this.crown = new CanvasBox({
      width: 0.1,
    });
  };
}
