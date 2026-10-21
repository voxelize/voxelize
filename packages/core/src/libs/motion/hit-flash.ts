import { Color } from "three";

/**
 * The flash a struck body shows, for any rig that owns its own tint: a
 * near-white pop the frame the blow lands, then red that holds and fades.
 * Rigs mix toward it after their lighting, so a body struck in the dark
 * still flashes. A game passes its own {@link HitFlashProfile} for bodies
 * that should flash fainter (faces that must stay legible, worn armour).
 */
export const HIT_FLASH = {
  popMs: 40,
  popAmount: 0.8,
  peak: 0.75,
  holdMs: 90,
  fadeMs: 160,
} as const;

/** A flash's timing and strength. */
export type HitFlashProfile = {
  readonly popMs: number;
  readonly popAmount: number;
  readonly peak: number;
  readonly holdMs: number;
  readonly fadeMs: number;
};

/** Milliseconds from the blow until a profile's flash is gone. */
export const hitFlashMs = (profile: HitFlashProfile) =>
  profile.popMs + profile.holdMs + profile.fadeMs;

/** Milliseconds from the blow until the flash is gone. */
export const HIT_FLASH_MS = hitFlashMs(HIT_FLASH);

/** The flash's red and its pop, in the shaders' working (linear) space. */
export const HIT_FLASH_RED = new Color("#ff2418");
export const HIT_FLASH_POP = new Color("#fff2e6");

/**
 * The flash `elapsedMs` after a hit: writes its colour into `color` and
 * returns how far to mix toward it (0 once it is over, or before any hit).
 * `isCalm` (reduced motion) drops the white pop and opens on the red.
 */
export function sampleHitFlash(
  elapsedMs: number,
  color: Color,
  isCalm = false,
  profile: HitFlashProfile = HIT_FLASH,
): number {
  if (!(elapsedMs >= 0) || elapsedMs >= hitFlashMs(profile)) return 0;
  let t = elapsedMs;
  if (!isCalm) {
    if (t < profile.popMs) {
      color.copy(HIT_FLASH_POP);
      return profile.popAmount;
    }
    t -= profile.popMs;
  }
  color.copy(HIT_FLASH_RED);
  if (t < profile.holdMs) return profile.peak;
  const fade = (t - profile.holdMs) / profile.fadeMs;
  return fade >= 1 ? 0 : profile.peak * (1 - fade);
}

/** The red a body keeps while it tips over dead: the hold, never the pop. */
export function holdHitFlash(color: Color): number {
  color.copy(HIT_FLASH_RED);
  return HIT_FLASH.peak;
}

/** The recoil lean a struck body takes: out and back over this long. */
export const HIT_RECOIL_MS = 120;

/** 0..1 of the recoil lean `elapsedMs` after a hit (a half sine). */
export function sampleHitRecoil(elapsedMs: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= HIT_RECOIL_MS) return 0;
  return Math.sin((Math.PI * elapsedMs) / HIT_RECOIL_MS);
}
