import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { protocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";
import { server as WebSocketServer } from "websocket";

import { Transport } from "./index";

const update = () => ({
  type: "UPDATE" as const,
  text: "test",
  updates: [{ vx: -2, vy: 3, vz: 4, voxel: 7 }],
});

describe("transport serialization", () => {
  it("can encode the same world update repeatedly without changing it", () => {
    const message = update();
    const before = structuredClone(message);
    const first = Transport.encodeSync(message);
    const second = Transport.encodeSync(message);
    const expected = protocol.Message.encode(
      protocol.Message.create({
        ...before,
        type: protocol.Message.Type.UPDATE,
      }),
    ).finish();

    expect(first).toEqual(expected);
    expect(protocol.Message.decode(first).type).toBe(
      protocol.Message.Type.UPDATE,
    );
    expect(protocol.Message.decode(second).type).toBe(
      protocol.Message.Type.UPDATE,
    );
    expect(second).toEqual(first);
    expect(message).toEqual(before);
  });

  it("serializes a command's JSON once on every encoding", () => {
    const payload = { action: "set", position: [-2, 3, 4], value: 7 };
    const message = { type: "TRANSPORT", text: "test", json: payload };
    for (let i = 0; i < 2; i++) {
      const decoded = protocol.Message.decode(Transport.encodeSync(message));
      expect(decoded.type).toBe(protocol.Message.Type.TRANSPORT);
      expect(JSON.parse(decoded.json)).toEqual(payload);
    }
    expect(message.json).toBe(payload);
  });

  it("does not replace caller-owned entity and peer metadata", () => {
    const entity = {
      id: "e1",
      type: "walker",
      operation: protocol.Entity.Operation.CREATE,
      metadata: { position: [1, 2, 3] },
    };
    const peer = {
      id: "p1",
      username: "observer",
      metadata: { position: [4, 5, 6] },
    };
    const message = { type: "INIT", entities: [entity], peers: [peer] };
    const before = structuredClone(message);
    const entities = message.entities;
    const peers = message.peers;

    for (let i = 0; i < 2; i++) {
      const decoded = protocol.Message.decode(Transport.encodeSync(message));
      expect(JSON.parse(decoded.entities[0].metadata)).toEqual(
        before.entities[0].metadata,
      );
      expect(JSON.parse(decoded.peers[0].metadata)).toEqual(
        before.peers[0].metadata,
      );
    }
    expect(message).toEqual(before);
    expect(message.entities).toBe(entities);
    expect(message.peers).toBe(peers);
    expect(message.entities[0]).toBe(entity);
    expect(message.peers[0]).toBe(peer);
  });

  it("accepts frozen messages and frozen metadata containers", () => {
    const metadata = Object.freeze({ position: Object.freeze([1, 2, 3]) });
    const message = Object.freeze({
      type: "INIT",
      json: Object.freeze({ ready: true }),
      entities: Object.freeze([Object.freeze({ id: "e1", metadata })]),
      peers: Object.freeze([Object.freeze({ id: "p1", metadata })]),
    });
    const decoded = protocol.Message.decode(Transport.encodeSync(message));
    expect(JSON.parse(decoded.json)).toEqual({ ready: true });
    expect(JSON.parse(decoded.entities[0].metadata)).toEqual(metadata);
    expect(JSON.parse(decoded.peers[0].metadata)).toEqual(metadata);
  });

  it("leaves the input intact if metadata cannot be serialized", () => {
    const metadata: { self?: unknown } = {};
    metadata.self = metadata;
    const message = { type: "ENTITY", entities: [{ id: "e1", metadata }] };

    expect(() => Transport.encodeSync(message)).toThrow(TypeError);
    expect(message.type).toBe("ENTITY");
    expect(message.entities[0].metadata).toBe(metadata);
    expect(metadata.self).toBe(metadata);
  });

  it("sends consecutive updates over WebSocket with their original type and new values", async () => {
    const http = createServer();
    const ws = new WebSocketServer({ httpServer: http });
    const transport = new Transport();
    const received: protocol.Message[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delivery = new Promise<protocol.Message[]>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("two update frames did not arrive")),
        3000,
      );
      transport.once("connectFailed", reject);
      ws.on("request", (request) => {
        const connection = request.accept(null, request.origin);
        connection.on("message", (message) => {
          if (message.type !== "binary") return;
          received.push(protocol.Message.decode(message.binaryData));
          if (received.length === 2) resolve(received);
        });
      });
    });

    try {
      await new Promise<void>((resolve) =>
        http.listen(0, "127.0.0.1", resolve),
      );
      const port = (http.address() as AddressInfo).port;
      const [, frames] = await Promise.all([
        transport.connect(`ws://127.0.0.1:${port}/`, "test").then(() => {
          const message = update();
          transport.send(message);
          message.updates[0].voxel = 9;
          transport.send(message);
        }),
        delivery,
      ]);
      expect(frames.map((message) => message.type)).toEqual([
        protocol.Message.Type.UPDATE,
        protocol.Message.Type.UPDATE,
      ]);
      expect(frames.map((message) => message.updates[0].voxel)).toEqual([7, 9]);
    } finally {
      clearTimeout(timer);
      transport.abort();
      transport.connection?.drop();
      ws.shutDown();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});
