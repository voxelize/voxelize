export type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

export type PartialRecord<K extends keyof any, T> = {
  [P in K]?: T;
};

export type Coords2 = [number, number];
export type Coords3 = [number, number, number];

export type TargetType = "All" | "Player" | "Entity";

/**
 * A CSS measurement. E.g. "30px", "51em"
 */
export type CSSMeasurement = `${number}${string}`;
