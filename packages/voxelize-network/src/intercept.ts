import { Message } from "@voxelize/protocol";

export interface NetIntercept {
  onMessages?: (
    messages: Message[],
    // TODO: add clientInfo
    // clientInfo: {
    //   username: string;
    //   id: string;
    // },
  ) => void;

  messages?: Message[];
}
