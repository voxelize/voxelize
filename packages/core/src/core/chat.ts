import { ChatProtocol, MessageProtocol } from "@voxelize/transport/src/types";

import { NetIntercept } from "./network";

/**
 * A process that gets run when a command is triggered.
 */
export type CommandProcessor = (rest: string) => void;

/**
 * A network interceptor that gives flexible control over the chat feature of
 * the game. This also allows for custom commands to be added.
 *
 * # Example
 * ```ts
 * const chat = new VOXELIZE.Chat();
 *
 * // Listen to incoming chat messages.
 * chat.onChat = (chat: ChatMessage) => {
 *   console.log(chat);
 * };
 *
 * // Sending a chat message.
 * chat.send({
 *   type: "CLIENT",
 *   sender: "Mr. Robot",
 *   body: "Hello world!",
 * });
 *
 * // Register to the network.
 * network.register(chat);
 * ```
 *
 * ![Chat](/img/docs/chat.png)
 *
 * @category Core
 */
export class Chat implements NetIntercept {
  /**
   * A list of commands added by `addCommand`.
   */
  private commands: Map<string, CommandProcessor> = new Map();

  /**
   * An array of network packets that will be sent on `network.flush` calls.
   *
   * @hidden
   */
  public packets: MessageProtocol[] = [];

  /**
   * The symbol that is used to trigger commands.
   */
  private _commandSymbol: string;

  /**
   * Send a chat to the server.
   *
   * @param chat The chat message to send.
   */
  public send(chat: ChatProtocol) {
    if (chat.body.startsWith(this._commandSymbol)) {
      const words = chat.body
        .substring(this._commandSymbol.length)
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
  }

  public onChat: (chat: ChatProtocol) => void;

  /**
   * Add a command to the chat system. Commands are case sensitive.
   *
   * @param trigger - The text to trigger the command, needs to be one single word without spaces.
   * @param process - The process run when this command is triggered.
   */
  public addCommand(
    trigger: string,
    process: CommandProcessor,
    aliases: string[] = []
  ) {
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
  }

  /**
   * Remove a command from the chat system. Case sensitive.
   *
   * @param trigger - The trigger to remove.
   */
  public removeCommand(trigger: string) {
    return !!this.commands.delete(trigger);
  }

  /**
   * The network intercept implementation for chats.
   *
   * DO NOT CALL THIS METHOD OR CHANGE IT UNLESS YOU KNOW WHAT YOU ARE DOING.
   *
   * @hidden
   * @param message The message to intercept.
   */
  public onMessage = (message: MessageProtocol) => {
    switch (message.type) {
      case "INIT": {
        const { commandSymbol } = message.json.options;
        this._commandSymbol = commandSymbol;
        break;
      }
      case "CHAT": {
        const { chat } = message;
        this.onChat?.(chat);
        break;
      }
    }
  };

  /**
   * The symbol that is used to trigger commands.
   */
  get commandSymbol(): string {
    return this._commandSymbol;
  }
}
