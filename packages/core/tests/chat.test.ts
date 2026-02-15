import { ChatProtocol, MessageProtocol } from "@voxelize/protocol";
import { describe, expect, it, vi } from "vitest";
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

const initializeChatWithSymbol = (chat: Chat, commandSymbol: string) => {
  const initMessage: InitMessage = {
    type: "INIT",
    json: {
      options: {
        commandSymbol,
      },
    },
  };
  chat.onMessage(initMessage);
};

describe("Chat command parsing", () => {
  it("sends plain chat before init without throwing", () => {
    const chat = new Chat();
    const message: ChatProtocol = {
      type: "CLIENT",
      body: "hello before init",
    };

    expect(() => chat.send(message)).not.toThrow();
    expect(chat.packets).toEqual([
      {
        type: "CHAT",
        chat: message,
      },
    ]);
  });

  it("does not treat command-like input as command before init", () => {
    const chat = new Chat();
    const message: ChatProtocol = {
      type: "CLIENT",
      body: "/echo before init",
    };

    expect(() => chat.send(message)).not.toThrow();
    expect(chat.packets).toEqual([
      {
        type: "CHAT",
        chat: message,
      },
    ]);
  });

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

  it("parses single unquoted positional argument", () => {
    const chat = new Chat();
    initializeChat(chat);
    let parsed: { first: string } | null = null;

    chat.addCommand(
      "echo",
      (args) => {
        parsed = args;
      },
      {
        description: "Echo command",
        args: z.object({
          first: z.string(),
        }),
      }
    );

    const message: ChatProtocol = {
      type: "CLIENT",
      body: "/echo hello",
    };
    chat.send(message);

    expect(parsed).toEqual({ first: "hello" });
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

  it("parses unmatched quoted input without dropping trailing text", () => {
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
      body: `/echo hello "quoted segment`,
    };
    chat.send(message);

    expect(parsed).toEqual({ first: "hello", second: "quoted segment" });
  });

  it("parses tokens with quoted segments adjacent to text", () => {
    const chat = new Chat();
    initializeChat(chat);
    let parsed: { first: string } | null = null;

    chat.addCommand(
      "echo",
      (args) => {
        parsed = args;
      },
      {
        description: "Echo command",
        args: z.object({
          first: z.string(),
        }),
      }
    );

    const message: ChatProtocol = {
      type: "CLIENT",
      body: `/echo pre"quoted text"post`,
    };
    chat.send(message);

    expect(parsed).toEqual({ first: "prequoted textpost" });
  });

  it("parses commands with multi-character command symbols", () => {
    const chat = new Chat();
    initializeChatWithSymbol(chat, "::");
    let parsed: { first: string } | null = null;

    chat.addCommand(
      "echo",
      (args) => {
        parsed = args;
      },
      {
        description: "Echo command",
        args: z.object({
          first: z.string(),
        }),
      }
    );

    const message: ChatProtocol = {
      type: "CLIENT",
      body: "::echo hello",
    };
    chat.send(message);

    expect(parsed).toEqual({ first: "hello" });
  });

  it("parses command triggers and args separated by tab whitespace", () => {
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
      body: "/echo\thello\tworld",
    };
    chat.send(message);

    expect(parsed).toEqual({ first: "hello", second: "world" });
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

  it("ignores invalid aliases containing whitespace or empty strings", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      return;
    });
    try {
      const chat = new Chat();
      initializeChat(chat);
      let executions = 0;

      chat.addCommand(
        "echo",
        () => {
          executions++;
        },
        {
          description: "Alias validation",
          aliases: ["", "bad alias", "good"],
          args: z.object({}),
        }
      );

      chat.send({ type: "CLIENT", body: "/good" });
      chat.send({ type: "CLIENT", body: "/bad" });
      chat.send({ type: "CLIENT", body: "/echo" });

      expect(executions).toBe(2);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(chat.getAllCommands()).toEqual([
        expect.objectContaining({
          trigger: "echo",
          aliases: ["good"],
        }),
      ]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns copied alias and flag arrays from command listings", () => {
    const chat = new Chat();
    initializeChat(chat);

    chat.addCommand(
      "echo",
      () => {
        return;
      },
      {
        description: "Metadata copy safety",
        aliases: ["alias"],
        flags: ["f"],
        args: z.object({}),
      }
    );

    const firstListing = chat.getAllCommands();
    firstListing[0].aliases.push("mutated");
    firstListing[0].flags.push("mutated");

    expect(chat.getAllCommands()).toEqual([
      expect.objectContaining({
        trigger: "echo",
        aliases: ["alias"],
        flags: ["f"],
      }),
    ]);
  });

  it("removes primary command trigger together with its aliases", () => {
    const chat = new Chat();
    initializeChat(chat);
    let executions = 0;

    chat.addCommand(
      "echo",
      () => {
        executions++;
      },
      {
        description: "Primary removal",
        aliases: ["good", "alt"],
        args: z.object({}),
      }
    );

    chat.send({ type: "CLIENT", body: "/good" });
    expect(executions).toBe(1);

    expect(chat.removeCommand("echo")).toBe(true);

    chat.send({ type: "CLIENT", body: "/echo" });
    chat.send({ type: "CLIENT", body: "/good" });
    chat.send({ type: "CLIENT", body: "/alt" });
    expect(executions).toBe(1);
  });

  it("removes only the targeted alias when alias trigger is removed", () => {
    const chat = new Chat();
    initializeChat(chat);
    let executions = 0;

    chat.addCommand(
      "echo",
      () => {
        executions++;
      },
      {
        description: "Alias removal",
        aliases: ["good", "alt"],
        args: z.object({}),
      }
    );

    expect(chat.removeCommand("good")).toBe(true);
    expect(chat.getAllCommands()).toEqual([
      expect.objectContaining({
        trigger: "echo",
        aliases: ["alt"],
      }),
    ]);

    chat.send({ type: "CLIENT", body: "/good" });
    chat.send({ type: "CLIENT", body: "/alt" });
    chat.send({ type: "CLIENT", body: "/echo" });
    expect(executions).toBe(2);
  });
});
