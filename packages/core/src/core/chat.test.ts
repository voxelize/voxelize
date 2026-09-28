import { describe, expect, it, vi } from "vitest";

import { Chat, CHAT_HISTORY_METHOD, ChatHistoryUpdate } from "./chat";

const entry = (seq: number, body: string) => ({
  seq,
  sentAt: 1_000 * seq,
  kind: "player",
  senderId: "a",
  senderName: "alice",
  type: "CLIENT",
  sender: "[alice]",
  body,
  metadata: "",
});

const init = (chatHistory?: unknown) =>
  ({
    type: "INIT",
    json: { options: { commandSymbol: "/" }, chatHistory },
  }) as never;

const reply = (payload: unknown) =>
  ({
    type: "METHOD",
    method: { name: CHAT_HISTORY_METHOD, payload: JSON.stringify(payload) },
  }) as never;

describe("chat history", () => {
  it("hands the join replay to onHistory without passing it through onChat", () => {
    const chat = new Chat();
    const onChat = vi.fn();
    const onHistory = vi.fn();
    chat.onChat = onChat;
    chat.onHistory = onHistory;

    chat.onMessage(
      init({ entries: [entry(1, "hi"), entry(2, "yo")], hasMore: true }),
    );

    expect(onChat).not.toHaveBeenCalled();
    expect(onHistory).toHaveBeenCalledTimes(1);
    const update: ChatHistoryUpdate = onHistory.mock.calls[0][0];
    expect(update.isJoin).toBe(true);
    expect(update.hasMore).toBe(true);
    expect(update.entries.map((e) => e.body)).toEqual(["hi", "yo"]);
    expect(chat.joinHistory).toEqual(update);
  });

  it("keeps the replay for a listener that attaches after the INIT", () => {
    const chat = new Chat();
    chat.onMessage(init({ entries: [entry(4, "late")], hasMore: false }));
    expect(chat.joinHistory?.entries[0].body).toBe("late");
  });

  it("ignores an INIT from a server that keeps no history", () => {
    const chat = new Chat();
    const onHistory = vi.fn();
    chat.onHistory = onHistory;
    chat.onMessage(init());
    expect(onHistory).not.toHaveBeenCalled();
    expect(chat.joinHistory).toBeNull();
  });

  it("asks for one older page at a time and hands the answer over", () => {
    const chat = new Chat();
    const onHistory = vi.fn();
    chat.onHistory = onHistory;
    chat.onMessage(init({ entries: [entry(51, "x")], hasMore: true }));
    onHistory.mockClear();

    expect(chat.requestHistory(51, 20)).toBe(true);
    expect(chat.requestHistory(51, 20)).toBe(false);
    expect(chat.isHistoryPending).toBe(true);
    expect(chat.packets).toEqual([
      {
        type: "METHOD",
        method: {
          name: CHAT_HISTORY_METHOD,
          payload: JSON.stringify({ before: 51, limit: 20 }),
        },
      },
    ]);

    chat.onMessage(
      reply({ before: 7, entries: [entry(3, "stale")], hasMore: true }),
    );
    expect(onHistory).not.toHaveBeenCalled();

    chat.onMessage(
      reply({
        before: 51,
        entries: [entry(31, "a"), entry(50, "b")],
        hasMore: false,
      }),
    );
    expect(chat.isHistoryPending).toBe(false);
    expect(onHistory).toHaveBeenCalledWith({
      entries: [entry(31, "a"), entry(50, "b")],
      hasMore: false,
      isJoin: false,
      before: 51,
    });
  });

  it("never asks for lines before the first one", () => {
    const chat = new Chat();
    expect(chat.requestHistory(1)).toBe(false);
    expect(chat.packets).toEqual([]);
  });

  it("a rejoin releases a request the old session left open", () => {
    const chat = new Chat();
    chat.onMessage(init({ entries: [], hasMore: false }));
    expect(chat.requestHistory(10)).toBe(true);
    chat.onMessage(init({ entries: [entry(9, "again")], hasMore: false }));
    expect(chat.isHistoryPending).toBe(false);
    expect(chat.requestHistory(9)).toBe(true);
  });
});
