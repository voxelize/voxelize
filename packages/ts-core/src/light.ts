import { toUint32 } from "./constants";

export enum LightColor {
  Sunlight = "sunlight",
  Red = "red",
  Green = "green",
  Blue = "blue",
}

export const lightColorFromIndex = (color: number): LightColor => {
  switch (color) {
    case 0:
      return LightColor.Sunlight;
    case 1:
      return LightColor.Red;
    case 2:
      return LightColor.Green;
    case 3:
      return LightColor.Blue;
    default:
      throw new RangeError("Invalid light color!");
  }
};

export class LightUtils {
  static extractSunlight(light: number): number {
    return (light >>> 12) & 0xf;
  }

  static insertSunlight(light: number, level: number): number {
    return toUint32((light & 0x0fff) | ((level & 0xf) << 12));
  }

  static extractRedLight(light: number): number {
    return (light >>> 8) & 0xf;
  }

  static insertRedLight(light: number, level: number): number {
    return toUint32((light & 0xf0ff) | ((level & 0xf) << 8));
  }

  static extractGreenLight(light: number): number {
    return (light >>> 4) & 0xf;
  }

  static insertGreenLight(light: number, level: number): number {
    return toUint32((light & 0xff0f) | ((level & 0xf) << 4));
  }

  static extractBlueLight(light: number): number {
    return light & 0xf;
  }

  static insertBlueLight(light: number, level: number): number {
    return toUint32((light & 0xfff0) | (level & 0xf));
  }

  static extractAll(light: number): [number, number, number, number] {
    return [
      LightUtils.extractSunlight(light),
      LightUtils.extractRedLight(light),
      LightUtils.extractGreenLight(light),
      LightUtils.extractBlueLight(light),
    ];
  }
}

export interface LightChannels {
  sunlight: number;
  red: number;
  green: number;
  blue: number;
}

type LightChannelRecord = {
  sunlight?: number;
  red?: number;
  green?: number;
  blue?: number;
};

const toLightChannelRecordOrNull = (
  channels: Partial<LightChannels> | null | undefined
): LightChannelRecord | null => {
  return channels !== null && typeof channels === "object"
    ? (channels as LightChannelRecord)
    : null;
};

const safeReadLightChannel = (
  channels: LightChannelRecord | null,
  key: keyof LightChannelRecord
): number | undefined => {
  if (channels === null) {
    return undefined;
  }

  try {
    return channels[key];
  } catch {
    return undefined;
  }
};

export class Light {
  static sunlight(light: number): number {
    return LightUtils.extractSunlight(light);
  }

  static red(light: number): number {
    return LightUtils.extractRedLight(light);
  }

  static green(light: number): number {
    return LightUtils.extractGreenLight(light);
  }

  static blue(light: number): number {
    return LightUtils.extractBlueLight(light);
  }

  static withSunlight(light: number, level: number): number {
    return LightUtils.insertSunlight(light, level);
  }

  static withRed(light: number, level: number): number {
    return LightUtils.insertRedLight(light, level);
  }

  static withGreen(light: number, level: number): number {
    return LightUtils.insertGreenLight(light, level);
  }

  static withBlue(light: number, level: number): number {
    return LightUtils.insertBlueLight(light, level);
  }

  static pack(channels: Partial<LightChannels>): number {
    let light = 0;
    const normalizedChannels = toLightChannelRecordOrNull(channels);
    const sunlight = safeReadLightChannel(normalizedChannels, "sunlight");
    const red = safeReadLightChannel(normalizedChannels, "red");
    const green = safeReadLightChannel(normalizedChannels, "green");
    const blue = safeReadLightChannel(normalizedChannels, "blue");

    if (sunlight !== undefined) {
      light = Light.withSunlight(light, sunlight);
    }

    if (red !== undefined) {
      light = Light.withRed(light, red);
    }

    if (green !== undefined) {
      light = Light.withGreen(light, green);
    }

    if (blue !== undefined) {
      light = Light.withBlue(light, blue);
    }

    return light;
  }

  static unpack(light: number): LightChannels {
    return {
      sunlight: Light.sunlight(light),
      red: Light.red(light),
      green: Light.green(light),
      blue: Light.blue(light),
    };
  }
}
