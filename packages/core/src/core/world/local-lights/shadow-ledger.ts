/**
 * The shared per-frame shadow budget, charged in *face units* (one 256²
 * local face = 1; the CSM near cascade ≈ 4; a far cascade ≈ 6 — calibration
 * lives in {@link LocalLightsOptions}). Both shadow consumers — the CSM
 * cascades and the local light atlas — draw depth from the same GPU in the
 * same frame, so they share one explicit budget instead of discovering each
 * other through dropped frames.
 *
 * Grant order per frame, matching the RFC:
 *
 *  1. CSM near cascade — priority 1, *never* denied. Gameplay-critical, and
 *     denying it would change CSM behavior in zero-light worlds
 *     (invariant 6). Overdraft is recorded, not prevented.
 *  2. Dynamic local faces — a held light follows the player; staleness is
 *     visible immediately. The local scheduler *reserves* these units before
 *     CSM renders so a far cascade cannot eat them first.
 *  3. CSM far cascades — already deferred one-per-frame today; the ledger
 *     formalizes it. To keep CSM byte-identical when no local lights are
 *     active, denial only applies while locals are actually consuming
 *     (reservation or spend); and to prevent starvation under a permanently
 *     reserving held light, a far cascade denied `maxFarDeferrals` frames in
 *     a row is force-granted on the next.
 *  4. Invalidated static local faces, FIFO — drain over frames; a TNT blast
 *     re-renders torch shadows over several frames, not one.
 */
export class ShadowFrameLedger {
  /** Mutated in place every frame; never reallocated. */
  readonly frameStats = {
    budget: 0,
    used: 0,
    csmNearUnits: 0,
    csmFarUnits: 0,
    localDynamicUnits: 0,
    localStaticUnits: 0,
    reservedUnits: 0,
    csmFarDenied: 0,
    csmFarForced: 0,
    localDenied: 0,
  };

  private budget = 0;
  private used = 0;
  private reserved = 0;
  private localUsedThisFrame = 0;
  private localUsedLastFrame = 0;
  private consecutiveFarDenials = 0;
  private readonly maxFarDeferrals: number;

  constructor(maxFarDeferrals = 2) {
    this.maxFarDeferrals = maxFarDeferrals;
  }

  beginFrame(budgetUnits: number): void {
    this.budget = Math.max(budgetUnits, 0);
    this.used = 0;
    this.reserved = 0;
    this.localUsedLastFrame = this.localUsedThisFrame;
    this.localUsedThisFrame = 0;

    const stats = this.frameStats;
    stats.budget = this.budget;
    stats.used = 0;
    stats.csmNearUnits = 0;
    stats.csmFarUnits = 0;
    stats.localDynamicUnits = 0;
    stats.localStaticUnits = 0;
    stats.reservedUnits = 0;
    stats.csmFarDenied = 0;
    stats.csmFarForced = 0;
    stats.localDenied = 0;
  }

  /**
   * Reserve units for this frame's dynamic local faces, before CSM renders.
   * Returns the units actually reserved (never more than the free budget, so
   * a huge demand cannot push CSM near into overdraft on its own).
   */
  reserveDynamic(units: number): number {
    const free = Math.max(this.budget - this.used - this.reserved, 0);
    const granted = Math.min(Math.max(units, 0), free);
    this.reserved += granted;
    this.frameStats.reservedUnits = this.reserved;
    return granted;
  }

  /** CSM near cascade: unconditional. Records the spend, may overdraw. */
  chargeCsmNear(units: number): void {
    this.used += units;
    this.frameStats.csmNearUnits += units;
    this.frameStats.used = this.used;
  }

  /**
   * CSM far cascade: granted unless local lights are actively sharing the
   * frame *and* the cascade does not fit next to their reservation. A denial
   * leaves the cascade's dirty flag set upstream, so it retries next frame;
   * after `maxFarDeferrals` consecutive denials the grant is forced.
   */
  requestCsmFar(units: number): boolean {
    const isLocalActive = this.reserved > 0 || this.localUsedLastFrame > 0;
    const fits = this.used + units <= this.budget - this.reserved;

    if (isLocalActive && !fits) {
      if (this.consecutiveFarDenials < this.maxFarDeferrals) {
        this.consecutiveFarDenials++;
        this.frameStats.csmFarDenied++;
        return false;
      }
      this.frameStats.csmFarForced++;
    }

    this.consecutiveFarDenials = 0;
    this.used += units;
    this.frameStats.csmFarUnits += units;
    this.frameStats.used = this.used;
    return true;
  }

  /**
   * Local faces. `dynamic` requests may consume their reservation even when
   * a forced far cascade overdrew the frame; `static` requests only ever use
   * budget that nobody reserved — they are the drain-over-frames tier.
   */
  requestLocal(kind: "dynamic" | "static", units: number): boolean {
    if (kind === "dynamic") {
      const fitsBudget = this.used + units <= this.budget;
      const fitsReservation = units <= this.reserved;
      if (!fitsBudget && !fitsReservation) {
        this.frameStats.localDenied++;
        return false;
      }
      this.reserved = Math.max(this.reserved - units, 0);
      this.used += units;
      this.localUsedThisFrame += units;
      this.frameStats.localDynamicUnits += units;
      this.frameStats.used = this.used;
      return true;
    }

    if (this.used + units > this.budget - this.reserved) {
      this.frameStats.localDenied++;
      return false;
    }
    this.used += units;
    this.localUsedThisFrame += units;
    this.frameStats.localStaticUnits += units;
    this.frameStats.used = this.used;
    return true;
  }

  /** Free units left this frame (after reservations). */
  get remaining(): number {
    return Math.max(this.budget - this.used - this.reserved, 0);
  }
}
