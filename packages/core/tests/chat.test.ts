import { ChatProtocol, MessageProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Chat } from "../src/core/chat";

type InitMessage = MessageProtocol<
  { options: { commandSymbol: string } },
  never,
  never,
  never,
  never
>;

const initializeChat = (chat: Chat) => {
  const initMessage: InitMessage = {
    type: "INIT",
    json: {
      options: {
        commandSymbol: "/",
      },
    },
  };
  chat.onMessage(initMessage);
};

describe("Chat command parsing", () => {
  it("parses unquoted positional arguments with repeated spaces", () => {
    const chat = new Chat();
    initializeChat(chat);
    let parsed: { first: string; second?: string } | null = null;

    chat.addCommand(
      "echo",
      (args) => {
        parsed = args;
      },
      {
        description: "Echo command",
        args: z.object({
          first: z.string(),
          second: z.string().optional(),
        }),
      }
    );

    const message: ChatProtocol = {
      type: "CLIENT",
      body: "/echo    hello      world",
    };
    chat.send(message);

    expect(parsed).toEqual({ first: "hello", second: "world" });
  });

  it("parses quoted positional arguments with embedded spaces", () => {
    const chat = new Chat();
    initializeChat(chat);
    let parsed: { first: string; second?: string } | null = null;

    chat.addCommand(
      "echo",
      (args) => {
        parsed = args;
      },
      {
        description: "Echo command",
        args: z.object({
          first: z.string(),
          second: z.string().optional(),
        }),
      }
    );

    const message: ChatProtocol = {
      type: "CLIENT",
      body: `/echo "hello world" test`,
    };
    chat.send(message);

    expect(parsed).toEqual({ first: "hello world", second: "test" });
  });

  it("parses boolean-only schemas without positional token buffering", () => {
    const chat = new Chat();
    initializeChat(chat);
    let parsed: { verbose?: boolean; dryRun?: boolean } | null = null;

    chat.addCommand(
      "echo",
      (args) => {
        parsed = args;
      },
      {
        description: "Echo command",
        args: z.object({
          verbose: z.coerce.boolean().optional(),
          dryRun: z.coerce.boolean().optional(),
        }),
      }
    );

    const message: ChatProtocol = {
      type: "CLIENT",
      body: "/echo verbose dryRun ignored-token",
    };
    chat.send(message);

    expect(parsed).toEqual({ verbose: true, dryRun: true });
  });
});

describe("Chat command registration", () => {
  it("rejects empty command triggers", () => {
    const chat = new Chat();
    initializeChat(chat);

    expect(() =>
      chat.addCommand(
        "",
        () => {
          return;
        },
        {
          description: "Empty trigger",
          args: z.object({}),
        }
      )
    ).toThrow("Command trigger must not be empty.");
  });

  it("rejects command triggers containing non-space whitespace", () => {
    const chat = new Chat();
    initializeChat(chat);

    expect(() =>
      chat.addCommand(
        "bad\ttrigger",
        () => {
          return;
        },
        {
          description: "Invalid trigger",
          args: z.object({}),
        }
      )
    ).toThrow("Command trigger must be one word.");
  });
});
