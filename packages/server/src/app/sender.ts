import { Pool, spawn, Transfer } from "threads";

import { EncodeWorker, EncoderType } from "./workers";
import { World } from "./world";

type Packet = [any, ArrayBuffer[]];

/**
 * A class to send large messages by encoding them off the main thread.
 */
class Sender {
  private pool = Pool(() => spawn<EncoderType>(EncodeWorker()));
  private packets = new Map<string, Packet[]>();

  constructor(public world: World) {}

  /**
   * Send a protocol buffer event to a client. Extract all typed-array
   * buffers into the third argument in order to be sent to another thread to
   * be encoded.
   *
   * @param clientId - ID of the client
   * @param event - Event to send
   * @param buffers - Buffers extracted from the event for multithreading
   */
  addPacket = (clientId: string, event: any, buffers: ArrayBuffer[]) => {
    let packets = this.packets.get(clientId);
    if (!packets) packets = [];
    packets.push([event, buffers]);
    this.packets.set(clientId, packets);
  };

  /**
   * Updater of `Sender`, does the following:
   * - Encode messages in another thread.
   * - Send the messages to the corresponding clients.
   *
   * DO NOT CALL DIRECTLY! THINGS MAY BREAK!
   */
  update = () => {
    this.packets.forEach((packets, clientId) => {
      if (packets.length === 0) return;

      const client = this.world.room.findClient(clientId);
      const toSend = packets.splice(0, packets.length);

      if (!client) return;

      toSend.forEach(([event, buffers]) => {
        this.pool.queue(async (encoder) => {
          const data = await encoder.encode(Transfer(event, buffers));
          client.send(data);
        });
      });
    });
  };
}

export { Sender };
