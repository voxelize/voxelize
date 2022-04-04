import { isMainThread } from "worker_threads";

import { expose } from "threads/worker";

import { Network } from "../../core/network";

const encode = (message: any) => {
  return Network.encode(message);
};

const encoder = {
  encode,
};

if (!isMainThread) {
  expose(encoder);
}

export type EncoderType = typeof encoder;

export default "";
