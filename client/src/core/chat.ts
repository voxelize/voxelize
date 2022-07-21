import { MessageProtocol, ChatProtocol } from "@voxelize/transport/src/types";

import { NetIntercept } from "./network";

/**
 * A process that gets run when a command is triggered.
 */
export type CommandProcessor = (rest: string) => void;

export class Chat implements NetIntercept {
  private commands: Map<string, CommandProcessor> = new Map();

  public packets: MessageProtocol[] = [];

  constructor(public commandSymbol = "/") {}

  send = (chat: ChatProtocol) => {
    if (chat.body.startsWith(this.commandSymbol)) {
      const words = chat.body
        .substring(this.commandSymbol.length)
        .split(" ")
        .filter(Boolean);
      const trigger = words.shift();
      const rest = words.join(" ");

      const process = this.commands.get(trigger);

      if (process) {
        process(rest.trim());
        return;
      }
    }

    this.packets.push({
      type: "CHAT",
      chat,
    });
  };

  onChat: (chat: ChatProtocol) => void;

  /**
   * Add a command to the chat system. Commands are case sensitive.
   *
   * @param trigger - The text to trigger the command, needs to be one single word without spaces.
   * @param process - The process run when this command is triggered.
   */
  addCommand = (
    trigger: string,
    process: CommandProcessor,
    aliases: string[] = []
  ) => {
    if (this.commands.has(trigger)) {
      throw new Error(`Command trigger already taken: ${trigger}`);
    }

    if (trigger.split(" ").length > 1) {
      throw new Error("Command trigger must be one word.");
    }

    this.commands.set(trigger, process);

    for (const alias of aliases) {
      if (this.commands.has(alias)) {
        console.warn(
          `Command alias for "${trigger}", "${alias}" ignored as already taken.`
        );
        continue;
      }

      this.commands.set(alias, process);
    }
  };

  /**
   * Remove a command from the chat system. Case sensitive.
   *
   * @param trigger - The trigger to remove.
   */
  removeCommand = (trigger: string) => {
    return !!this.commands.delete(trigger);
  };

  onMessage = (message: MessageProtocol) => {
    if (message.type !== "CHAT") return;

    const { chat } = message;
    this.onChat?.(chat);
  };
}
