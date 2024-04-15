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
    const lines = text.split("\n").filter(Boolean);
    const result = [];

    lines.forEach((line) => {
      const matches = line.match(
        new RegExp(`\\${ColorText.SPLITTER}(.*?)\\${ColorText.SPLITTER}`, "g")
      );
      if (matches) {
        matches.forEach((match) => {
          const colorText = match.split(ColorText.SPLITTER).filter(Boolean);
          if (colorText.length >= 2) {
            result.push({ color: colorText[0], text: colorText[1] });
          }
        });
      } else {
        result.push({ color: defaultColor, text: line });
      }
    });

    return result;
  }
}
