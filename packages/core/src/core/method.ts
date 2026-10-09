import { MessageProtocol } from "@voxelize/protocol";

import { NetIntercept } from "./network";

/**
 * The reply a server sends when the world a call reached has no handler
 * under its name: `{ method, world, handledBy? }`, where `handledBy` names
 * the worlds on the same server that do handle it.
 */
export const UNHANDLED_METHOD_REPLY = "vox-builtin:unhandled-method";

/**
 * The reply a server sends when a call reached the world and did nothing:
 * the world's guard refused it, or its handler turned it down or panicked.
 * `{ method, world, reason }`.
 */
export const METHOD_REJECTED_REPLY = "vox-builtin:method-rejected";

const PING = "vox-builtin:ping";
const PONG = "vox-builtin:pong";

export const DEFAULT_METHOD_CONFIRM_TIMEOUT_MS = 5_000;

/**
 * What the server did with one call, as {@link Method.confirm} found out.
 *
 * - `ran`: a handler ran it and did not turn it down. Whatever the handler
 *   does later (a spawn, a remesh) is not covered.
 * - `unhandled`: the world has no handler under that name. `handledBy` lists
 *   the worlds on the same server that do, or is `null` when the server
 *   keeps no index of them.
 * - `rejected`: the world's guard refused it, or its handler turned it down
 *   or panicked; `reason` says which and why.
 * - `unanswered`: the server did not answer within the wait (a dropped
 *   socket, a stalled world). The call may or may not have run.
 */
export type MethodOutcome =
  | { kind: "ran" }
  | { kind: "unhandled"; world: string; handledBy: string[] | null }
  | { kind: "rejected"; world: string; reason: string }
  | { kind: "unanswered"; waitedMs: number };

type PendingConfirm = {
  method: string;
  openToken: string;
  closeToken: string;
  isOpen: boolean;
  outcome: MethodOutcome | null;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (outcome: MethodOutcome) => void;
};

type MethodReply = {
  method: string;
  world: string;
  handledBy?: unknown;
  reason?: unknown;
};

function parseReply(payload: string): MethodReply | null {
  try {
    const reply = JSON.parse(payload);
    return typeof reply?.method === "string" && typeof reply?.world === "string"
      ? reply
      : null;
  } catch {
    return null;
  }
}

/**
 * A caller for a method on the server.
 *
 * TODO-DOC
 *
 * # Example
 * ```ts
 * const method = new VOXELIZE.Method();
 *
 * // Register the method caller with the network.
 * network.register(method);
 *
 * // Call a method on the server.
 * method.call("my-method", { hello: "world" });
 * ```
 */
export class Method implements NetIntercept {
  public packets: MessageProtocol<any, any, any, any>[] = [];

  private confirms: PendingConfirm[] = [];

  private confirmCount = 0;

  /**
   * Create a method caller that can be used to call a method on the server.
   *
   * @hidden
   */
  constructor() {
    // NOTHING
  }

  /**
   * Call a defined method on the server.
   *
   * @param name The name of the method to call.
   * @param payload The JSON serializable payload to send to the server.
   * @returns The queued packet. Callers that must know whether the command
   *   actually left the client can flush the network and then check the
   *   packet's absence from both this intercept's `packets` queue and
   *   `Network.isPacketPendingSend`.
   */
  call = (
    name: string,
    payload: any = {},
  ): MessageProtocol<any, any, any, any> => {
    const packet: MessageProtocol<any, any, any, any> = {
      type: "METHOD",
      method: {
        name,
        payload: JSON.stringify(payload),
      },
    };
    this.packets.push(packet);
    return packet;
  };

  /**
   * Call a method and find out what the server did with it. The call goes
   * out between two pings: the server handles one client's messages in
   * order, so a reply about the call ({@link UNHANDLED_METHOD_REPLY},
   * {@link METHOD_REJECTED_REPLY}) lands between the two pongs, and a call
   * that drew no reply by the second pong ran.
   *
   * Needs this caller registered with the network, and goes out on the next
   * flush like any call.
   */
  confirm = (
    name: string,
    payload: any = {},
    options: { timeoutMs?: number } = {},
  ): {
    packet: MessageProtocol<any, any, any, any>;
    outcome: Promise<MethodOutcome>;
  } => {
    const id = ++this.confirmCount;
    const openToken = `method-confirm:${id}:open`;
    const closeToken = `method-confirm:${id}:close`;
    this.packets.push(this.ping(openToken));
    const packet = this.call(name, payload);
    this.packets.push(this.ping(closeToken));

    const timeoutMs = options.timeoutMs ?? DEFAULT_METHOD_CONFIRM_TIMEOUT_MS;
    const outcome = new Promise<MethodOutcome>((resolve) => {
      const pending: PendingConfirm = {
        method: name.toLowerCase(),
        openToken: JSON.stringify(openToken),
        closeToken: JSON.stringify(closeToken),
        isOpen: false,
        outcome: null,
        startedAt: Date.now(),
        timer: setTimeout(() => {
          this.settle(pending, {
            kind: "unanswered",
            waitedMs: Date.now() - pending.startedAt,
          });
        }, timeoutMs),
        resolve,
      };
      this.confirms.push(pending);
    });
    return { packet, outcome };
  };

  onMessage = (message: MessageProtocol<any, any, any, any>) => {
    if (message.type !== "METHOD" || !message.method) return;
    if (this.confirms.length === 0) return;
    const { name, payload } = message.method;

    if (name === PONG) {
      const pending = this.confirms.find(
        (each) => each.openToken === payload || each.closeToken === payload,
      );
      if (!pending) return;
      if (payload === pending.openToken) {
        pending.isOpen = true;
        return;
      }
      this.settle(pending, pending.outcome ?? { kind: "ran" });
      return;
    }

    if (name !== UNHANDLED_METHOD_REPLY && name !== METHOD_REJECTED_REPLY) {
      return;
    }
    const reply = parseReply(payload);
    if (!reply) return;
    const pending = this.confirms.find(
      (each) =>
        each.isOpen && each.outcome === null && each.method === reply.method,
    );
    if (!pending) return;
    pending.outcome =
      name === UNHANDLED_METHOD_REPLY
        ? {
            kind: "unhandled",
            world: reply.world,
            handledBy: Array.isArray(reply.handledBy)
              ? reply.handledBy.filter(
                  (world): world is string => typeof world === "string",
                )
              : null,
          }
        : {
            kind: "rejected",
            world: reply.world,
            reason:
              typeof reply.reason === "string"
                ? reply.reason
                : "the server gave no reason",
          };
  };

  private ping = (token: string): MessageProtocol<any, any, any, any> => ({
    type: "METHOD",
    method: { name: PING, payload: JSON.stringify(token) },
  });

  private settle = (pending: PendingConfirm, outcome: MethodOutcome) => {
    const index = this.confirms.indexOf(pending);
    if (index === -1) return;
    this.confirms.splice(index, 1);
    clearTimeout(pending.timer);
    pending.resolve(outcome);
  };
}
