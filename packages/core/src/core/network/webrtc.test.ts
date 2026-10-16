import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebRTCConnection } from "./webrtc";

/** Records what is closed; the offer resolves, nothing is ever sent. */
class FakeChannel {
  binaryType = "blob";

  readyState = "connecting";

  onopen: (() => void) | null = null;

  onclose: (() => void) | null = null;

  onmessage: ((event: MessageEvent) => void) | null = null;

  closed = 0;

  close() {
    this.closed += 1;
    this.readyState = "closed";
  }
}

class FakePeerConnection {
  static made: FakePeerConnection[] = [];

  channel = new FakeChannel();

  closed = 0;

  remote: unknown = null;

  constructor() {
    FakePeerConnection.made.push(this);
  }

  createDataChannel() {
    return this.channel;
  }

  async createOffer() {
    return { type: "offer", sdp: "v=0" };
  }

  async setLocalDescription() {}

  async setRemoteDescription(description: unknown) {
    this.remote = description;
  }

  close() {
    this.closed += 1;
  }
}

describe("WebRTCConnection.connect", () => {
  beforeEach(() => {
    FakePeerConnection.made = [];
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("closes the peer connection and its channel when the offer cannot be sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const connection = new WebRTCConnection();

    await expect(
      connection.connect("ws://localhost:4001", "client"),
    ).rejects.toThrow("Failed to fetch");

    const [peer] = FakePeerConnection.made;
    expect(peer.closed).toBe(1);
    expect(peer.channel.closed).toBe(1);
    expect(connection.isConnected).toBe(false);
  });

  it("closes them when the server refuses the offer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 })),
    );
    const connection = new WebRTCConnection();

    await expect(
      connection.connect("ws://localhost:4001", "client"),
    ).rejects.toThrow("RTC offer failed: 403");

    const [peer] = FakePeerConnection.made;
    expect(peer.closed).toBe(1);
    expect(peer.channel.closed).toBe(1);
  });

  it("keeps them open once the answer is applied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ sdp: "v=0" }) })),
    );
    const connection = new WebRTCConnection();

    await connection.connect("ws://localhost:4001", "client");

    const [peer] = FakePeerConnection.made;
    expect(peer.remote).toEqual({ type: "answer", sdp: "v=0" });
    expect(peer.closed).toBe(0);
    expect(peer.channel.closed).toBe(0);
  });
});
