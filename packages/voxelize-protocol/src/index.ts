import * as protocol from "./generated/protocol";

export * from "./utils";
export { protocol };

function sum(a: number, b: number) {
  return a + b;
}

function multiply(a: number, b: number) {
  return a * b;
}

export { multiply, sum };
