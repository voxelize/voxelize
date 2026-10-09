import * as THREE from "three";

import { Inputs } from "../core/inputs";
import {
  createEntityShadowUniforms,
  ENTITY_SHADOW_FRAGMENT_PARS,
  ENTITY_SHADOW_VERTEX_MAIN,
  ENTITY_SHADOW_VERTEX_PARS,
  EntityShadowUniforms,
  ShaderLightingUniforms,
  updateEntityShadowUniforms,
} from "../core/world/entity-shadow-uniforms";
import { AnimationUtils } from "../utils";

import { CanvasBox } from "./canvas-box";
import { defaultArmsOptions } from "./character";
import { isSelfIlluminated } from "./effects/light-shined";

const ARM_POSITION = new THREE.Vector3(1, -1, -1);
const ARM_QUATERION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 4, 0, -Math.PI / 8),
);
const BLOCK_POSITION = new THREE.Vector3(1.4, -1.4, -2.061);
const BLOCK_QUATERNION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  -Math.PI / 4,
);
const ARM_TRANSITION_DURATION = 0.2; // Duration in seconds for arm transition animation

const SWING_TIMES = [0, 0.05, 0.1, 0.15, 0.2, 0.3];

const SWING_POSITIONS_DELTA = [
  new THREE.Vector3(-0.34, 0.23, 0),
  new THREE.Vector3(0, -0.25, 0),
  new THREE.Vector3(0, -0.68, 0),
  new THREE.Vector3(0, -0.3, 0),
];

const generateSwingPositions = (initialPosition: THREE.Vector3) => {
  const positions = [];
  for (let i = 0; i < SWING_POSITIONS_DELTA.length; i++) {
    const nextPosition = (
      i === 0 ? initialPosition.clone() : positions[i - 1].clone()
    ).add(SWING_POSITIONS_DELTA[i]);
    positions.push(nextPosition);
  }
  return positions;
};

const ARM_SWING_POSITIONS = generateSwingPositions(ARM_POSITION);

const BLOCK_SWING_POSITIONS = generateSwingPositions(BLOCK_POSITION);

const SWING_QUATERNIONS = [
  new THREE.Quaternion(-0.41, -0.0746578340503426, 0.21, 0.9061274463528878),
  new THREE.Quaternion(-0.41, -0.0746578340503426, 0.52, 0.9061274463528878),
  new THREE.Quaternion(-0.41, -0.0746578340503426, 0.75, 0.9061274463528878),
  new THREE.Quaternion(
    -0.37533027751786524,
    -0.0746578340503426,
    -0.18023995550173696,
    0.9061274463528878,
  ),
];

export type ArmOptions = {
  armObject?: THREE.Object3D;
  armObjectOptions: ArmObjectOptions;
  blockObjectOptions?: ArmObjectOptions;
  armColor?: string | THREE.Color;
  armTexture?: THREE.Texture;
  customObjectOptions?: Record<string, ArmObjectOptions>;
  receiveShadows?: boolean;
  receiveHeldObjectShadows?: boolean;
  minOccluderDepth?: number;
  /**
   * How far the viewmodel reaches into the world, as a share of the
   * distance it is drawn at: placed with {@link Arm.updateShadowUniforms},
   * its shadows are looked up at that scale about the eye, so a block drawn
   * two blocks down the screen is shaded where a hand would hold it.
   */
  shadowReach?: number;
};

/**
 * A slow breathing sway the held object makes while it is at rest: neither
 * swinging nor being swapped. It is laid on top of the rest pose each frame
 * and taken off again before the next, so it never accumulates, and it
 * keeps real time, so every frame rate sees the same sway.
 */
export type ArmIdleSway = {
  /** The point it sways about, in the arm's frame: where it is held. */
  pivot: THREE.Vector3;
  /** Seconds per breath. */
  breathSeconds: number;
  /** How far it rises at the top of a breath. */
  breathLift: number;
  /** How far it tips back toward the eye at the top of a breath, radians. */
  breathTilt: number;
  /**
   * Seconds per drift from one side to the other and back. Not a multiple
   * of a breath, so the two never settle into one short loop.
   */
  driftSeconds: number;
  /** How far it drifts to either side. */
  driftReach: number;
  /** How far it rolls into the drift, radians. */
  driftRoll: number;
  /** Seconds it takes to come in once the object is at rest. */
  fadeInSeconds: number;
  /** Seconds it takes to leave when a swing starts. */
  fadeOutSeconds: number;
};

export type ArmObjectOptions = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  swingPositions?: THREE.Vector3[];
  swingQuaternions?: THREE.Quaternion[];
  swingTimes?: number[];
  /**
   * How far through a swing (0 to 1) it has to be before another swing
   * request restarts it. Earlier requests are dropped, and not sent to
   * peers, so a strike that has started always lands. 0, the default,
   * restarts on every request.
   */
  swingRestartAfter?: number;
  /**
   * Seconds a restarted swing takes to ease out of the pose it interrupted
   * instead of snapping to its first key. 0, the default, snaps.
   */
  swingRestartBlend?: number;
  /** A breathing sway while the object is at rest. None by default. */
  idleSway?: ArmIdleSway;
  /**
   * The field of view, in degrees, the object is posed for. While it is
   * held, the arm keeps it the size and place on screen it has at that
   * field of view, whatever {@link Arm.viewCamera} is drawn at, so a pose
   * tuned once holds when a player widens or narrows the view. Unset, the
   * object follows the camera's field of view like the world does.
   */
  fixedFov?: number;
};

const defaultOptions: ArmOptions = {
  armObject: undefined,
  armObjectOptions: {
    position: ARM_POSITION,
    quaternion: ARM_QUATERION,
    swingPositions: ARM_SWING_POSITIONS,
    swingQuaternions: SWING_QUATERNIONS,
    swingTimes: SWING_TIMES,
  },
  blockObjectOptions: {
    position: BLOCK_POSITION,
    quaternion: BLOCK_QUATERNION,
    swingPositions: BLOCK_SWING_POSITIONS,
    swingQuaternions: SWING_QUATERNIONS,
    swingTimes: SWING_TIMES,
  },
  armColor: defaultArmsOptions.color,
  shadowReach: 0.35,
};

const shadowReachScale = new THREE.Matrix4();
const swayEuler = new THREE.Euler();
const swayInverse = new THREE.Quaternion();
const swingPose = new THREE.Quaternion();

export class Arm extends THREE.Group {
  public options: ArmOptions;

  private mixer: THREE.AnimationMixer;

  private armSwingClip: THREE.AnimationClip;

  private blockSwingClip: THREE.AnimationClip;

  private swingAnimation: THREE.AnimationAction;

  private customSwingClips: Record<string, THREE.AnimationClip>;

  /**
   * An internal clock instance for calculating delta time.
   */
  private timer = new THREE.Timer();

  // Animation properties for the arm transition
  private isTransitioning = false;
  private transitionStartTime = 0;
  private transitionDuration = ARM_TRANSITION_DURATION;
  private transitionDirection = 0; // 0: down, 1: up
  private pendingArmObject: THREE.Object3D | undefined;
  private pendingCustomType: string | undefined;
  private initialArmY = 0;
  private targetArmY = 0;
  private currentArmObject: THREE.Object3D | null = null;

  /** The options of what the arm holds now: its rest, swing and sway. */
  private currentObjectOptions: ArmObjectOptions | undefined;

  // A swing restarted part way eases out of the pose it interrupted.
  private readonly restartFromPosition = new THREE.Vector3();
  private readonly restartFromQuaternion = new THREE.Quaternion();
  private restartBlendLeft = 0;
  private restartBlendSeconds = 0;

  /** Whether {@link holdSwingAt} has the swing pinned at one moment. */
  private isSwingHeld = false;

  // The idle sway laid on the held object this frame, taken off before the
  // next one is laid.
  private swayClock = 0;
  private swayWeight = 0;
  private swayedObject: THREE.Object3D | null = null;
  private readonly swayTurn = new THREE.Quaternion();
  private readonly swayShift = new THREE.Vector3();
  private readonly swayPivot = new THREE.Vector3();

  /** One block every held object's shadowed material reads. */
  private heldObjectShadowUniforms: EntityShadowUniforms =
    createEntityShadowUniforms();

  /**
   * The arm's own copy of each material a held object arrives with, set up
   * once. A held object usually shares its materials with every other copy
   * of the same thing (an item's cached mesh is cloned into each hand with
   * one material), so the arm never sets up a material it is handed.
   */
  private heldMaterials = new WeakMap<THREE.Material, THREE.Material>();
  private ownHeldMaterials = new WeakSet<THREE.Material>();

  private shadowSelfBounds: THREE.Vector4 | null = null;
  private readonly noShadowSelfBounds = new THREE.Vector4();
  private readonly shadowWorldMatrix = new THREE.Matrix4();

  public heldLightColor = new THREE.Color(1, 1, 1);

  /**
   * The camera the arm's scene is drawn with, which an object posed for a
   * {@link ArmObjectOptions.fixedFov} is held against.
   */
  public viewCamera: THREE.PerspectiveCamera | null = null;

  /**
   * Whether a left click plays the default arm swing. Consumers that own the
   * left click and drive their own held-object animation (e.g. a gun with its
   * own recoil) can disable this so the melee swing does not fight and rotate
   * their viewmodel. Explicit {@link doSwing} calls are unaffected.
   */
  public isClickSwingEnabled = true;

  emitSwingEvent: () => void;

  constructor(options: Partial<ArmOptions> = {}) {
    super();

    this.options = {
      ...defaultOptions,
      ...options,
    };

    this.armSwingClip = AnimationUtils.generateClip(
      "armSwing",
      this.options.armObjectOptions?.swingTimes,
      this.options.armObjectOptions?.position,
      this.options.armObjectOptions?.quaternion,
      this.options.armObjectOptions?.swingPositions,
      this.options.armObjectOptions?.swingQuaternions,
    );
    this.blockSwingClip = AnimationUtils.generateClip(
      "blockSwing",
      this.options.blockObjectOptions?.swingTimes,
      this.options.blockObjectOptions?.position,
      this.options.blockObjectOptions?.quaternion,
      this.options.blockObjectOptions?.swingPositions,
      this.options.blockObjectOptions?.swingQuaternions,
    );

    this.customSwingClips = {};
    for (const [type, options] of Object.entries(
      this.options.customObjectOptions || {},
    )) {
      this.customSwingClips[type] = AnimationUtils.generateClip(
        `customSwing-${type}`,
        options.swingTimes ?? SWING_TIMES,
        options.position,
        options.quaternion,
        options.swingPositions ?? generateSwingPositions(options.position),
        options.swingQuaternions ?? SWING_QUATERNIONS,
      );
    }

    if (this.shouldReceiveArmShadows()) {
      this.userData.receiveShadows = true;
    }

    this.setArm();
  }

  /**
   * Copy the frame's lighting into the arm's and the held object's shadows.
   *
   * @param viewToWorld Where the viewmodel's scene sits in the world: the eye
   * camera's world matrix times the viewmodel camera's inverse. The
   * viewmodel is then shaded where it would be held, at
   * {@link ArmOptions.shadowReach} of the distance it is drawn at, and
   * nothing inside the body it belongs to ({@link setShadowSelfBounds})
   * shades any of its faces. A vector instead offsets the viewmodel's own,
   * unrotated frame into the world.
   */
  updateShadowUniforms(
    lightingUniforms: ShaderLightingUniforms,
    viewToWorld?: THREE.Matrix4 | THREE.Vector3,
  ): void {
    const receiveArmShadows = this.shouldReceiveArmShadows();
    const receiveHeldObjectShadows = this.shouldReceiveHeldObjectShadows();
    if (!receiveArmShadows && !receiveHeldObjectShadows) return;

    const minDepth = this.options.minOccluderDepth ?? 0.0;
    const isPlaced = viewToWorld instanceof THREE.Matrix4;
    if (isPlaced) {
      const reach = this.options.shadowReach ?? 1;
      this.shadowWorldMatrix
        .copy(viewToWorld)
        .multiply(shadowReachScale.makeScale(reach, reach, reach));
    }

    const apply = (uniforms: EntityShadowUniforms) => {
      updateEntityShadowUniforms(uniforms, lightingUniforms);
      uniforms.uMinOccluderDepth.value = minDepth;
      uniforms.uShadowSelfBounds.value =
        this.shadowSelfBounds ?? this.noShadowSelfBounds;
      uniforms.uShadowIgnoresSelf.value = isPlaced ? 1 : 0;
      if (isPlaced) {
        uniforms.uShadowWorldMatrix.value.copy(this.shadowWorldMatrix);
        uniforms.uWorldOffset.value.set(0, 0, 0);
      } else {
        uniforms.uShadowWorldMatrix.value.identity();
        if (viewToWorld) uniforms.uWorldOffset.value.copy(viewToWorld);
      }
    };

    if (receiveArmShadows) {
      this.traverse((child) => {
        if (child instanceof CanvasBox && child.shadowUniforms) {
          apply(child.shadowUniforms);
        }
      });
    }

    if (receiveHeldObjectShadows) {
      apply(this.heldObjectShadowUniforms);
    }
  }

  /**
   * The body the viewmodel belongs to, as its world-space bounding sphere
   * (`Character.shadowSelfBounds`), shared by reference so the body keeps it
   * current. With a placed viewmodel nothing inside it shades the arm or
   * the held object, which lets the body cast its own shadow from just
   * behind the eye. `null` for none.
   */
  setShadowSelfBounds(bounds: THREE.Vector4 | null) {
    this.shadowSelfBounds = bounds;
  }

  /**
   * Connect the arm to the given input manager. This will allow the arm to listen to left
   * and right clicks to play arm animations. This function returns a function that when called
   * unbinds the arm's keyboard inputs.
   *
   * @param inputs The {@link Inputs} instance to bind the arm's keyboard inputs to.
   * @param namespace The namespace to bind the arm's keyboard inputs to.
   */
  public connect = (inputs: Inputs, namespace = "*") => {
    const unbindLeftClick = inputs.click(
      "left",
      () => {
        if (!this.isClickSwingEnabled) return;
        this.doSwing();
      },
      namespace,
    );

    return () => {
      try {
        unbindLeftClick();
      } catch (e) {
        // Ignore.
      }
    };
  };

  /**
   * Set a new object for the arm. If `animate` is true, the transition will be animated.
   *
   * @param object New object for the arm
   * @param animate Whether to animate the transition
   */
  public setArmObject = (
    object: THREE.Object3D | undefined,
    animate: boolean,
    customType?: string,
  ) => {
    // The outgoing object leaves from its plain rest pose, and whatever
    // comes in starts its own sway once it is up.
    this.holdSwingAt(null);
    this.liftIdleSway();
    this.swayWeight = 0;
    this.swayClock = 0;
    this.restartBlendLeft = 0;

    if (!animate) {
      this.clear();

      if (customType) {
        this.setCustomObject(customType, object);
      } else if (!object) {
        this.setArm();
      } else {
        this.setBlock(object);
      }
    } else {
      this.pendingArmObject = object;
      this.pendingCustomType = customType;

      if (!this.isTransitioning) {
        this.isTransitioning = true;
        this.transitionStartTime = this.timer.getElapsed();
        this.transitionDirection = 0;

        if (this.children.length > 0) {
          this.currentArmObject = this.children[0] as THREE.Object3D;
          this.initialArmY = this.currentArmObject.position.y;
          this.targetArmY = this.initialArmY - 5;
        }
      } else if (this.transitionDirection === 1) {
        this.transitionDirection = 0;
        this.transitionStartTime = this.timer.getElapsed();

        if (this.currentArmObject) {
          this.initialArmY = this.currentArmObject.position.y;
          this.targetArmY = this.initialArmY - 5;
        }
      }
    }
  };

  private setArm = () => {
    const arm = new CanvasBox({
      width: 0.5,
      height: 1,
      depth: 0.3,
      receiveShadows: this.shouldReceiveArmShadows(),
    });

    if (this.options.armTexture) {
      const texture = this.options.armTexture;
      if (texture.image && (texture.image as HTMLImageElement).complete) {
        arm.paint("all", texture);
      } else {
        arm.paint("all", new THREE.Color(this.options.armColor));
        if (texture.image) {
          (texture.image as HTMLImageElement).onload = () => {
            arm.paint("all", texture);
          };
        }
      }
    } else {
      arm.paint("all", new THREE.Color(this.options.armColor));
    }

    arm.position.set(
      this.options.armObjectOptions?.position.x,
      this.options.armObjectOptions?.position.y,
      this.options.armObjectOptions?.position.z,
    );
    arm.quaternion.multiply(this.options.armObjectOptions?.quaternion);

    this.currentObjectOptions = this.options.armObjectOptions;
    this.mixer = new THREE.AnimationMixer(arm);
    this.swingAnimation = this.mixer.clipAction(this.armSwingClip);
    this.swingAnimation.setLoop(THREE.LoopOnce, 1);
    this.swingAnimation.clampWhenFinished = true;

    this.add(arm);
    this.currentArmObject = arm;
  };

  private setBlock = (object: THREE.Object3D) => {
    object.position.set(
      this.options.blockObjectOptions?.position.x,
      this.options.blockObjectOptions?.position.y,
      this.options.blockObjectOptions?.position.z,
    );
    object.quaternion.multiply(this.options.blockObjectOptions?.quaternion);

    this.adoptHeldMaterials(object);

    this.currentObjectOptions = this.options.blockObjectOptions;
    this.mixer = new THREE.AnimationMixer(object);
    this.swingAnimation = this.mixer.clipAction(this.blockSwingClip);
    this.swingAnimation.setLoop(THREE.LoopOnce, 1);
    this.swingAnimation.clampWhenFinished = true;

    this.add(object);
    this.currentArmObject = object;
  };

  private setCustomObject = (type: string, object: THREE.Object3D) => {
    const options = this.options.customObjectOptions?.[type];
    if (!options) {
      throw new Error(`No options found for custom object type: ${type}`);
    }

    object.position.set(
      options.position.x,
      options.position.y,
      options.position.z,
    );
    object.quaternion.multiply(options.quaternion);

    this.adoptHeldMaterials(object);

    this.currentObjectOptions = options;
    this.mixer = new THREE.AnimationMixer(object);
    this.swingAnimation = this.mixer.clipAction(this.customSwingClips[type]);
    this.swingAnimation.setLoop(THREE.LoopOnce, 1);
    this.swingAnimation.clampWhenFinished = true;

    this.add(object);
    this.currentArmObject = object;
  };

  /** Point every mesh of a held object at the arm's own copy of its material. */
  private adoptHeldMaterials(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!("isMesh" in child) || !(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(this.heldMaterialFor)
        : this.heldMaterialFor(mesh.material);
    });
  }

  private heldMaterialFor = (material: THREE.Material): THREE.Material => {
    if (material.type !== "MeshBasicMaterial") return material;
    if (isSelfIlluminated(material)) return material;
    if (this.ownHeldMaterials.has(material)) return material;
    const cached = this.heldMaterials.get(material);
    if (cached) return cached;

    // A clone copies flags but not compile hooks, so it must not pass as
    // set up; a hook the source was built with comes along, an effect's
    // wrapper does not.
    const own = material.clone();
    const isSetUpElsewhere =
      material.userData.heldObjectLighting === true ||
      material.userData.lightEffectSetup === true;
    delete own.userData.heldObjectLighting;
    delete own.userData.lightEffectSetup;
    if (
      !isSetUpElsewhere &&
      Object.prototype.hasOwnProperty.call(material, "onBeforeCompile")
    ) {
      own.onBeforeCompile = material.onBeforeCompile;
    }
    if (this.shouldReceiveHeldObjectShadows()) this.setUpHeldShadow(own);
    else this.setUpHeldLighting(own);

    this.heldMaterials.set(material, own);
    this.ownHeldMaterials.add(own);
    material.addEventListener("dispose", () => {
      this.heldMaterials.delete(material);
      own.dispose();
    });
    return own;
  };

  /** The program key for a held material, kept apart per hook it wraps. */
  private heldProgramKey(material: THREE.Material, name: string): string {
    return Object.prototype.hasOwnProperty.call(material, "onBeforeCompile")
      ? `${name}|${material.onBeforeCompile.toString()}`
      : name;
  }

  private setUpHeldLighting(material: THREE.Material): void {
    material.userData.heldObjectLighting = true;
    material.userData.lightEffectSetup = true;

    const key = this.heldProgramKey(material, "held-object-lighting-shader");
    const lightColorRef = this.heldLightColor;
    const oldOnBeforeCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (oldOnBeforeCompile) {
        oldOnBeforeCompile(shader, renderer);
      }

      shader.uniforms.uLightColor = { value: lightColorRef };

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform vec3 uLightColor;
`,
        )
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
gl_FragColor.rgb *= uLightColor;
`,
        );
    };

    material.onBeforeCompile.toString = () => key;
    material.needsUpdate = true;
  }

  private setUpHeldShadow(material: THREE.Material): void {
    const shadowUniforms = this.heldObjectShadowUniforms;
    material.userData.heldObjectLighting = true;
    material.userData.lightEffectSetup = true;

    const key = this.heldProgramKey(material, "held-object-shadow-shader");
    const lightColorRef = this.heldLightColor;
    const oldOnBeforeCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (oldOnBeforeCompile) {
        oldOnBeforeCompile(shader, renderer);
      }

      Object.assign(shader.uniforms, shadowUniforms);
      shader.uniforms.uLightColor = { value: lightColorRef };

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <uv_pars_vertex>",
          `#include <uv_pars_vertex>
${ENTITY_SHADOW_VERTEX_PARS}
varying vec3 vHeldShadowNormal;
varying vec3 vHeldShadowPosition;
`,
        )
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
${ENTITY_SHADOW_VERTEX_MAIN}
// Item shapes carry no normals, and a zero vector does not normalize.
vec3 heldShadowNormal = mat3(uShadowWorldMatrix) * mat3(modelMatrix) * normal;
vHeldShadowNormal = dot(heldShadowNormal, heldShadowNormal) > 0.0
  ? normalize(heldShadowNormal)
  : vec3(0.0, 1.0, 0.0);
vHeldShadowPosition = shadowWorldPos.xyz;
`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
${ENTITY_SHADOW_FRAGMENT_PARS}
uniform vec3 uLightColor;
varying vec3 vHeldShadowNormal;
varying vec3 vHeldShadowPosition;
`,
        )
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
float shadow = getEntityShadowAt(
  normalize(vHeldShadowNormal),
  vHeldShadowPosition
);
gl_FragColor.rgb *= shadow * uLightColor;
`,
        );
    };

    material.onBeforeCompile.toString = () => key;
    material.needsUpdate = true;
  }

  private shouldReceiveArmShadows(): boolean {
    return this.options.receiveShadows === true;
  }

  private shouldReceiveHeldObjectShadows(): boolean {
    return (
      this.options.receiveHeldObjectShadows ?? this.shouldReceiveArmShadows()
    );
  }

  /**
   *
   * Update the arm's animation. Note that when a arm is attached to a control,
   * `update` is called automatically within the control's update loop.
   */
  public update() {
    // Normalize the delta
    this.timer.update();
    const delta = Math.min(0.1, this.timer.getDelta());

    this.liftIdleSway();
    this.mixer.update(delta);
    this.easeSwingRestart(delta);

    // Handle arm object transition animation if active
    if (this.isTransitioning) {
      const elapsed = this.timer.getElapsed() - this.transitionStartTime;
      const progress = Math.min(elapsed / this.transitionDuration, 1);

      // Use more subtle easing functions
      // easeOutCubic for smooth movement without extreme overshooting
      const easeOutCubic = (x: number): number => {
        return 1 - Math.pow(1 - x, 3);
      };

      // easeInOutQuad for gentle acceleration and deceleration
      const easeInOutQuad = (x: number): number => {
        return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
      };

      if (this.transitionDirection === 0) {
        // Moving down phase - use easeOutCubic for smooth exit
        if (this.currentArmObject) {
          const easedProgress = easeOutCubic(progress);
          const newY = THREE.MathUtils.lerp(
            this.initialArmY,
            this.targetArmY,
            easedProgress,
          );
          this.currentArmObject.position.y = newY;
        }

        // When reaching the bottom, switch to the new object
        if (progress >= 1) {
          this.clear();

          // Set up the new object
          if (this.pendingCustomType) {
            this.setCustomObject(this.pendingCustomType, this.pendingArmObject);
          } else if (!this.pendingArmObject) {
            this.setArm();
          } else {
            this.setBlock(this.pendingArmObject);
          }

          // Start with the new object below the view and animate up
          if (this.children.length > 0) {
            this.currentArmObject = this.children[0] as THREE.Object3D;

            // Store the final target position (original position)
            this.targetArmY = this.currentArmObject.position.y;

            // Move the object down first (to start animation from below)
            this.currentArmObject.position.y -= 5;
            this.initialArmY = this.currentArmObject.position.y;
          }

          // Start the up animation
          this.transitionDirection = 1;
          this.transitionStartTime = this.timer.getElapsed();
        }
      } else {
        // Moving up phase - use easeInOutQuad for natural entrance
        if (this.currentArmObject) {
          const easedProgress = easeInOutQuad(progress);
          const newY = THREE.MathUtils.lerp(
            this.initialArmY,
            this.targetArmY,
            easedProgress,
          );
          this.currentArmObject.position.y = newY;
        }

        // When finished moving up, end the transition
        if (progress >= 1) {
          this.isTransitioning = false;
          this.pendingArmObject = undefined;
          this.pendingCustomType = undefined;

          // Ensure the object is exactly at its target position
          if (this.currentArmObject) {
            this.currentArmObject.position.y = this.targetArmY;
          }
        }
      }
    }

    this.layIdleSway(delta);
    this.holdFixedFov();
  }

  /**
   * Scale the arm across the view, about its axis, so an object posed for a
   * fixed field of view projects as it would there: a point drawn at
   * `x / -z` lands where it would at `fixedFov` once x and y are scaled by
   * the ratio of the two fields' tangents. Depth is left alone, so nothing
   * comes nearer the eye.
   */
  private holdFixedFov() {
    const fixedFov = this.currentObjectOptions?.fixedFov;
    const camera = this.viewCamera;
    if (fixedFov === undefined || !camera) {
      this.scale.set(1, 1, 1);
      return;
    }
    const across =
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
      Math.tan(THREE.MathUtils.degToRad(fixedFov / 2));
    this.scale.set(across, across, 1);
  }

  /**
   * Swing what the arm holds and send the swing to the network, so peers
   * swing too. A request the swing in progress is not ready for (see
   * {@link ArmObjectOptions.swingRestartAfter}) does neither, so peers see
   * exactly the swings the holder sees. Returns whether a swing started.
   */
  public doSwing = (): boolean => {
    if (!this.playSwingAnimation()) return false;
    this.emitSwingEvent?.();
    return true;
  };

  /**
   * How far through its swing the held object is, 0 to 1, or null when it
   * is not swinging.
   */
  get swingProgress(): number | null {
    const action = this.swingAnimation;
    if (!action || !(this.isSwingHeld || action.isRunning())) return null;
    return action.time / action.getClip().duration;
  }

  /**
   * Pin the held object's swing `seconds` into it, or release it with
   * `null`. A pinned swing shows that one frame, with no sway, until it is
   * released and the object is back at rest. For stills of a swing and the
   * tests that check one; play never needs it.
   */
  public holdSwingAt = (seconds: number | null) => {
    const action = this.swingAnimation;
    if (!action) return;
    if (seconds === null && !this.isSwingHeld) return;

    this.liftIdleSway();
    this.swayWeight = 0;
    this.restartBlendLeft = 0;
    const duration = action.getClip().duration;
    if (seconds === null) {
      this.isSwingHeld = false;
      action.paused = false;
      action.time = duration;
    } else {
      this.isSwingHeld = true;
      action.reset();
      action.play();
      action.time = THREE.MathUtils.clamp(seconds, 0, duration);
      action.paused = true;
    }
    this.mixer.update(0);
  };

  /**
   * Paint the arm with a texture or color. Only works when showing the empty arm (no held object).
   */
  public paintArm = (texture: THREE.Texture | THREE.Color) => {
    this.children.forEach((child) => {
      if (child instanceof CanvasBox) {
        child.paint("all", texture);

        child.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((mat) => {
                mat.needsUpdate = true;
              });
            } else {
              obj.material.needsUpdate = true;
            }
          }
        });
      }
    });
  };

  /**
   * Play the "swing" animation, unless the swing in progress is not yet
   * {@link ArmObjectOptions.swingRestartAfter} of the way through. Returns
   * whether a swing started.
   */
  private playSwingAnimation = (): boolean => {
    const action = this.swingAnimation;
    if (!action || this.isSwingHeld) return false;

    const options = this.currentObjectOptions;
    if (action.isRunning()) {
      const progress = action.time / action.getClip().duration;
      if (progress < (options?.swingRestartAfter ?? 0)) return false;
      const blend = options?.swingRestartBlend ?? 0;
      const object = this.currentArmObject;
      if (blend > 0 && object) {
        this.restartFromPosition.copy(object.position);
        this.restartFromQuaternion.copy(object.quaternion);
        this.restartBlendLeft = blend;
        this.restartBlendSeconds = blend;
      }
    }

    action.reset();
    action.play();
    return true;
  };

  /** Ease a restarted swing out of the pose it interrupted. */
  private easeSwingRestart(delta: number) {
    if (this.restartBlendLeft <= 0) return;
    const object = this.currentArmObject;
    if (!object) {
      this.restartBlendLeft = 0;
      return;
    }

    this.restartBlendLeft = Math.max(0, this.restartBlendLeft - delta);
    const t = 1 - this.restartBlendLeft / this.restartBlendSeconds;
    const k = t * t * (3 - 2 * t);
    object.position.lerpVectors(this.restartFromPosition, object.position, k);
    swingPose.copy(object.quaternion);
    object.quaternion.slerpQuaternions(
      this.restartFromQuaternion,
      swingPose,
      k,
    );
  }

  /**
   * Lay this frame's idle sway on the held object: it fades in while the
   * object is at rest and out while it swings or is swapped, on a clock
   * that keeps real time.
   */
  private layIdleSway(delta: number) {
    const sway = this.currentObjectOptions?.idleSway;
    const object = this.currentArmObject;
    if (!sway || !object) {
      this.swayWeight = 0;
      return;
    }

    const isAtRest =
      !this.isTransitioning &&
      !this.isSwingHeld &&
      this.restartBlendLeft <= 0 &&
      !this.swingAnimation?.isRunning();
    const fadeSeconds = isAtRest ? sway.fadeInSeconds : sway.fadeOutSeconds;
    const step = fadeSeconds > 0 ? delta / fadeSeconds : 1;
    this.swayWeight = isAtRest
      ? Math.min(1, this.swayWeight + step)
      : Math.max(0, this.swayWeight - step);
    this.swayClock += delta;
    if (this.swayWeight <= 0) return;

    const weight = this.swayWeight;
    const amount = weight * weight * (3 - 2 * weight);
    const breath =
      0.5 - 0.5 * Math.cos((2 * Math.PI * this.swayClock) / sway.breathSeconds);
    const drift = Math.sin((2 * Math.PI * this.swayClock) / sway.driftSeconds);
    this.swayShift
      .set(sway.driftReach * drift, sway.breathLift * breath, 0)
      .multiplyScalar(amount);
    this.swayTurn.setFromEuler(
      swayEuler.set(
        sway.breathTilt * breath * amount,
        0,
        -sway.driftRoll * drift * amount,
      ),
    );
    this.swayPivot.copy(sway.pivot);

    object.position
      .sub(this.swayPivot)
      .applyQuaternion(this.swayTurn)
      .add(this.swayPivot)
      .add(this.swayShift);
    object.quaternion.premultiply(this.swayTurn);
    this.swayedObject = object;
  }

  /** Take last frame's idle sway back off the object it was laid on. */
  private liftIdleSway() {
    const object = this.swayedObject;
    if (!object) return;
    this.swayedObject = null;

    swayInverse.copy(this.swayTurn).invert();
    object.position
      .sub(this.swayShift)
      .sub(this.swayPivot)
      .applyQuaternion(swayInverse)
      .add(this.swayPivot);
    object.quaternion.premultiply(swayInverse);
  }
}
