class LightUtils {
  static extractSunlight = (light: number) => {
    return (light >> 12) & 0xf;
  };

  static insertSunlight = (light: number, level: number) => {
    return (light & 0xfff) | (level << 12);
  };

  static extractRedLight = (light: number) => {
    return (light >> 8) & 0xf;
  };

  static insertRedLight = (light: number, level: number) => {
    return (light & 0xf0ff) | (level << 8);
  };

  static extractGreenLight = (light: number) => {
    return (light >> 4) & 0xf;
  };

  static insertGreenLight = (light: number, level: number) => {
    return (light & 0xff0f) | (level << 4);
  };

  static extractBlueLight = (light: number) => {
    return light & 0xf;
  };

  static insertBlueLight = (light: number, level: number) => {
    return (light & 0xfff0) | level;
  };
}

export const RedLight = "RED";
export const GreenLight = "GREEN";
export const BlueLight = "BLUE";
export const Sunlight = "SUNLIGHT";

export type LightColor = "RED" | "GREEN" | "BLUE" | "SUNLIGHT";

export { LightUtils };
