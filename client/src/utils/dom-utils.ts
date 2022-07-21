export class DOMUtils {
  static applyStyles = (
    ele: HTMLElement | HTMLElement[] | undefined,
    style: Partial<CSSStyleDeclaration>
  ) => {
    if (!ele) return;
    Object.keys(style).forEach((key: string) => {
      // @ts-ignore
      const attribute = style[key];
      if (Array.isArray(ele)) {
        ele.forEach((e: any) => (e.style[key] = attribute));
      } else {
        // @ts-ignore
        ele.style[key] = attribute;
      }
    });

    return ele;
  };

  static rgba = (r: number, g: number, b: number, a: number) => {
    return `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
  };
}
