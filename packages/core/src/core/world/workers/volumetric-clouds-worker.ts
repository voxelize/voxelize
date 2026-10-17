import { generateCloudNoiseVolume } from "../volumetric-clouds-noise";

// @ts-ignore
onmessage = function (e) {
  const data = generateCloudNoiseVolume(e.data);
  // @ts-ignore
  postMessage(data, [data.buffer]);
};
