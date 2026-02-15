import {
  Clock,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Quaternion,
  Vector3,
} from "three";

import { JsonValue } from "../types";
import { MathUtils as VoxMathUtils } from "../utils";

import { CanvasBox, CanvasBoxOptions } from "./canvas-box";
import { NameTag, NameTagOptions } from "./nametag";

const CREATURE_SCALE = 0.5;

type ColorCanvasBoxOptions = CanvasBoxOptions & {
  color: Color | string;
};

export type CreatureHeadOptions = ColorCanvasBoxOptions & {
  neckGap?: number;
  faceColor: Color | string;
};

export type CreatureBodyOptions = ColorCanvasBoxOptions;

export type CreatureLegOptions = ColorCanvasBoxOptions & {
  betweenLegsGap?: number;
  frontBackGap?: number;
};

export type CreatureOptions = {
  swingLerp?: number;
  walkingSpeed?: number;
  idleLegSwing?: number;
  positionLerp?: number;
  rotationLerp?: number;
  nameTagOptions?: Partial<NameTagOptions>;
  head?: Partial<CreatureHeadOptions>;
  body?: Partial<CreatureBodyOptions>;
  legs?: Partial<CreatureLegOptions>;
};

export const defaultCreatureOptions: CreatureOptions = {
  swingLerp: 0.8,
  walkingSpeed: 0.8,
  positionLerp: 0.7,
  rotationLerp: 0.2,
  idleLegSwing: 0.03,
};

export const defaultCreatureHeadOptions: CreatureHeadOptions = {
  color: "#4A7C59",
  faceColor: "#6B9B5A",
  gap: 0.1 * CREATURE_SCALE,
  layers: 1,
  side: DoubleSide,
  width: 0.3 * CREATURE_SCALE,
  widthSegments: 8,
  height: 0.25 * CREATURE_SCALE,
  heightSegments: 8,
  depth: 0.35 * CREATURE_SCALE,
  depthSegments: 8,
  neckGap: 0.02 * CREATURE_SCALE,
};

export const defaultCreatureBodyOptions: CreatureBodyOptions = {
  color: "#3D6B4F",
  gap: 0.1 * CREATURE_SCALE,
  layers: 1,
  side: DoubleSide,
  width: 0.6 * CREATURE_SCALE,
  widthSegments: 16,
  height: 0.25 * CREATURE_SCALE,
  heightSegments: 8,
  depth: 0.5 * CREATURE_SCALE,
  depthSegments: 16,
};

export const defaultCreatureLegOptions: CreatureLegOptions = {
  color: "#4A7C59",
  gap: 0.1 * CREATURE_SCALE,
  layers: 1,
  side: DoubleSide,
  width: 0.12 * CREATURE_SCALE,
  widthSegments: 4,
  height: 0.18 * CREATURE_SCALE,
  heightSegments: 4,
  depth: 0.12 * CREATURE_SCALE,
  depthSegments: 4,
  betweenLegsGap: 0.35 * CREATURE_SCALE,
  frontBackGap: 0.45 * CREATURE_SCALE,
};

export class Creature extends Group {
  public options: CreatureOptions;

  public headGroup: Group;
  public bodyGroup: Group;
  public frontLeftLegGroup: Group;
  public frontRightLegGroup: Group;
  public backLeftLegGroup: Group;
  public backRightLegGroup: Group;

  public head: CanvasBox;
  public body: CanvasBox;
  public frontLeftLeg: CanvasBox;
  public frontRightLeg: CanvasBox;
  public backLeftLeg: CanvasBox;
  public backRightLeg: CanvasBox;

  public nametag: NameTag;
  public speed = 0;
  public manualSpeed = false;
  public positionLerpOverride: number | null = null;
  public newPosition = new Vector3();
  public newDirection = new Quaternion();
  public extraData: JsonValue = null;

  onMove: () => void;
  onIdle: () => void;

  private clock = new Clock();
  private positionBuffer: Array<{
    time: number;
    pos: Vector3;
    dir: Quaternion;
  }> = [];
  private reusablePositionBufferEntries: Array<{
    time: number;
    pos: Vector3;
    dir: Quaternion;
  }> = [];
  private positionBufferHead = 0;
  private interpolationDelay = 50;

  constructor(options: Partial<CreatureOptions> = {}) {
    super();

    const headOpts = {
      ...defaultCreatureHeadOptions,
      ...(options.head || {}),
    };
    const bodyOpts = {
      ...defaultCreatureBodyOptions,
      ...(options.body || {}),
    };
    const legOpts = {
      ...defaultCreatureLegOptions,
      ...(options.legs || {}),
    };

    this.options = {
      ...defaultCreatureOptions,
      ...options,
      head: headOpts,
      body: bodyOpts,
      legs: legOpts,
    };

    this.createModel();
  }

  update() {
    const dt = this.clock.getDelta();
    this.interpolateFromBuffer();
    this.calculateDelta();
    this.playLegsWalkingAnimation();
    this.lerpAll(dt);
  }

  private interpolateFromBuffer() {
    const positionBuffer = this.positionBuffer;
    let head = this.positionBufferHead;
    const available = positionBuffer.length - head;
    if (available <= 0) return;

    const renderTime = performance.now() - this.interpolationDelay;
    while (
      positionBuffer.length - head > 2 &&
      positionBuffer[head + 1].time <= renderTime
    ) {
      this.reusablePositionBufferEntries.push(positionBuffer[head]);
      head++;
    }

    if (head !== this.positionBufferHead) {
      this.positionBufferHead = head;
      if (head >= 8) {
        this.normalizePositionBuffer();
        head = this.positionBufferHead;
      }
    }

    const bufferedCount = positionBuffer.length - head;
    if (bufferedCount >= 2) {
      const p0 = positionBuffer[head];
      const p1 = positionBuffer[head + 1];
      const t = Math.max(
        0,
        Math.min(1, (renderTime - p0.time) / (p1.time - p0.time))
      );
      this.newPosition.lerpVectors(p0.pos, p1.pos, t);
      this.newDirection.slerpQuaternions(p0.dir, p1.dir, t);
    } else if (bufferedCount === 1) {
      this.newPosition.copy(positionBuffer[head].pos);
      this.newDirection.copy(positionBuffer[head].dir);
    }
  }

  snapToTarget() {
    this.position.copy(this.newPosition);
    this.quaternion.copy(this.newDirection);
  }

  set(position: number[], direction: number[]) {
    if (!position || !direction) return;
    let entry = this.reusablePositionBufferEntries.pop();
    if (!entry) {
      entry = {
        time: 0,
        pos: new Vector3(),
        dir: new Quaternion(),
      };
    }

    const now = performance.now();
    entry.time = now;
    entry.pos.set(position[0], position[1], position[2]);
    VoxMathUtils.directionToQuaternion(direction[0], 0, direction[2], entry.dir);

    const positionBuffer = this.positionBuffer;
    positionBuffer.push(entry);
    const bufferedCount = positionBuffer.length - this.positionBufferHead;
    if (bufferedCount > 10) {
      const toTrim = bufferedCount - 10;
      const head = this.positionBufferHead;
      const reusableEntries = this.reusablePositionBufferEntries;
      for (let trimIndex = 0; trimIndex < toTrim; trimIndex++) {
        reusableEntries.push(positionBuffer[head + trimIndex]);
      }
      this.positionBufferHead = head + toTrim;
    }
    if (this.positionBufferHead >= 10) {
      this.normalizePositionBuffer();
    }
  }

  private normalizePositionBuffer() {
    const head = this.positionBufferHead;
    if (head <= 0) {
      return;
    }

    const positionBuffer = this.positionBuffer;
    const bufferedCount = positionBuffer.length - head;
    if (bufferedCount > 0) {
      positionBuffer.copyWithin(0, head, positionBuffer.length);
    }
    positionBuffer.length = Math.max(bufferedCount, 0);
    this.positionBufferHead = 0;
  }

  set username(username: string) {
    if (!this.nametag) {
      this.nametag = new NameTag(username, {
        yOffset: this.totalHeight + 0.3,
        fontSize: 0.15,
        ...(this.options.nameTagOptions ?? {}),
      });
      this.headGroup.add(this.nametag);
    }
    if (!username) {
      this.nametag.visible = false;
      return;
    }
    this.nametag.text = username;
    this.nametag.visible = true;
  }

  get username() {
    return this.nametag ? this.nametag.text : "";
  }

  get totalHeight() {
    return (this.options.legs?.height ?? 0) + (this.options.body?.height ?? 0);
  }

  set bodyColor(color: string | Color) {
    this.body.paint("all", new Color(color));
    if (this.options.body) {
      this.options.body.color = color;
    }
  }

  get bodyColor(): string | Color {
    return this.options.body?.color ?? "#3D6B4F";
  }

  set headColor(color: string | Color) {
    this.head.paint("all", new Color(color));
    if (this.options.head) {
      this.options.head.color = color;
    }
  }

  get headColor(): string | Color {
    return this.options.head?.color ?? "#4A7C59";
  }

  set faceColor(color: string | Color) {
    this.head.paint("front", new Color(color));
    if (this.options.head) {
      this.options.head.faceColor = color;
    }
  }

  get faceColor(): string | Color {
    return this.options.head?.faceColor ?? "#6B9B5A";
  }

  set legColor(color: string | Color) {
    const c = new Color(color);
    this.frontLeftLeg.paint("all", c);
    this.frontRightLeg.paint("all", c);
    this.backLeftLeg.paint("all", c);
    this.backRightLeg.paint("all", c);
    if (this.options.legs) {
      this.options.legs.color = color;
    }
  }

  get legColor(): string | Color {
    return this.options.legs?.color ?? "#4A7C59";
  }

  private createModel = () => {
    const headOpts = this.options.head as CreatureHeadOptions;
    const bodyOpts = this.options.body as CreatureBodyOptions;
    const legOpts = this.options.legs as CreatureLegOptions;

    this.head = new CanvasBox(headOpts);
    this.body = new CanvasBox(bodyOpts);
    this.frontLeftLeg = new CanvasBox(legOpts);
    this.frontRightLeg = new CanvasBox(legOpts);
    this.backLeftLeg = new CanvasBox(legOpts);
    this.backRightLeg = new CanvasBox(legOpts);

    this.headGroup = new Group();
    this.bodyGroup = new Group();
    this.frontLeftLegGroup = new Group();
    this.frontRightLegGroup = new Group();
    this.backLeftLegGroup = new Group();
    this.backRightLegGroup = new Group();

    const bodyHeight = bodyOpts.height ?? bodyOpts.width;
    const bodyDepth = bodyOpts.depth ?? bodyOpts.width;
    const headHeight = headOpts.height ?? headOpts.width;
    const headDepth = headOpts.depth ?? headOpts.width;
    const legHeight = legOpts.height ?? legOpts.width;
    const legDepth = legOpts.depth ?? legOpts.width;
    const neckGap = headOpts.neckGap ?? 0;
    const betweenLegsGap = legOpts.betweenLegsGap ?? 0;

    this.bodyGroup.add(this.body);
    this.body.position.y = bodyHeight / 2;
    this.bodyGroup.position.y = legHeight;

    this.headGroup.add(this.head);
    this.head.position.y = headHeight / 2;
    this.headGroup.position.z = -(bodyDepth / 2 + neckGap + headDepth / 2);
    this.headGroup.position.y = legHeight + bodyHeight / 2;

    const legHalfWidth = betweenLegsGap / 2;
    const legFrontZ = -(bodyDepth / 2 - legDepth);
    const legBackZ = bodyDepth / 2 - legDepth;

    this.frontLeftLegGroup.add(this.frontLeftLeg);
    this.frontLeftLeg.position.y = -legHeight / 2;
    this.frontLeftLegGroup.position.set(-legHalfWidth, legHeight, legFrontZ);

    this.frontRightLegGroup.add(this.frontRightLeg);
    this.frontRightLeg.position.y = -legHeight / 2;
    this.frontRightLegGroup.position.set(legHalfWidth, legHeight, legFrontZ);

    this.backLeftLegGroup.add(this.backLeftLeg);
    this.backLeftLeg.position.y = -legHeight / 2;
    this.backLeftLegGroup.position.set(-legHalfWidth, legHeight, legBackZ);

    this.backRightLegGroup.add(this.backRightLeg);
    this.backRightLeg.position.y = -legHeight / 2;
    this.backRightLegGroup.position.set(legHalfWidth, legHeight, legBackZ);

    this.head.paint("all", new Color(headOpts.color));
    this.head.paint("front", new Color(headOpts.faceColor));
    this.body.paint("all", new Color(bodyOpts.color));
    this.frontLeftLeg.paint("all", new Color(legOpts.color));
    this.frontRightLeg.paint("all", new Color(legOpts.color));
    this.backLeftLeg.paint("all", new Color(legOpts.color));
    this.backRightLeg.paint("all", new Color(legOpts.color));

    this.add(this.headGroup);
    this.add(this.bodyGroup);
    this.add(this.frontLeftLegGroup);
    this.add(this.frontRightLegGroup);
    this.add(this.backLeftLegGroup);
    this.add(this.backRightLegGroup);
  };

  private calculateDelta = () => {
    if (this.manualSpeed) return;

    const dx = this.position.x - this.newPosition.x;
    const dz = this.position.z - this.newPosition.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > 0.0000000001) {
      if (this.speed === 0) this.onMove?.();
      this.speed = this.options.walkingSpeed ?? 0.8;
    } else {
      if (this.speed > 0) this.onIdle?.();
      this.speed = 0;
    }
  };

  private lerpAll = (dt: number) => {
    if (this.newPosition.length() !== 0) {
      const baseLerp =
        this.positionLerpOverride ?? this.options.positionLerp ?? 0.7;
      const targetFps = 60;
      const dtNormalized = dt * targetFps;
      const posLerp = 1 - Math.pow(1 - baseLerp, dtNormalized);
      this.position.lerp(this.newPosition, posLerp);
    }
    if (this.newDirection.length() !== 0) {
      const baseRotLerp = this.options.rotationLerp ?? 0.2;
      const targetFps = 60;
      const dtNormalized = dt * targetFps;
      const rotLerp = 1 - Math.pow(1 - baseRotLerp, dtNormalized);
      this.quaternion.slerp(this.newDirection, rotLerp);
    }
  };

  private playLegsWalkingAnimation = () => {
    const scale = 100;
    const speed = Math.max(this.speed, this.options.idleLegSwing ?? 0.03);
    const amplitude = speed * 0.5;
    const t = (performance.now() * speed) / scale;
    const swingLerp = this.options.swingLerp ?? 0.8;

    const angle1 = Math.sin(t) * amplitude;
    const angle2 = Math.sin(t + Math.PI) * amplitude;

    this.frontLeftLegGroup.rotation.x = MathUtils.lerp(
      this.frontLeftLegGroup.rotation.x,
      angle1,
      swingLerp
    );
    this.backRightLegGroup.rotation.x = MathUtils.lerp(
      this.backRightLegGroup.rotation.x,
      angle1,
      swingLerp
    );
    this.frontRightLegGroup.rotation.x = MathUtils.lerp(
      this.frontRightLegGroup.rotation.x,
      angle2,
      swingLerp
    );
    this.backLeftLegGroup.rotation.x = MathUtils.lerp(
      this.backLeftLegGroup.rotation.x,
      angle2,
      swingLerp
    );
  };
}
