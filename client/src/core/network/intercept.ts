import { MessageProtocol } from "@voxelize/transport/src/types";

export interface NetIntercept {
  onMessage: (
    message: MessageProtocol,
    clientInfo: { username: string; id: string }
  ) => void;

  packets?: MessageProtocol[];
}
