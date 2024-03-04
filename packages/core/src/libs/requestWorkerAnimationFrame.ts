import { setWorkerTimeout } from "./setWorkerTimeout";

export function requestWorkerAnimationFrame(callback: () => void) {
  if (document.hasFocus()) {
    return requestAnimationFrame(callback);
  }

  setWorkerTimeout(callback, 1000 / 60);
}
