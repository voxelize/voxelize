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
  private static pushSegment(
    result: { color: string; text: string }[],
    color: string,
    segment: string
  ) {
    if (segment.length === 0) {
      return;
    }
    const lastIndex = result.length - 1;
    if (lastIndex >= 0 && result[lastIndex].color === color) {
      result[lastIndex].text += segment;
      return;
    }
    result.push({ color, text: segment });
  }

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
    if (splitterLength > textLength) {
      return [{ color: defaultColor, text }];
    }
    const result: { color: string; text: string }[] = [];
    let currentColor = defaultColor;
    let cursor = 0;
    let endedOnColorToken = false;

    if (splitterLength === 1) {
      let openIndex = text.indexOf(splitter, 0);
      if (openIndex === -1) {
        return [{ color: defaultColor, text }];
      }

      while (cursor < textLength) {
        if (openIndex === -1) {
          ColorText.pushSegment(result, currentColor, text.substring(cursor));
          endedOnColorToken = false;
          break;
        }
        if (openIndex > cursor) {
          ColorText.pushSegment(
            result,
            currentColor,
            text.substring(cursor, openIndex)
          );
          endedOnColorToken = false;
        }
        const tokenStart = openIndex + 1;
        const closeIndex = text.indexOf(splitter, tokenStart);
        if (closeIndex === -1) {
          ColorText.pushSegment(result, currentColor, text.substring(openIndex));
          endedOnColorToken = false;
          break;
        }

        currentColor = text.substring(tokenStart, closeIndex);
        cursor = closeIndex + 1;
        endedOnColorToken = cursor >= textLength;
        openIndex = text.indexOf(splitter, cursor);
      }
    } else {
      let openIndex = text.indexOf(splitter, 0);
      if (openIndex === -1) {
        return [{ color: defaultColor, text }];
      }

      while (cursor < textLength) {
        if (openIndex === -1) {
          ColorText.pushSegment(result, currentColor, text.substring(cursor));
          endedOnColorToken = false;
          break;
        }
        if (openIndex > cursor) {
          ColorText.pushSegment(
            result,
            currentColor,
            text.substring(cursor, openIndex)
          );
          endedOnColorToken = false;
        }
        const tokenStart = openIndex + splitterLength;
        const closeIndex = text.indexOf(splitter, tokenStart);
        if (closeIndex === -1) {
          ColorText.pushSegment(result, currentColor, text.substring(openIndex));
          endedOnColorToken = false;
          break;
        }

        currentColor = text.substring(tokenStart, closeIndex);
        cursor = closeIndex + splitterLength;
        endedOnColorToken = cursor >= textLength;
        openIndex = text.indexOf(splitter, cursor);
      }
    }

    if (endedOnColorToken) {
      const lastSegment = result[result.length - 1];
      if (!lastSegment || lastSegment.color !== currentColor) {
        result.push({ color: currentColor, text: "" });
      }
    }

    if (result.length === 0) {
      if (endedOnColorToken) {
        return [{ color: currentColor, text: "" }];
      } else {
        return [{ color: defaultColor, text }];
      }
    }

    return result;
  }
}
