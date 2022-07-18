import { MessageProtocol } from "@voxelize/transport/src/types";

export interface NetIntercept {
  onMessage: (message: MessageProtocol) => void;

  packets: MessageProtocol[];
}
