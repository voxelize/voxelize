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
    const splitter = ColorText.SPLITTER;
    const splitterLength = splitter.length;
    const textLength = text.length;
    if (textLength === 0) {
      return [];
    }
    if (splitterLength === 0) {
      return [{ color: defaultColor, text }];
    }
    if (text.indexOf(splitter) === -1) {
      return [{ color: defaultColor, text }];
    }
    const result: { color: string; text: string }[] = [];
    let currentColor = defaultColor;
    let expectingColorToken = false;
    let hasNonEmptySegment = false;
    let cursor = 0;

    while (cursor <= textLength) {
      const openIndex = text.indexOf(splitter, cursor);
      let segment = "";
      let segmentContainsSplitter = false;

      if (openIndex === -1) {
        segment = text.substring(cursor);
        cursor = textLength + 1;
      } else {
        const tokenStart = openIndex + splitterLength;
        const closeIndex = text.indexOf(splitter, tokenStart);
        if (closeIndex === -1) {
          segment = text.substring(cursor);
          segmentContainsSplitter = true;
          cursor = textLength + 1;
        } else {
          segment = text.substring(cursor, openIndex);
          const tokenEnd = closeIndex + splitterLength;
          cursor = tokenEnd;
          if (!hasNonEmptySegment) {
            expectingColorToken = true;
            hasNonEmptySegment = true;
          }
          if (expectingColorToken) {
            currentColor = text.substring(tokenStart, closeIndex);
            expectingColorToken = false;
          } else {
            result.push({
              color: currentColor,
              text: text.substring(openIndex, tokenEnd),
            });
            expectingColorToken = true;
          }
        }
      }

      if (!segment) {
        continue;
      }
      if (!hasNonEmptySegment) {
        expectingColorToken = segmentContainsSplitter;
        hasNonEmptySegment = true;
      }

      if (expectingColorToken) {
        currentColor = segment.substring(
          splitterLength,
          segment.length - splitterLength
        );
        expectingColorToken = false;
      } else {
        result.push({ color: currentColor, text: segment });
        expectingColorToken = true;
      }
    }

    if (!hasNonEmptySegment) {
      return result;
    }

    if (!expectingColorToken) {
      result.push({ color: currentColor, text: "" });
    }

    return result;
  }
}
