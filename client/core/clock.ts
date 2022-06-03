import { Client } from "..";

/**
 * Parameters to initialize the Voxelize clock.
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
    const now = Date.now();
    this.delta = Math.min(
      (now - this.lastFrameTime) / 1000,
      this.params.maxDelta
    );
    this.lastFrameTime = now;
  };
}

export type { ClockParams };

export { Clock };
