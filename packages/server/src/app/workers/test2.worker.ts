import { expose } from "threads/worker";

expose((input: string) => {
  return `Worker received: ${input}`;
});

export default "";
