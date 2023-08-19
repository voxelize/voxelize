import { Message, Packet } from "..";
import protocol from "../generated/protocol";
import { packagePacket } from "./package-packet";

const {
  protocol: { Message },
} = protocol;

export function encodeMessageSync(message: Message) {
  // @ts-ignore
  message.packets = message.packets.map(packagePacket);

  return Message.encode(Message.create(message as any)).finish();
}

export function encodeMessagesSync(messages: Message[]) {
  return messages.map(encodeMessageSync);
}

export function encodePacketSync(packet: Packet) {
  return encodePacketsSync([packet]);
}

export function encodePacketsSync(packets: Packet[]) {
  const message = {
    packets: packets.map(packagePacket),
  };

  return Message.encode(Message.create(message)).finish();
}
