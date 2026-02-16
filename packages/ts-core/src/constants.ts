export const PY_ROTATION = 0;
export const NY_ROTATION = 1;
export const PX_ROTATION = 2;
export const NX_ROTATION = 3;
export const PZ_ROTATION = 4;
export const NZ_ROTATION = 5;

export const Y_ROT_SEGMENTS = 16;

export const Y_ROT_MAP: [number, number][] = [];
export const Y_ROT_MAP_EIGHT: [number, number][] = [];
export const Y_ROT_MAP_FOUR: [number, number][] = [];

export const ROTATION_MASK = 0xfff0ffff;
export const Y_ROTATION_MASK = 0xff0fffff;
export const STAGE_MASK = 0xf0ffffff;

export const PI_2 = Math.PI / 2.0;

for (let i = 0; i < Y_ROT_SEGMENTS; i += 1) {
  const mapping: [number, number][] = [
    [(i / Y_ROT_SEGMENTS) * Math.PI * 2, i],
    [(i / Y_ROT_SEGMENTS) * Math.PI * 2 - Math.PI * 2, i],
  ];

  Y_ROT_MAP.push(...mapping);

  if (i % 2 === 0) {
    Y_ROT_MAP_EIGHT.push(...mapping);
  }

  if (i % 4 === 0) {
    Y_ROT_MAP_FOUR.push(...mapping);
  }
}

const UINT32_MAX = 0xffffffff;

export const toUint32 = (value: number): number => {
  try {
    return value >>> 0;
  } catch {
    return 0;
  }
};

export const toSaturatedUint32 = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value >= UINT32_MAX) {
    return UINT32_MAX;
  }

  return Math.trunc(value) >>> 0;
};

export const assertStage = (stage: number): void => {
  if (!Number.isInteger(stage) || stage < 0 || stage > 15) {
    throw new RangeError("Maximum stage is 15");
  }
};
