import type { Vector3 } from "three";

const TIP_END = 300;
const POOF_TIME = 500;
const VANISH_DURATION = 100;

/** Milliseconds from `start()` until the body has shrunk to nothing — the
 *  moment a dying thing is gone from where it fell. Anything that follows a
 *  death (a wake teleport, a respawn) keys off this so it lands only once
 *  observers have watched the body vanish. */
export const DEATH_BODY_GONE_MS = POOF_TIME + VANISH_DURATION;

function remap(value: number, inMin: number, inMax: number): number {
  return Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)));
}

function easeOutQuad(t: number): number {
  return t * (2 - t);
}

export class DeathAnimation {
  private startTime: number | null = null;
  private poofSpawned = false;
  private _onPoof?: (position: Vector3) => void;

  start(onPoof?: (position: Vector3) => void): void {
    this.startTime = performance.now();
    this.poofSpawned = false;
    this._onPoof = onPoof;
  }

  /** Begin already over: the body was gone before anyone here could watch
   *  it fall (a late joiner seeing a player already down). No poof. */
  startGone(): void {
    this.startTime = performance.now() - DEATH_BODY_GONE_MS;
    this.poofSpawned = true;
    this._onPoof = undefined;
  }

  /** Take the poof from a second report of the same death, when the first
   *  started the fall without one. */
  adoptPoof(onPoof: (position: Vector3) => void): void {
    if (this.poofSpawned || this._onPoof) return;
    this._onPoof = onPoof;
  }

  get active(): boolean {
    return this.startTime !== null;
  }

  /** Forget the death: `active` goes false and the next `start()` begins a
   *  fresh tip-over. For bodies that come back (players wake at home or the spawn;
   *  creatures are simply deleted and never need this). */
  reset(): void {
    this.startTime = null;
    this.poofSpawned = false;
    this._onPoof = undefined;
  }

  get elapsed(): number {
    if (this.startTime === null) return 0;
    return performance.now() - this.startTime;
  }

  /** True once the tip-over has run its course and the body has vanished. */
  get isBodyGone(): boolean {
    return this.active && this.elapsed >= DEATH_BODY_GONE_MS;
  }

  getTipAngle(): number {
    const t = easeOutQuad(remap(this.elapsed, 0, TIP_END));
    return t * (Math.PI / 2);
  }

  getScale(baseScale: number): number {
    const t = remap(this.elapsed, POOF_TIME, POOF_TIME + VANISH_DURATION);
    return baseScale * (1 - t);
  }

  getHitIntensity(): number {
    if (!this.active) return 0;
    const t = remap(this.elapsed, 0, 150);
    return 0.5 * Math.min(t, 1);
  }

  checkPoof(position: Vector3): void {
    if (!this.active || this.poofSpawned) return;
    if (this.elapsed >= POOF_TIME) {
      this.poofSpawned = true;
      this._onPoof?.(position);
    }
  }

  applyEdgePivot(
    position: Vector3,
    bodyDirY: number,
    size: number,
    pivotH: number,
    pivotW: number,
    out: Vector3,
  ): void {
    const tipAngle = this.getTipAngle();
    const sinTip = Math.sin(tipAngle);
    const cosTip = Math.cos(tipAngle);
    const cosDir = Math.cos(bodyDirY);
    const sinDir = Math.sin(bodyDirY);
    const h = pivotH * size;
    const w = pivotW * size;
    const lx = w * (cosTip - 1) - h * sinTip;
    const ly = w * sinTip + h * (cosTip - 1);
    out.set(
      position.x + lx * cosDir,
      position.y + ly,
      position.z - lx * sinDir,
    );
  }
}
