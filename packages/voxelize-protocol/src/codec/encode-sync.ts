import { Packet } from "..";
import protocol from "../generated/protocol";
import { packagePacket } from "./package-packet";

const {
  protocol: { Message },
} = protocol;

export function encodePacketSync(packet: Packet) {
  return encodePacketsSync([packet]);
}

export function encodePacketsSync(packets: Packet[]) {
  const message = {
    packets: packets.map(packagePacket),
  };

  return Message.encode(Message.create(message)).finish();
}
