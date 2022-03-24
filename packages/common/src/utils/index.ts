export * from "./chunk-utils";
export * from "./math-utils";
export * from "./block-utils";
export * from "./light-utils";

export const timeThis = (name: string, decimals = 3) => {
  const now = performance.now();

  return () => {
    console.log(
      `${name} took ${((performance.now() - now) / 1000).toFixed(decimals)}s`
    );
  };
};
