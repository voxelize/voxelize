import { MessageProtocol, ChatProtocol } from "@voxelize/transport/src/types";

import { NetIntercept } from "./network";

export class Chat implements NetIntercept {
  public packets: MessageProtocol[] = [];

  send = (chat: ChatProtocol) => {
    this.packets.push({
      type: "CHAT",
      chat,
    });
  };

  onChat: (chat: ChatProtocol) => void;

  onMessage = (message: MessageProtocol) => {
    if (message.type !== "CHAT") return;

    const { chat } = message;
    this.onChat?.(chat);
  };
}
