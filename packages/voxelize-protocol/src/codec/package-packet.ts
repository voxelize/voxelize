import { Packet, encodeObjectToStruct } from "..";

import { protocol } from "../generated/protocol";

const { Packet: protocolPacket } = protocol;

export function packagePacket(packet: Packet) {
  if (packet.type) {
    // @ts-ignore
    packet.type = protocolPacket.Type[packet.type];
  }

  if (packet.json) {
    packet.json = encodeObjectToStruct(packet.json);
  }

  if (packet.method && packet.method.payload) {
    packet.method.payload = encodeObjectToStruct(packet.method.payload);
  }

  if (packet.action && packet.action.payload) {
    packet.action.payload = encodeObjectToStruct(packet.action.payload);
  }

  if (packet.events) {
    packet.events.forEach((event) => {
      if (event.payload) {
        event.payload = encodeObjectToStruct(event.payload);
      }
    });
  } else {
    packet.events = [];
  }

  if (packet.entities) {
    packet.entities.forEach((entity) => {
      if (entity.metainfo) {
        entity.metainfo = encodeObjectToStruct(entity.metainfo);
      }
    });
  } else {
    packet.entities = [];
  }

  if (packet.chunks) {
    packet.chunks.forEach((chunk) => {
      if (chunk.metainfo) {
        chunk.metainfo = encodeObjectToStruct(chunk.metainfo);
      }
    });
  } else {
    packet.chunks = [];
  }

  return packet as any as protocol.IPacket;
}
