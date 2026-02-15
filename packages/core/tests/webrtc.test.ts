import { describe, expect, it } from "vitest";

import { WebRTCConnection } from "../src/core/network/webrtc";

const invokeHandleMessage = (connection: WebRTCConnection, payload: Uint8Array) => {
  const internals = connection as Record<string, (data: ArrayBuffer) => void>;
  internals.handleMessage(payload.buffer.slice(0));
};

const captureSingleMessage = (connection: WebRTCConnection) => {
  const received: Uint8Array[] = [];
  connection.onMessage = (data) => {
    received.push(new Uint8Array(data));
  };
  return received;
};

describe("WebRTCConnection fragment handling", () => {
  it("decodes framed single-fragment payloads", () => {
    const connection = new WebRTCConnection();
    const received = captureSingleMessage(connection);
    const frame = new Uint8Array([
      0xff,
      1, 0, 0, 0,
      0, 0, 0, 0,
      7, 8, 9,
    ]);

    invokeHandleMessage(connection, frame);

    expect(received).toEqual([new Uint8Array([7, 8, 9])]);
  });

  it("treats invalid legacy marker headers as raw payload", () => {
    const connection = new WebRTCConnection();
    const received = captureSingleMessage(connection);
    const frame = new Uint8Array([0x01, 9, 8, 7, 6]);

    invokeHandleMessage(connection, frame);

    expect(received).toEqual([frame]);
  });

  it("ignores new-marker frames with excessive fragment counts", () => {
    const connection = new WebRTCConnection();
    const received = captureSingleMessage(connection);
    const oversizedTotal = 4097;
    const frame = new Uint8Array([
      0xff,
      oversizedTotal & 0xff,
      (oversizedTotal >> 8) & 0xff,
      (oversizedTotal >> 16) & 0xff,
      (oversizedTotal >> 24) & 0xff,
      0, 0, 0, 0,
      1, 2, 3,
    ]);

    invokeHandleMessage(connection, frame);

    expect(received).toEqual([]);
  });
});
