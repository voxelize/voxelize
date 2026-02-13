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
  private static splitterRegex: RegExp | null = null;
  private static splitterRegexSymbol = "";

  private static getSplitterRegex() {
    const splitter = ColorText.SPLITTER;
    if (
      ColorText.splitterRegex &&
      ColorText.splitterRegexSymbol === splitter
    ) {
      return ColorText.splitterRegex;
    }

    ColorText.splitterRegex = new RegExp(
      `(\\${splitter}[^\\${splitter}]*\\${splitter})`
    );
    ColorText.splitterRegexSymbol = splitter;
    return ColorText.splitterRegex;
  }

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
    const rawSplitted = text.split(ColorText.getSplitterRegex());
    let firstNonEmptyIndex = -1;
    for (let index = 0; index < rawSplitted.length; index++) {
      if (rawSplitted[index]) {
        firstNonEmptyIndex = index;
        break;
      }
    }

    if (firstNonEmptyIndex < 0) {
      return [];
    }

    const splitter = ColorText.SPLITTER;
    const result: { color: string; text: string }[] = [];
    const firstSegment = rawSplitted[firstNonEmptyIndex];
    let currentColor = defaultColor;
    let expectingColorToken = firstSegment.includes(splitter);

    for (
      let index = firstNonEmptyIndex;
      index < rawSplitted.length;
      index++
    ) {
      const segment = rawSplitted[index];
      if (!segment) {
        continue;
      }

      if (expectingColorToken) {
        currentColor = segment.substring(1, segment.length - 1);
        expectingColorToken = false;
      } else {
        result.push({ color: currentColor, text: segment });
        expectingColorToken = true;
      }
    }

    if (!expectingColorToken) {
      result.push({ color: currentColor, text: "" });
    }

    return result;
  }
}
