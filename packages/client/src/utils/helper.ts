class Helper {
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

  static round = (n: number, digits: number) => {
    return Math.round(n * 10 ** digits) / 10 ** digits;
  };
}

export { Helper };
