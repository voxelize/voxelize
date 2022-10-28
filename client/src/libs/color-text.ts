export class ColorText {
  public static SPLITTER = "∆";

  public static split(
    text: string,
    defaultColor = "black"
  ): { color: string; text: string }[] {
    const splitted = text
      .split(
        new RegExp(
          `(\\${ColorText.SPLITTER}[^\\${ColorText.SPLITTER}]*\\${ColorText.SPLITTER})`
        )
      )
      .filter(Boolean);

    if (splitted.length) {
      if (!splitted[0].includes(ColorText.SPLITTER)) {
        splitted.unshift(
          `${ColorText.SPLITTER}${defaultColor}${ColorText.SPLITTER}`
        );
      }

      if (splitted[splitted.length - 1].includes(ColorText.SPLITTER)) {
        splitted.push("");
      }
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
