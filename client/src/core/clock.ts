import { Client } from "..";

/**
 * Parameters to initialize the Voxelize {@link Clock}.
 */
type ClockParams = {
  /**
   * The maximum delta allowed for each game loop. Defaults to `0.3`.
   */
  maxDelta: number;
};

const defaultParams: ClockParams = {
  maxDelta: 0.3,
};

/**
 * A **built-in** central control for the game clock, including handling intervals
 * and calculating the delta time of each front-end game loop.
 *
 * # Example
 * Getting the delta time elapsed in seconds:
 * ```ts
 * console.log(client.clock.delta);
 * ```
 *
 * @category Core
 */
class Clock {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Parameters to initialize the clock.
   */
  public params: ClockParams;

  /**
   * Delta time elapsed each update
   *
   * @type {number}
   * @memberof Clock
   */
  public delta: number;

  /**
   * The N'th tick since the game has started.
   */
  public tick = 0;

  /**
   * A function called before every update per tick.
   */
  public onBeforeUpdate?: () => void;

  /**
   * A function called after every update per tick.
   */
  public onAfterUpdate?: () => void;

  private lastFrameTime: number;

  /**
   * Constructs a new Voxelize clock instance.
   *
   * @hidden
   */
  constructor(client: Client, params: Partial<ClockParams> = {}) {
    this.client = client;

    this.params = {
      ...defaultParams,
      ...params,
    };

    this.lastFrameTime = Date.now();
    this.delta = 0;
  }

  /**
   * Update for the clock of the game.
   *
   * @hidden
   */
  update = () => {
    this.onBeforeUpdate?.();

    this.tick++;

    const now = Date.now();
    this.delta = Math.min(
      (now - this.lastFrameTime) / 1000,
      this.params.maxDelta
    );
    this.lastFrameTime = now;

    this.onAfterUpdate?.();
  };
}

export type { ClockParams };

export { Clock };
