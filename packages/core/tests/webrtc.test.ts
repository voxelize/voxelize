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

type FragmentState = {
  parts: Array<Uint8Array | null>;
  received: number;
  total: number;
};

describe("WebRTCConnection fragment handling", () => {
  it("passes through raw non-fragment payloads", () => {
    const connection = new WebRTCConnection();
    const received = captureSingleMessage(connection);
    const raw = new Uint8Array([0x08, 0x96, 0x01]);

    invokeHandleMessage(connection, raw);

    expect(received).toEqual([raw]);
  });

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

  it("passes through legacy marker payload when total is excessive", () => {
    const connection = new WebRTCConnection();
    const received = captureSingleMessage(connection);
    const oversizedTotal = 4097;
    const frame = new Uint8Array([
      0x01,
      oversizedTotal & 0xff,
      (oversizedTotal >> 8) & 0xff,
      (oversizedTotal >> 16) & 0xff,
      (oversizedTotal >> 24) & 0xff,
      0, 0, 0, 0,
      1, 2, 3,
    ]);

    invokeHandleMessage(connection, frame);

    expect(received).toEqual([frame]);
  });

  it("resets fragment state when message id approaches max safe integer", () => {
    const connection = new WebRTCConnection();
    const received = captureSingleMessage(connection);
    const internals = connection as {
      fragments: Map<number, FragmentState>;
      nextMessageId: number;
    };
    internals.fragments.set(88, {
      parts: [new Uint8Array([5]), null],
      received: 1,
      total: 2,
    });
    internals.nextMessageId = Number.MAX_SAFE_INTEGER - 1;

    const firstFragment = new Uint8Array([
      0xff,
      2, 0, 0, 0,
      0, 0, 0, 0,
      10,
    ]);
    const secondFragment = new Uint8Array([
      0xff,
      2, 0, 0, 0,
      1, 0, 0, 0,
      11, 12,
    ]);

    invokeHandleMessage(connection, firstFragment);
    expect(internals.nextMessageId).toBe(1);
    expect(internals.fragments.has(88)).toBe(false);
    expect(internals.fragments.has(0)).toBe(true);

    invokeHandleMessage(connection, secondFragment);

    expect(received).toEqual([new Uint8Array([10, 11, 12])]);
    expect(internals.fragments.size).toBe(0);
  });
});
