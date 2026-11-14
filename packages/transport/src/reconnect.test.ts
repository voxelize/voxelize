import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { protocol } from "@voxelize/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connection, server as WebSocketServer } from "websocket";

import { Transport } from "./index";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

async function fixture(rejections = 0, retryMs?: number) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const http = createServer();
  const server = new WebSocketServer({ httpServer: http });
  const transport = new Transport(retryMs);
  const connections: connection[] = [];
  const frames: protocol.Message[] = [];
  let attempts = 0;

  server.on("request", (request) => {
    attempts++;
    if (attempts <= rejections) {
      request.reject(503, "temporarily unavailable");
      return;
    }
    const socket = request.accept(null, request.origin);
    connections.push(socket);
    socket.on("message", (message) => {
      if (message.type === "binary") {
        frames.push(protocol.Message.decode(message.binaryData));
      }
    });
  });

  cleanups.push(async () => {
    // Only this fixture's sockets/timer are owned here. Dropping a test
    // socket must not start another retry after the assertion has ended.
    transport.reconnectTimeout = undefined;
    const internals = transport as unknown as {
      reconnection?: ReturnType<typeof setTimeout>;
    };
    clearTimeout(internals.reconnection);
    transport.abort();
    transport.connection?.drop();
    server.shutDown();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/`;
  return { transport, connections, frames, address, attempts: () => attempts };
}

describe("transport connection recovery", () => {
  it("finishes the original startup after a refused upgrade is retried", async () => {
    const f = await fixture(1, 10);
    let started = false;
    void f.transport.connect(f.address, "test").then(() => {
      started = true;
      f.transport.send({
        type: "UPDATE",
        text: "test",
        updates: [{ vx: 1, vy: 2, vz: 3, voxel: 7 }],
      });
    });

    await vi.waitFor(() => expect(f.connections).toHaveLength(1));
    await vi.waitFor(() => expect(started).toBe(true));
    await vi.waitFor(() => expect(f.frames).toHaveLength(1));
    expect(f.attempts()).toBe(2);
    expect(f.frames[0].type).toBe(protocol.Message.Type.UPDATE);
    expect(f.frames[0].updates[0].voxel).toBe(7);
  });

  it("preserves a caller's connection observer", async () => {
    const f = await fixture();
    const observed = vi.fn();
    f.transport.on("connect", observed);
    await f.transport.connect(f.address, "test");
    expect(observed).toHaveBeenCalledOnce();
  });

  it("does not leave a waiter behind when a connection cannot be started", async () => {
    const f = await fixture();
    const before = f.transport.listenerCount("connect");
    await expect(f.transport.connect("not a URL", "test")).rejects.toThrow();
    expect(f.transport.listenerCount("connect")).toBe(before);
    await f.transport.connect(f.address, "test");
    expect(f.transport.connection.connected).toBe(true);
  });

  it("preserves every waiting caller through repeated refusals", async () => {
    const f = await fixture(3, 10);
    let completed = 0;
    const refused = new Promise<void>((resolve) =>
      f.transport.once("connectFailed", () => resolve()),
    );
    void f.transport.connect(f.address, "test").then(() => completed++);
    await refused;
    void f.transport.connect(f.address, "test").then(() => completed++);

    await vi.waitFor(() => expect(f.connections).toHaveLength(1));
    await vi.waitFor(() => expect(completed).toBe(2));
    expect(f.attempts()).toBe(4);
  });

  it("does not accumulate connection waiters for automatic attempts", async () => {
    const f = await fixture(12, 5);
    let completed = false;
    const listenerCounts: number[] = [];
    f.transport.on("connectFailed", () =>
      listenerCounts.push(f.transport.listenerCount("connect")),
    );
    void f.transport.connect(f.address, "test").then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(completed).toBe(true));
    expect(f.attempts()).toBe(13);
    expect(Math.max(...listenerCounts)).toBeLessThanOrEqual(2);
  });

  it("can recover again after a manual reconnect cancels a scheduled retry", async () => {
    const f = await fixture(0, 60_000);
    await f.transport.connect(f.address, "test");
    f.connections[0].drop();
    await vi.waitFor(() =>
      expect(f.transport.connection.connected).toBe(false),
    );
    await f.transport.connect(f.address, "test");
    f.transport.reconnectTimeout = 10;
    f.connections[1].drop();

    await vi.waitFor(() => expect(f.connections).toHaveLength(3));
    expect(f.attempts()).toBe(3);
  });

  it("dispatches each inbound packet once through successive connections", async () => {
    const f = await fixture(0, 10);
    let received = 0;
    const observer = vi.fn();
    f.transport.on("connect", observer);
    f.transport.onUpdate = () => received++;
    await f.transport.connect(f.address, "test");
    const packet = protocol.Message.encode(
      protocol.Message.create({ type: protocol.Message.Type.UPDATE }),
    ).finish();
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(f.connections).toHaveLength(i + 1));
      // The server accepts just before the client emits its connect event.
      await vi.waitFor(() =>
        expect(f.transport.connection.connected).toBe(true),
      );
      f.connections[i].sendBytes(Buffer.from(packet));
      await vi.waitFor(() => expect(received).toBe(i + 1));
      if (i < 2) f.connections[i].drop();
    }
    expect(observer).toHaveBeenCalledTimes(3);
  });
});
