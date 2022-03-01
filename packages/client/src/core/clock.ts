import { Client } from "..";

type ClockParams = {
  maxDelta: number;
};

const defaultParams: ClockParams = {
  maxDelta: 0.3,
};

/**
 * A central control for the game clock, including handling intervals
 * and calculating the delta time of each game loop
 *
 * @class Clock
 */
class Clock {
  /**
   * An object storing the parameters passed on `Clock construction
   *
   * @type {ClockParams}
   * @memberof Clock
   */
  public params: ClockParams;

  /**
   * Last time of tick, gets updated each tick
   *
   * @type {number}
   * @memberof Clock
   */
  public lastFrameTime: number;

  /**
   * Delta time elapsed each tick
   *
   * @type {number}
   * @memberof Clock
   */
  public delta: number;

  private intervals: Map<string, number> = new Map();

  constructor(public client: Client, params: Partial<ClockParams> = {}) {
    this.params = {
      ...defaultParams,
      ...params,
    };

    this.lastFrameTime = Date.now();
    this.delta = 0;
  }

  /**
   * Tick for the camera of the game, does the following:
   * - Calculate the time elapsed since last tick
   *
   * @memberof Camera
   */
  tick = () => {
    const now = Date.now();
    this.delta = Math.min(
      (now - this.lastFrameTime) / 1000,
      this.params.maxDelta
    );
    this.lastFrameTime = now;
  };

  /**
   * Register an interval under the game clock
   *
   * @param name - The name of the interval to register
   * @param func - The action to be run each interval
   * @param interval - The time for each interval
   *
   * @memberof Clock
   */
  registerInterval = (name: string, func: () => void, interval: number) => {
    const newInterval = window.setInterval(func, interval);
    this.intervals.set(name, newInterval);
    return newInterval;
  };

  /**
   * Clear an existing interval
   *
   * @param name - The name of the interval to clear
   *
   * @memberof Clock
   */
  clearInterval = (name: string) => {
    const interval = this.intervals.get(name) as number;

    if (interval) {
      window.clearInterval(interval);
      return this.intervals.delete(name);
    }

    return null;
  };

  /**
   * Check if the clock holds a certain interval
   *
   * @param name - The name of interval to check
   *
   * @memberof Clock
   */
  hasInterval = (name: string) => {
    return this.intervals.has(name);
  };
}

export { Clock };
