import { ChatProtocol, MessageProtocol } from "@voxelize/protocol";

import { DOMUtils } from "../utils/dom-utils";

import { NetIntercept } from "./network";

/**
 * A process that gets run when a command is triggered.
 */
export type CommandProcessor = (rest: string) => void;

/**
 * Options for adding a command.
 */
export type CommandOptions = {
  description?: string;
  category?: string;
  aliases?: string[];
};

/**
 * Information about a command including its processor and documentation.
 */
export type CommandInfo = {
  process: CommandProcessor;
  description: string;
  category?: string;
  aliases: string[];
};

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
export class Chat<T extends ChatProtocol = ChatProtocol>
  implements NetIntercept
{
  /**
   * A list of commands added by `addCommand`.
   */
  private commands: Map<string, CommandInfo> = new Map();

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
  private _commandSymbolCode: string;

  private fallbackCommand: CommandProcessor | null = null;

  /**
   * Send a chat to the server.
   *
   * @param chat The chat message to send.
   */
  public send(chat: T) {
    if (chat.body.startsWith(this._commandSymbol)) {
      const words = chat.body
        .substring(this._commandSymbol.length)
        .split(" ")
        .filter(Boolean);
      const trigger = words.shift();
      const rest = words.join(" ");

      const commandInfo = this.commands.get(trigger);

      if (commandInfo) {
        commandInfo.process(rest.trim());

        this.packets.push({
          type: "EVENT",
          events: [
            {
              name: "command_executed",
              payload: JSON.stringify({
                command: trigger,
                args: rest.trim(),
                fullCommand: chat.body,
              }),
            },
          ],
        });
        return;
      }

      if (this.fallbackCommand) {
        this.fallbackCommand(
          chat.body.substring(this._commandSymbol.length).trim()
        );
      }
    }

    this.packets.push({
      type: "CHAT",
      chat,
    });
  }

  public onChat: (chat: T) => void;

  /**
   * Add a command to the chat system. Commands are case sensitive.
   *
   * @param trigger - The text to trigger the command, needs to be one single word without spaces.
   * @param process - The process run when this command is triggered.
   * @param options - Optional configuration for the command (description, category, aliases).
   */
  public addCommand(
    trigger: string,
    process: CommandProcessor,
    options: CommandOptions = {}
  ): () => void {
    if (this.commands.has(trigger)) {
      throw new Error(`Command trigger already taken: ${trigger}`);
    }

    if (trigger.split(" ").length > 1) {
      throw new Error("Command trigger must be one word.");
    }

    const commandInfo: CommandInfo = {
      process,
      description: options.description || "",
      category: options.category,
      aliases: options.aliases || [],
    };

    this.commands.set(trigger, commandInfo);

    for (const alias of commandInfo.aliases) {
      if (this.commands.has(alias)) {
        console.warn(
          `Command alias for "${trigger}", "${alias}" ignored as already taken.`
        );
        continue;
      }

      // Store reference to the same command info for aliases
      this.commands.set(alias, commandInfo);
    }

    return () => {
      this.commands.delete(trigger);
      commandInfo.aliases.forEach((alias) => this.commands.delete(alias));
    };
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
        this._commandSymbolCode = DOMUtils.mapKeyToCode(commandSymbol);
        break;
      }
      case "CHAT": {
        const { chat } = message;
        this.onChat?.(chat as T);
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

  get commandSymbolCode(): string {
    return this._commandSymbolCode;
  }

  /**
   * Set a fallback command to be executed when no matching command is found.
   *
   * @param fallback - The fallback command processor.
   */
  public setFallbackCommand(fallback: CommandProcessor) {
    this.fallbackCommand = fallback;
  }

  /**
   * Get all registered commands with their documentation.
   * This filters out aliases and returns only the primary command triggers.
   *
   * @returns An array of command triggers with their descriptions, categories, and aliases.
   */
  public getAllCommands(): Array<{
    trigger: string;
    description: string;
    category?: string;
    aliases: string[];
  }> {
    const uniqueCommands = new Map<CommandInfo, string>();

    // First pass: collect unique commands with their primary trigger
    this.commands.forEach((commandInfo, trigger) => {
      if (!uniqueCommands.has(commandInfo)) {
        uniqueCommands.set(commandInfo, trigger);
      }
    });

    // Second pass: build the result array
    const result: Array<{
      trigger: string;
      description: string;
      category?: string;
      aliases: string[];
    }> = [];
    uniqueCommands.forEach((primaryTrigger, commandInfo) => {
      result.push({
        trigger: primaryTrigger,
        description: commandInfo.description,
        category: commandInfo.category,
        aliases: commandInfo.aliases,
      });
    });

    return result.sort((a, b) => a.trigger.localeCompare(b.trigger));
  }
}
