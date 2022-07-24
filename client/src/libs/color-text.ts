export class ColorText {
  public static SPLITTER = "∆";
  public static DEFAULT_COLOR = "black";

  public static split(text: string): { color: string; text: string }[] {
    const splitted = text
      .split(
        new RegExp(
          `(\\${ColorText.SPLITTER}[^\\${ColorText.SPLITTER}]*\\${ColorText.SPLITTER})`
        )
      )
      .filter(Boolean);

    if (!splitted[0].includes(ColorText.SPLITTER)) {
      splitted.unshift(
        `${ColorText.SPLITTER}${ColorText.DEFAULT_COLOR}${ColorText.SPLITTER}`
      );
    }

    const result = [];

    for (let i = 0; i < splitted.length; i += 2) {
      const color = splitted[i].substring(1, splitted[i].length - 1);
      const text = splitted[i + 1];

      result.push({ color, text });
    }

    return result;
  }
}
