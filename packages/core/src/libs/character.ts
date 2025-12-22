import { Inputs } from "core";
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Clock,
  Color,
  DoubleSide,
  Group,
  LoopOnce,
  MathUtils,
  Object3D,
  Quaternion,
  Vector3,
} from "three";

import { AnimationUtils, MathUtils as VoxMathUtils } from "../utils";

import { CanvasBox, CanvasBoxOptions } from "./canvas-box";
import { NameTag, NameTagOptions } from "./nametag";

const CHARACTER_SCALE = 0.9;

const SWING_TIMES = [0, 0.05, 0.1, 0.15, 0.2, 0.3];

const SWING_QUATERNIONS = [
  new Quaternion(
    0.22181091786438836,
    0.1299627903568272,
    0.4885423545532194,
    0.8338081060090633
  ),
  new Quaternion(
    0.893363678312996,
    -0.013401460299294354,
    -0.006736763863508881,
    0.4490839065760065
  ),
  new Quaternion(
    0.9328672195091751,
    -0.12196055833290745,
    -0.04393897067375234,
    0.3360859113864748
  ),
  new Quaternion(
    0.7659226373876284,
    0.04985520396032439,
    0.04163546301748589,
    0.6396432289914226
  ),
];

/**
 * Parameters to create a character's head.
 * Defaults to:
 * ```ts
 * {
 *   gap: 0.1 * CHARACTER_SCALE,
 *   layers: 1,
 *   side: THREE.DoubleSide,
 *   width: 0.5 * CHARACTER_SCALE,
 *   widthSegments: 16,
 *   height: 0.25 * CHARACTER_SCALE,
 *   heightSegments: 8,
 *   depth: 0.5 * CHARACTER_SCALE,
 *   depthSegments: 16,
 *   neckGap: 0.05 * CHARACTER_SCALE,
 * }
 * ```
 * where `CHARACTER_SCALE` is 0.9.
 */

type ColorCanvasBoxOptions = CanvasBoxOptions & {
  color: Color | string;
};

export type HeadOptions = ColorCanvasBoxOptions & {
  /**
   * The distance between the head and the body.
   */
  neckGap?: number;
  faceColor: Color | string;
};

/**
 * Parameters to create a character's body.
 * Defaults to:
 * ```ts
 * {
 *   gap: 0.1 * CHARACTER_SCALE,
 *   layers: 1,
 *   side: THREE.DoubleSide,
 *   width: 1 * CHARACTER_SCALE,
 *   widthSegments: 16,
 * }
 * ```
 * where `CHARACTER_SCALE` is 0.9.
 */
export type BodyOptions = ColorCanvasBoxOptions;

/**
 * Parameters to create the legs of a character.
 * Defaults to:
 * ```ts
 * {
 *   gap: 0.1 * CHARACTER_SCALE,
 *   layers: 1,
 *   side: THREE.DoubleSide,
 *   width: 0.25 * CHARACTER_SCALE,
 *   widthSegments: 3,
 *   height: 0.25 * CHARACTER_SCALE,
 *   heightSegments: 3,
 *   depth: 0.25 * CHARACTER_SCALE,
 *   depthSegments: 3,
 *   betweenLegsGap: 0.2 * CHARACTER_SCALE,
 * }
 * ```
 * where `CHARACTER_SCALE` is 0.9.
 */

export type LegOptions = ColorCanvasBoxOptions & {
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
 *   gap: 0.1 * CHARACTER_SCALE,
 *   layers: 1,
 *   side: THREE.DoubleSide,
 *   width: 0.25 * CHARACTER_SCALE,
 *   widthSegments: 8,
 *   height: 0.5 * CHARACTER_SCALE,
 *   heightSegments: 16,
 *   depth: 0.25 * CHARACTER_SCALE,
 *   depthSegments: 8,
 *   shoulderGap: 0.05 * CHARACTER_SCALE,
 *   shoulderDrop: 0.25 * CHARACTER_SCALE,
 * }
 * ```
 */
export type ArmsOptions = ColorCanvasBoxOptions & {
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
export type CharacterOptions = {
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

  nameTagOptions?: Partial<NameTagOptions>;

  /**
   * Parameters to create the character's head.
   */
  head?: Partial<HeadOptions>;

  /**
   * Parameters to create the character's body.
   */
  body?: Partial<BodyOptions>;

  /**
   * Parameters to create the character's legs.
   */
  legs?: Partial<LegOptions>;

  /**
   * Parameters to create the character's arms.
   */
  arms?: Partial<ArmsOptions>;
};

export const defaultCharacterOptions: CharacterOptions = {
  swingLerp: 0.8,
  walkingSpeed: 1.4,
  positionLerp: 0.7,
  rotationLerp: 0.2,
  idleArmSwing: 0.06,
};

export const defaultHeadOptions: HeadOptions = {
  color: "#96baff",
  faceColor: "#f99999",
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: DoubleSide,
  width: 0.5 * CHARACTER_SCALE,
  widthSegments: 16,
  height: 0.25 * CHARACTER_SCALE,
  heightSegments: 8,
  depth: 0.5 * CHARACTER_SCALE,
  depthSegments: 16,
  neckGap: 0.05 * CHARACTER_SCALE,
};

export const defaultBodyOptions: BodyOptions = {
  color: "#2b2e42",
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: DoubleSide,
  width: 1 * CHARACTER_SCALE,
  widthSegments: 16,
};

export const defaultArmsOptions: ArmsOptions = {
  color: "#548ca8",
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: DoubleSide,
  width: 0.25 * CHARACTER_SCALE,
  height: 0.5 * CHARACTER_SCALE,
  depth: 0.25 * CHARACTER_SCALE,
  widthSegments: 8,
  heightSegments: 16,
  depthSegments: 8,
  shoulderGap: 0.05 * CHARACTER_SCALE,
  shoulderDrop: 0.25 * CHARACTER_SCALE,
};

export const defaultLegsOptions: LegOptions = {
  color: "#96baff",
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: DoubleSide,
  width: 0.25 * CHARACTER_SCALE,
  height: 0.25 * CHARACTER_SCALE,
  depth: 0.25 * CHARACTER_SCALE,
  widthSegments: 3,
  heightSegments: 3,
  depthSegments: 3,
  betweenLegsGap: 0.2 * CHARACTER_SCALE,
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
 *
 * // Set the nametag content.
 * character.username = "<placeholder>";
 *
 * // Load a texture to paint on the face.
 * world.loader.addTexture(FunnyImageSrc, (texture) => {
 *   character.head.paint("front", texture);
 * })
 *
 * // Attach the character to a rigid controls.
 * controls.attachCharacter(character);
 * ```
 *
 * ![Character](/img/docs/character.png)
 *
 * @noInheritDoc
 */
export class Character extends Group {
  /**
   * Parameters to create a Voxelize character.
   */
  public options: CharacterOptions;

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
   * faster depending on the passed-in options.
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
   * Somewhere to store whatever you want.
   */
  public extraData: any = null;

  /**
   * Whether the character is in a sitting pose.
   */
  private _isSitting = false;

  /**
   * A listener called when a character starts moving.
   */
  onMove: () => void;

  /**
   * A listener called when a character stops moving.
   */
  onIdle: () => void;

  private mixer: AnimationMixer;

  private armSwingClip: AnimationClip;

  private armSwingAnimation: AnimationAction;

  /**
   * An internal clock instance for calculating delta time.
   */
  private clock = new Clock();

  /**
   * Create a new Voxelize character.
   *
   * @param options Parameters to create a Voxelize character.
   */
  constructor(options: Partial<CharacterOptions> = {}) {
    super();

    this.options = {
      ...defaultCharacterOptions,
      ...options,
      head: {
        ...defaultHeadOptions,
        ...(options.head || {}),
        depth:
          options.head?.depth ||
          options.head?.width ||
          defaultHeadOptions.width,
        height:
          options.head?.height ||
          defaultHeadOptions.height ||
          defaultHeadOptions.width,
      },
      body: {
        ...defaultBodyOptions,
        ...(options.body || {}),
        depth:
          options.body?.depth ||
          defaultBodyOptions.depth ||
          defaultBodyOptions.width,
        height:
          options.body?.height ||
          defaultBodyOptions.height ||
          defaultBodyOptions.width,
      },
      arms: {
        ...defaultArmsOptions,
        ...(options.arms || {}),
        depth: options.arms?.depth || defaultArmsOptions.width,
        height: options.arms?.height || defaultArmsOptions.height,
      },
      legs: {
        ...defaultLegsOptions,
        ...(options.legs || {}),
        depth: options.legs?.depth || defaultLegsOptions.width,
        height: options.legs?.height || defaultLegsOptions.height,
      },
    };

    this.createModel();

    const position = this.rightArmGroup.position;
    const quaternion = this.rightArmGroup.quaternion;

    this.armSwingClip = AnimationUtils.generateClip(
      "characterArmSwing",
      SWING_TIMES,
      position,
      quaternion,
      [position, position, position, position],
      SWING_QUATERNIONS
    );

    this.mixer = new AnimationMixer(this.rightArmGroup);
    this.armSwingAnimation = this.mixer.clipAction(this.armSwingClip);
    this.armSwingAnimation.setLoop(LoopOnce, 1);
    this.armSwingAnimation.clampWhenFinished = true;
  }

  /**
   * Update the character's animation and rotation. After `set` is called, `update` must be called to
   * actually lerp to the new position and rotation. Note that when a character is attached to a control,
   * `update` is called automatically within the control's update loop.
   */
  update() {
    // Normalize the delta
    const delta = Math.min(0.1, this.clock.getDelta());

    this.mixer.update(delta);
    this.calculateDelta();
    this.playArmsWalkingAnimation();
    this.playLegsWalkingAnimation();
    this.lerpAll();
  }

  /**
   * Set the character's position and direction that its body is situated at and the head is looking
   * at. This uses `MathUtils.directionToQuaternion` to slerp the head's rotation to the new direction.
   *
   * The `update` needs to be called to actually lerp to the new position and rotation.
   *
   * @param position The new position of the character.
   * @param direction The new direction of the character.
   */
  set(position: number[], direction: number[]) {
    if (!position || !direction) return;

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
  }

  /**
   * Change the content of the user's nametag. If the nametag is empty, nothing will be rendered.
   */
  set username(username: string) {
    if (!this.nametag) {
      this.nametag = new NameTag(username, {
        yOffset: this.head.height / 2 + 0.2,
        fontSize: 0.2,
        ...(this.options.nameTagOptions ?? {}),
      });
      this.add(this.nametag);
    }

    if (!username) {
      this.nametag.visible = false;
      return;
    }

    this.nametag.text = username;
  }

  /**
   * Get the content of the nametag of the character.
   */
  get username() {
    return this.nametag ? this.nametag.text : "";
  }

  /**
   * Get the height at which the eye of the character is situated at.
   */
  get eyeHeight() {
    return (
      this.options.legs.height +
      this.options.body.height +
      this.options.head.neckGap +
      this.options.head.height / 2
    );
  }

  /**
   * Get the total height of the character, in other words, the sum of the heights of
   * the head, body, and legs.
   */
  get totalHeight() {
    return (
      this.options.legs.height +
      this.options.body.height +
      this.options.head.neckGap +
      this.options.head.height
    );
  }

  set bodyColor(color: string | Color) {
    this.body.paint("all", new Color(color));
    this.options.body.color = color;
  }

  get bodyColor(): string | Color {
    return this.options.body.color;
  }

  set armColor(color: string | Color) {
    this.leftArm.paint("all", new Color(color));
    this.rightArm.paint("all", new Color(color));
    this.options.arms.color = color;
  }

  get armColor(): string | Color {
    return this.options.arms.color;
  }

  set legColor(color: string | Color) {
    this.leftLeg.paint("all", new Color(color));
    this.rightLeg.paint("all", new Color(color));
    this.options.legs.color = color;
  }

  get legColor(): string | Color {
    return this.options.legs.color;
  }

  set headColor(color: string | Color) {
    this.head.paint("all", new Color(color));
    this.options.head.color = color;
  }

  get headColor(): string | Color {
    return this.options.head.color;
  }

  set faceColor(color: string | Color) {
    this.head.paint("front", new Color(color));
    this.options.head.faceColor = color;
  }

  get faceColor(): string | Color {
    return this.options.head.faceColor;
  }

  get isSitting() {
    return this._isSitting;
  }

  setSitting(sitting: boolean) {
    this._isSitting = sitting;
    if (sitting) {
      this.leftLegGroup.rotation.x = Math.PI / 2.2;
      this.rightLegGroup.rotation.x = Math.PI / 2.2;
      this.leftArmGroup.rotation.x = Math.PI / 8;
      this.rightArmGroup.rotation.x = Math.PI / 8;
    } else {
      this.leftLegGroup.rotation.x = 0;
      this.rightLegGroup.rotation.x = 0;
      this.leftArmGroup.rotation.x = 0;
      this.rightArmGroup.rotation.x = 0;
    }
  }

  /**
   * Create the character's model programmatically.
   */
  private createModel = () => {
    const head = new CanvasBox({
      ...defaultHeadOptions,
      ...(this.options.head ? this.options.head : {}),
    });

    const body = new CanvasBox({
      ...defaultBodyOptions,
      ...(this.options.body ? this.options.body : {}),
    });

    const leftArm = new CanvasBox({
      ...defaultArmsOptions,
      ...(this.options.arms ? this.options.arms : {}),
    });

    const rightArm = new CanvasBox({
      ...defaultArmsOptions,
      ...(this.options.arms ? this.options.arms : {}),
    });

    const leftLeg = new CanvasBox({
      ...defaultLegsOptions,
      ...(this.options.legs ? this.options.legs : {}),
    });

    const rightLeg = new CanvasBox({
      ...defaultLegsOptions,
      ...(this.options.legs ? this.options.legs : {}),
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

    if (this.options.head && this.options.head.neckGap) {
      this.headGroup.position.y += this.options.head.neckGap;
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

    if (this.options.arms) {
      if (this.options.arms.shoulderDrop) {
        this.leftArmGroup.position.y -= this.options.arms.shoulderDrop;
        this.rightArmGroup.position.y -= this.options.arms.shoulderDrop;
      }

      if (this.options.arms.shoulderGap) {
        this.leftArmGroup.position.x -= this.options.arms.shoulderGap;
        this.rightArmGroup.position.x += this.options.arms.shoulderGap;
      }
    }

    this.leftLegGroup.add(leftLeg);
    leftLeg.position.y -= leftLeg.height / 2;
    leftLeg.position.x -= leftLeg.width / 2;

    this.rightLegGroup.add(rightLeg);
    rightLeg.position.y -= rightLeg.height / 2;
    rightLeg.position.x += rightLeg.width / 2;

    if (this.options.legs && this.options.legs.betweenLegsGap) {
      this.leftLegGroup.position.x -= this.options.legs.betweenLegsGap / 2;
      this.rightLegGroup.position.x += this.options.legs.betweenLegsGap / 2;
    }

    head.paint("all", new Color(this.options.head.color));
    head.paint("front", new Color(this.options.head.faceColor));
    body.paint("all", new Color(this.options.body.color));
    leftArm.paint("all", new Color(this.options.arms.color));
    rightArm.paint("all", new Color(this.options.arms.color));
    leftLeg.paint("all", new Color(this.options.legs.color));
    rightLeg.paint("all", new Color(this.options.legs.color));

    this.add(this.headGroup, this.bodyGroup);

    this.bodyGroup.add(
      this.leftArmGroup,
      this.rightArmGroup,
      this.leftLegGroup,
      this.rightLegGroup
    );

    // this.headGroup.position.y -= this.totalHeight / 2;
    // this.bodyGroup.position.y -= this.totalHeight / 2;

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
      this.speed = this.options.walkingSpeed;
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
      this.position.lerp(this.newPosition, this.options.positionLerp);
    }

    // Head rotates immediately.
    if (this.newDirection.length() !== 0) {
      this.headGroup.rotation.setFromQuaternion(this.newDirection);
    }

    if (this.newBodyDirection.length() !== 0) {
      this.bodyGroup.quaternion.slerp(
        this.newBodyDirection,
        this.options.rotationLerp
      );
    }
  };

  /**
   * Play the walking animation for the character, in other words the arm movements.
   */
  private playArmsWalkingAnimation = () => {
    if (this._isSitting) return;

    const scale = 100;
    const speed = Math.max(this.speed, this.options.idleArmSwing);
    const amplitude = speed * 1;

    this.leftArmGroup.rotation.x = MathUtils.lerp(
      this.leftArmGroup.rotation.x,
      Math.sin((performance.now() * speed) / scale) * amplitude,
      this.options.swingLerp
    );
    this.leftArmGroup.rotation.z = MathUtils.lerp(
      this.leftArmGroup.rotation.z,
      Math.cos((performance.now() * speed) / scale) ** 2 * amplitude * 0.1,
      this.options.swingLerp
    );

    if (this.armSwingAnimation.isRunning()) return;

    this.rightArmGroup.rotation.x = MathUtils.lerp(
      this.rightArmGroup.rotation.x,
      Math.sin((performance.now() * speed) / scale + Math.PI) * amplitude,
      this.options.swingLerp
    );
    this.rightArmGroup.rotation.z = MathUtils.lerp(
      this.rightArmGroup.rotation.z,
      -(Math.sin((performance.now() * speed) / scale) ** 2 * amplitude * 0.1),
      this.options.swingLerp
    );
  };

  /**
   * Play the walking animation for the character, in other words the leg movements.
   */
  private playLegsWalkingAnimation = () => {
    if (this._isSitting) return;

    const scale = 100;
    const speed = Math.max(this.speed, this.options.idleArmSwing);
    const amplitude = speed * 1;

    this.leftLegGroup.rotation.x = MathUtils.lerp(
      this.leftLegGroup.rotation.x,
      -Math.sin((performance.now() * speed) / scale) * amplitude,
      this.options.swingLerp
    );
    this.rightLegGroup.rotation.x = MathUtils.lerp(
      this.rightLegGroup.rotation.x,
      Math.sin((performance.now() * speed) / scale) * amplitude,
      this.options.swingLerp
    );
  };

  /**
   * Play the "swing" animation.
   */
  public playArmSwingAnimation = () => {
    if (this.armSwingAnimation) {
      this.armSwingAnimation.reset();
      this.armSwingAnimation.play();
    }
  };

  /**
   * Set the character's arm holding object.
   *
   * @param object The object to set as the arm holding object.
   */
  public setArmHoldingObject = (
    object: Object3D | undefined,
    side: "left" | "right" = "right"
  ) => {
    const objectName = "armObject";

    let armGroup = this.rightArmGroup;
    if (side === "left") {
      armGroup = this.leftArmGroup;
    }

    const existingObject = armGroup.getObjectByName(objectName);
    if (existingObject) {
      armGroup.remove(existingObject);
    }

    if (object) {
      object.name = objectName;

      // Position object at the "hand" of the arm.
      object.position.add(
        new Vector3(
          (this.options.arms.width * (side === "left" ? -1 : 1)) / 2,
          -this.options.arms.height,
          0
        )
      );

      armGroup.add(object);
    }
  };
}
