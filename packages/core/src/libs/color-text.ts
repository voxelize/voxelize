/**
 * This module is used to separate plain text into colored text objects to be further rendered.
 *
 * # Example
 * ```ts
 * const text = "$green$Hello, world!$yellow$The rest is yellow.";
 *
 * // Change the default splitter.
 * ColorText.SPLITTER = "$";
 *
 * // Parse the text into colored text objects.
 * const splitted = ColorText.split(text);
 *
 * // Expected:
 * // [
 * //   {
 * //     text: "Hello, world!",
 * //     color: "green"
 * //   },
 * //   {
 * //     text: "The rest is yellow.",
 * //     color: "yellow"
 * //   },
 * // ]
 * ```
 *
 * ![ColorText](/img/docs/colortext.png)
 *
 * @category Effects
 */
export class ColorText {
  /**
   * The symbol used to separate a text into a colored text object array.
   */
  public static SPLITTER = "∆";

  /**
   * Split a text into a colored text object array by {@link ColorText.SPLITTER}.
   *
   * @param text The text to split.
   * @param defaultColor The default color to apply to the text.
   * @returns An array of colored text objects.
   */
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
