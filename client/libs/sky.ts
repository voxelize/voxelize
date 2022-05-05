import { Color, Group } from "three";

export const hi = "hi";

const STAR_COLORS = [
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#FFFFFF",
  "#8589FF",
  "#FF8585",
];

const SKY_CONFIGS = {
  hours: {
    0: {
      color: {
        top: new Color("#000"),
        middle: new Color("#000"),
        bottom: new Color("#000"),
      },
      skyOffset: 200,
      voidOffset: 1200,
    },
    // start of sunrise
    600: {
      color: {
        top: new Color("#7694CF"),
        middle: new Color("#B0483A"),
        bottom: new Color("#222"),
      },
      skyOffset: 100,
      voidOffset: 1200,
    },
    // end of sunrise, start of day
    700: {
      color: {
        top: new Color("#73A3FB"),
        middle: new Color("#B1CCFD"),
        bottom: new Color("#222"),
      },
      skyOffset: 0,
      voidOffset: 1200,
    },
    // start of sunset
    1700: {
      color: {
        top: new Color("#A57A59"),
        middle: new Color("#FC5935"),
        bottom: new Color("#222"),
      },
      skyOffset: 100,
      voidOffset: 1200,
    },
    // end of sunset, back to night
    1800: {
      color: {
        top: new Color("#000"),
        middle: new Color("#000"),
        bottom: new Color("#000"),
      },
      skyOffset: 200,
      voidOffset: 1200,
    },
  },
};

class Sky {
  public mesh = new Group();

  private topColor: Color;
  private middleColor: Color;
  private bottomColor: Color;
  private newTopColor: Color;
  private newMiddleColor: Color;
  private newBottomColor: Color;
}

export { Sky };
