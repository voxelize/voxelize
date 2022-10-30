import {
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Quaternion,
  Vector3,
} from "three";

import { MathUtils as VoxMathUtils } from "../utils";

import { ArtFunction, CanvasBox, CanvasBoxParams } from "./canvas-box";
import { NameTag } from "./nametag";

/**
 * Parameters to create a character's head.
 * Defaults to:
 * ```ts
 * {
 *   gap: 0.1,
 *   layers: 1,
 *   side: THREE.DoubleSide,
 *   width: 0.5,
 *   widthSegments: 16,
 *   height: 0.25,
 *   heightSegments: 8,
 *   depth: 0.5,
 *   depthSegments: 16,
 *   neckGap: 0.05,
 * }
 * ```
 */
export type HeadParams = CanvasBoxParams & {
  /**
   * The distance between the head and the body.
   */
  neckGap?: number;
};

/**
 * Parameters to create a character's body.
 * Defaults to:
 * ```ts
 * {
 *   gap: 0.1,
 *   layers: 1,
 *   side: THREE.DoubleSide,
 *   width: 1,
 *   widthSegments: 16,
 * }
 * ```
 */
export type BodyParams = CanvasBoxParams;

/**
 * Parameters to create the legs of a character.
 * Defaults to:
 * ```ts
 * {
 *   gap: 0.1,
 *   layers: 1,
 *   side: THREE.DoubleSide,
 *   width: 0.25,
 *   widthSegments: 3,
 *   height: 0.25,
 *   heightSegments: 3,
 *   depth: 0.25,
 *   depthSegments: 3,
 *   betweenLegsGap: 0.2,
 * }
 * ```
 */

export type LegParams = CanvasBoxParams & {
  /**
   * The gap between the legs.
   */
  betweenLegsGap?: number;
};

/**
 * Parameters to create a character's arms.
 * Defaults to:
 * ```ts
 * {
 *   gap: 0.1,
 *   layers: 1,
 *   side: THREE.DoubleSide,
 *   width: 0.25,
 *   widthSegments: 8,
 *   height: 0.5,
 *   heightSegments: 16,
 *   depth: 0.25,
 *   depthSegments: 8,
 *   shoulderGap: 0.05,
 *   shoulderDrop: 0.25,
 * }
 * ```
 */
export type ArmsParams = CanvasBoxParams & {
  /**
   * The distance from the top of the body to the top of the arms.
   */
  shoulderDrop?: number;

  /**
   * The distance between the body and each arm.
   */
  shoulderGap?: number;
};

/**
 * Parameters to create a character.
 */
export type CharacterParams = {
  /**
   * The lerp factor of the swinging motion of the arms and legs. Defaults to `0.8`.
   */
  swingLerp?: number;

  /**
   * The speed at which the arms swing when the character is moving. Defaults to `1.4`.
   */
  walkingSpeed?: number;

  /**
   * The speed at which the arms swing when the character is idle. Defaults to `0.06`.
   */
  idleArmSwing?: number;

  /**
   * The lerp factor of the character's position change. Defaults to `0.7`.
   */
  positionLerp?: number;

  /**
   * The lerp factor of the character's rotation change. Defaults to `0.2`.
   */
  rotationLerp?: number;

  /**
   * Parameters to create the character's head.
   */
  head?: Partial<HeadParams>;

  /**
   * Parameters to create the character's body.
   */
  body?: Partial<BodyParams>;

  /**
   * Parameters to create the character's legs.
   */
  legs?: Partial<LegParams>;

  /**
   * Parameters to create the character's arms.
   */
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

/**
 * The default Voxelize character. This can be used in `Peers.createPeer` to apply characters onto
 * multiplayer peers. This can also be **attached** to a `RigidControls` instance to have a character
 * follow the controls.
 *
 * When `character.set` is called, the character's head will be lerp to the new rotation first, then the
 * body will be lerp to the new rotation. This is to create a more natural looking of character rotation.
 *
 * # Example
 * ```ts
 * const character = new VOXELIZE.Character();
 * character.username = "<placeholder>";
 *
 * // Load a texture to paint on the face.
 * world.loader.addTexture(FunnyImageSrc, (texture) => {
 *   character.head.paint("front", texture);
 * })
 *
 * controls.attachCharacter(character);
 * ```
 *
 * ![Character](/img/character.png)
 *
 * <p style={{textAlign: "center", color: "gray", fontSize: "0.8rem"}}>A character with a funny face.</p>
 *
 * @noInheritDoc
 */
export class Character extends Group {
  /**
   * Parameters to create a Voxelize character.
   */
  public params: CharacterParams;

  /**
   * The sub-mesh holding the character's head.
   */
  public headGroup: Group;

  /**
   * The sub-mesh holding the character's body.
   */
  public bodyGroup: Group;

  /**
   * The sub-mesh holding the character's left arm.
   */
  public leftArmGroup: Group;

  /**
   * The sub-mesh holding the character's right arm.
   */
  public rightArmGroup: Group;

  /**
   * The sub-mesh holding the character's left leg.
   */
  public leftLegGroup: Group;

  /**
   * The sub-mesh holding the character's right leg.
   */
  public rightLegGroup: Group;

  /**
   * The actual head mesh as a paint-able `CanvasBox`.
   */
  public head: CanvasBox;

  /**
   * The actual body mesh as a paint-able `CanvasBox`.
   */
  public body: CanvasBox;

  /**
   * The actual left arm mesh as a paint-able `CanvasBox`.
   */
  public leftArm: CanvasBox;

  /**
   * The actual right arm mesh as a paint-able `CanvasBox`.
   */
  public rightArm: CanvasBox;

  /**
   * The actual left leg mesh as a paint-able `CanvasBox`.
   */
  public leftLeg: CanvasBox;

  /**
   * The actual right leg mesh as a paint-able `CanvasBox`.
   */
  public rightLeg: CanvasBox;

  /**
   * The nametag of the character that floats right above the head.
   */
  public nametag: NameTag;

  /**
   * The speed where the character has detected movements at. When speed is 0, the
   * arms swing slowly in idle mode, and when speed is greater than 0, the arms swing
   * faster depending on the passed-in parameters.
   */
  public speed = 0;

  /**
   * The new position of the character. This is used to lerp the character's position
   */
  public newPosition = new Vector3();

  /**
   * The new body direction of the character. This is used to lerp the character's body rotation.
   */
  public newBodyDirection = new Quaternion();

  /**
   * The new head direction of the character. This is used to lerp the character's head rotation.
   */
  public newDirection = new Quaternion();

  /**
   * A listener called when a character starts moving.
   */
  onMove: () => void;

  /**
   * A listener called when a character stops moving.
   */
  onIdle: () => void;

  /**
   * Create a new Voxelize character.
   *
   * @param params Parameters to create a Voxelize character.
   */
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
  }

  /**
   * Update the character's animation and rotation. After `set` is called, `update` must be called to
   * actually lerp to the new position and rotation. Note that when a character is attached to a control,
   * `update` is called automatically within the control's update loop.
   */
  update = () => {
    this.calculateDelta();
    this.playArmSwingAnimation();
    this.playWalkingAnimation();
    this.lerpAll();
  };

  /**
   * Set the character's position and direction that its body is situated at and the head is looking
   * at. This uses `MathUtils.directionToQuaternion` to slerp the head's rotation to the new direction.
   *
   * The `update` needs to be called to actually lerp to the new position and rotation.
   *
   * @param position The new position of the character.
   * @param direction The new direction of the character.
   */
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

  /**
   * Change the content of the user's nametag. If the nametag is empty, nothing will be rendered.
   */
  set username(username: string) {
    if (!username) {
      this.nametag.visible = false;
      return;
    }

    if (!this.nametag) {
      this.nametag = new NameTag(username, {
        yOffset: this.head.height,
        fontSize: 0.2,
      });
      this.add(this.nametag);
    }

    this.nametag.text = username;
  }

  /**
   * Get the content of the nametag of the character.
   */
  get username() {
    return this.nametag.text;
  }

  /**
   * Get the height at which the eye of the character is situated at.
   */
  get eyeHeight() {
    return (
      this.params.legs.height +
      this.params.body.height +
      this.params.head.neckGap +
      this.params.head.height / 2
    );
  }

  /**
   * Get the total height of the character, in other words, the sum of the heights of
   * the head, body, and legs.
   */
  get totalHeight() {
    return (
      this.params.legs.height +
      this.params.body.height +
      this.params.head.neckGap +
      this.params.head.height
    );
  }

  /**
   * Create the character's model programmatically.
   */
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

  /**
   * Calculate the delta between the current position and the new position to determine if the character
   * is moving or not.
   */
  private calculateDelta = () => {
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

  /**
   * Lerp all character's body parts to the new position and new rotation.
   */
  private lerpAll = () => {
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

  /**
   * Play the walking animation for the character, in other words the arm movements.
   */
  private playArmSwingAnimation = () => {
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

  /**
   * Play the walking animation for the character, in other words the leg movements.
   */
  private playWalkingAnimation = () => {
    const scale = 100;
    const amplitude = this.speed * 1;

    this.leftLegGroup.rotation.x =
      -Math.sin((performance.now() * this.speed) / scale) * amplitude;
    this.rightLegGroup.rotation.x =
      Math.sin((performance.now() * this.speed) / scale) * amplitude;
  };
}
