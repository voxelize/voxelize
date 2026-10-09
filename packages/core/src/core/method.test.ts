import type { MessageProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import {
  METHOD_REJECTED_REPLY,
  Method,
  UNHANDLED_METHOD_REPLY,
} from "./method";

const reply = (name: string, payload: string): MessageProtocol =>
  ({ type: "METHOD", method: { name, payload } }) as MessageProtocol;

/** Answers the pings the way the server does: their payload, echoed. */
const pongsFor = (method: Method) =>
  method.packets.flatMap((packet) =>
    packet.method?.name === "vox-builtin:ping"
      ? [reply("vox-builtin:pong", packet.method.payload)]
      : [],
  );

describe("Method.confirm", () => {
  it("sends the call between two pings and calls it ran when nothing came back about it", async () => {
    const method = new Method();
    const { packet, outcome } = method.confirm("sandbox:fill", {
      block: "crate",
    });

    expect(method.packets.map((each) => each.method?.name)).toEqual([
      "vox-builtin:ping",
      "sandbox:fill",
      "vox-builtin:ping",
    ]);
    expect(method.packets[1]).toBe(packet);

    const [open, close] = pongsFor(method);
    method.onMessage(open);
    method.onMessage(close);
    await expect(outcome).resolves.toEqual({ kind: "ran" });
  });

  it("reads the worlds that do handle a call the world it reached does not", async () => {
    const method = new Method();
    const { outcome } = method.confirm("Sandbox:Fill", {});
    const [open, close] = pongsFor(method);

    method.onMessage(open);
    method.onMessage(
      reply(
        UNHANDLED_METHOD_REPLY,
        JSON.stringify({
          method: "sandbox:fill",
          world: "bare",
          handledBy: ["sandbox", "workshop"],
        }),
      ),
    );
    method.onMessage(close);

    await expect(outcome).resolves.toEqual({
      kind: "unhandled",
      world: "bare",
      handledBy: ["sandbox", "workshop"],
    });
  });

  it("tells a server that cannot say who handles it from one that says nobody does", async () => {
    const method = new Method();
    const { outcome } = method.confirm("sandbox:fill", {});
    const [open, close] = pongsFor(method);

    method.onMessage(open);
    method.onMessage(
      reply(
        UNHANDLED_METHOD_REPLY,
        JSON.stringify({ method: "sandbox:fill", world: "lone" }),
      ),
    );
    method.onMessage(close);

    await expect(outcome).resolves.toEqual({
      kind: "unhandled",
      world: "lone",
      handledBy: null,
    });
  });

  it("carries a rejection's reason", async () => {
    const method = new Method();
    const { outcome } = method.confirm("sandbox:fill", { block: "cratee" });
    const [open, close] = pongsFor(method);

    method.onMessage(open);
    method.onMessage(
      reply(
        METHOD_REJECTED_REPLY,
        JSON.stringify({
          method: "sandbox:fill",
          world: "sandbox",
          reason: "unknown block name 'cratee'",
        }),
      ),
    );
    method.onMessage(close);

    await expect(outcome).resolves.toEqual({
      kind: "rejected",
      world: "sandbox",
      reason: "unknown block name 'cratee'",
    });
  });

  it("does not pin an earlier call's rejection on the call it confirms", async () => {
    const method = new Method();
    const { outcome } = method.confirm("sandbox:fill", { block: "crate" });
    const [open, close] = pongsFor(method);

    method.onMessage(
      reply(
        METHOD_REJECTED_REPLY,
        JSON.stringify({
          method: "sandbox:fill",
          world: "sandbox",
          reason: "unknown block name 'cratee'",
        }),
      ),
    );
    method.onMessage(open);
    method.onMessage(close);

    await expect(outcome).resolves.toEqual({ kind: "ran" });
  });

  it("keeps two confirms of the same method apart", async () => {
    const method = new Method();
    const first = method.confirm("sandbox:fill", { block: "cratee" });
    const second = method.confirm("sandbox:fill", { block: "crate" });
    const [openFirst, closeFirst, openSecond, closeSecond] = pongsFor(method);

    method.onMessage(openFirst);
    method.onMessage(
      reply(
        METHOD_REJECTED_REPLY,
        JSON.stringify({
          method: "sandbox:fill",
          world: "sandbox",
          reason: "unknown block name 'cratee'",
        }),
      ),
    );
    method.onMessage(closeFirst);
    method.onMessage(openSecond);
    method.onMessage(closeSecond);

    await expect(first.outcome).resolves.toMatchObject({ kind: "rejected" });
    await expect(second.outcome).resolves.toEqual({ kind: "ran" });
  });

  it("says it got no answer rather than guessing", async () => {
    const method = new Method();
    const { outcome } = method.confirm("sandbox:fill", {}, { timeoutMs: 20 });

    const settled = await outcome;
    expect(settled.kind).toBe("unanswered");
    expect(settled.kind === "unanswered" && settled.waitedMs).toBeGreaterThan(
      0,
    );
  });

  it("leaves pongs it did not ask for alone", () => {
    const method = new Method();
    method.confirm("sandbox:fill", {});
    expect(() =>
      method.onMessage(reply("vox-builtin:pong", JSON.stringify(1234.5))),
    ).not.toThrow();
  });
});
