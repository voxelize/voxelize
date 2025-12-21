import { ChatProtocol, MessageProtocol } from "@voxelize/protocol";
import { z, ZodError, ZodObject, ZodOptional, ZodTypeAny } from "zod";

import { DOMUtils } from "../utils/dom-utils";

import { NetIntercept } from "./network";

/**
 * Options for adding a command.
 */
export type CommandOptions<
  T extends ZodObject<Record<string, ZodTypeAny>> = ZodObject<
    Record<string, never>
  >
> = {
  description: string;
  category?: string;
  aliases?: string[];
  flags?: string[];
  args?: T;
};

/**
 * Information about a command including its processor and documentation.
 */
export type CommandInfo<
  T extends ZodObject<Record<string, ZodTypeAny>> = ZodObject<
    Record<string, never>
  >
> = {
  process: (args: z.infer<T>) => void;
  description: string;
  category?: string;
  aliases: string[];
  flags: string[];
  args: T;
};

/**
 * Metadata extracted from a Zod schema for UI purposes.
 */
export type ArgMetadata = {
  name: string;
  type: "string" | "number" | "enum" | "boolean";
  required: boolean;
  options?: string[];
  defaultValue?: string | number | boolean;
};

/**
 * Schema for commands that take a free-form string input.
 * Use this for commands that need the raw rest string.
 */
export const restArgsSchema = z.object({
  rest: z.string().optional(),
});

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
  private commands: Map<
    string,
    CommandInfo<ZodObject<Record<string, ZodTypeAny>>>
  > = new Map();

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

  private fallbackCommand: ((rest: string) => void) | null = null;

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
        try {
          const parsedArgs = this.parseArgs(rest.trim(), commandInfo.args);
          commandInfo.process(parsedArgs);

          this.packets.push({
            type: "EVENT",
            events: [
              {
                name: "command_executed",
                payload: JSON.stringify({
                  command: trigger,
                  args: parsedArgs,
                  fullCommand: chat.body,
                }),
              },
            ],
          });
        } catch (error) {
          if (this.onChat) {
            const errorMessage = this.formatCommandError(
              error,
              trigger,
              commandInfo
            );
            this.onChat({
              type: "SYSTEM",
              body: errorMessage,
            } as T);
          }
        }
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

  private parseArgs<T extends ZodObject<Record<string, ZodTypeAny>>>(
    raw: string,
    schema: T
  ): z.infer<T> {
    const shape = schema.shape;
    const keys = Object.keys(shape);

    if (keys.length === 1 && keys[0] === "rest") {
      return schema.parse({ rest: raw });
    }

    const words = raw.split(" ").filter(Boolean);
    const rawObj: Record<string, string> = {};
    const keySet = new Set(keys);
    const assignedKeys = new Set<string>();
    const positionalValues: string[] = [];

    const booleanKeys = new Set<string>();
    for (const key of keys) {
      let innerType = shape[key] as ZodTypeAny;
      if (this.isOptionalSchema(innerType)) {
        innerType = innerType.unwrap();
      }
      if (this.isBooleanSchema(innerType)) {
        booleanKeys.add(key);
      }
    }

    for (const word of words) {
      const eqIndex = word.indexOf("=");
      if (eqIndex > 0) {
        const key = word.substring(0, eqIndex);
        const value = word.substring(eqIndex + 1);
        if (keySet.has(key)) {
          rawObj[key] = value;
          assignedKeys.add(key);
          continue;
        }
      }

      if (booleanKeys.has(word)) {
        rawObj[word] = "true";
        assignedKeys.add(word);
        continue;
      }

      positionalValues.push(word);
    }

    let posIndex = 0;
    for (const key of keys) {
      if (assignedKeys.has(key)) continue;
      if (booleanKeys.has(key)) continue;
      if (posIndex < positionalValues.length) {
        rawObj[key] = positionalValues[posIndex];
        posIndex++;
      }
    }

    return schema.parse(rawObj);
  }

  private formatCommandError(
    error: unknown,
    trigger: string,
    commandInfo: CommandInfo<ZodObject<Record<string, ZodTypeAny>>>
  ): string {
    const argMetadata = this.extractArgMetadata(commandInfo.args);
    const usageArgs = argMetadata
      .map((arg) => {
        if (arg.type === "boolean") {
          return `[${arg.name}]`;
        }
        return arg.required ? `<${arg.name}=>` : `[${arg.name}=]`;
      })
      .join(" ");
    const usage = `Usage: ${this._commandSymbol}${trigger}${
      usageArgs ? ` ${usageArgs}` : ""
    }`;

    if (error instanceof ZodError) {
      const errorLines: string[] = [];

      for (const issue of error.issues) {
        const fieldName = String(issue.path[0] ?? "argument");
        const argMeta = argMetadata.find((a) => a.name === fieldName);

        if (argMeta?.type === "enum" && argMeta.options) {
          const options = argMeta.options;
          if (options.length <= 6) {
            errorLines.push(
              `$#FF6B6B$Invalid ${fieldName}. Valid options: $white$${options.join(
                ", "
              )}`
            );
          } else {
            errorLines.push(
              `$#FF6B6B$Invalid ${fieldName}. Valid: $white$${options
                .slice(0, 5)
                .join(", ")}$#FF6B6B$ (+${options.length - 5} more)`
            );
          }
        } else if (argMeta?.required && issue.message.includes("Required")) {
          errorLines.push(
            `$#FF6B6B$Missing required argument: $white$<${fieldName}>`
          );
        } else {
          errorLines.push(`$#FF6B6B$${fieldName}: $white$${issue.message}`);
        }
      }

      return `${errorLines.join("\n")}\n$#888888$${usage}`;
    }

    return `$#FF6B6B$Command error: $white$${
      error instanceof Error ? error.message : String(error)
    }\n$#888888$${usage}`;
  }

  public onChat: (chat: T) => void;

  private static readonly emptySchema = z.object({});

  /**
   * Add a command to the chat system. Commands are case sensitive.
   *
   * @param trigger - The text to trigger the command, needs to be one single word without spaces.
   * @param process - The process run when this command is triggered, receives parsed typed args.
   * @param options - Configuration for the command including Zod schema for args.
   */
  public addCommand<
    T extends ZodObject<Record<string, ZodTypeAny>> = ZodObject<
      Record<string, never>
    >
  >(
    trigger: string,
    process: (args: z.infer<T>) => void,
    options: CommandOptions<T>
  ): () => void {
    if (this.commands.has(trigger)) {
      throw new Error(`Command trigger already taken: ${trigger}`);
    }

    if (trigger.split(" ").length > 1) {
      throw new Error("Command trigger must be one word.");
    }

    const commandInfo: CommandInfo<T> = {
      process,
      description: options.description,
      category: options.category,
      aliases: options.aliases || [],
      flags: options.flags || [],
      args: (options.args ?? Chat.emptySchema) as T,
    };

    this.commands.set(
      trigger,
      commandInfo as CommandInfo<ZodObject<Record<string, ZodTypeAny>>>
    );

    for (const alias of commandInfo.aliases) {
      if (this.commands.has(alias)) {
        console.warn(
          `Command alias for "${trigger}", "${alias}" ignored as already taken.`
        );
        continue;
      }

      this.commands.set(
        alias,
        commandInfo as CommandInfo<ZodObject<Record<string, ZodTypeAny>>>
      );
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
  public setFallbackCommand(fallback: (rest: string) => void) {
    this.fallbackCommand = fallback;
  }

  private isOptionalSchema(
    schema: ZodTypeAny
  ): schema is ZodOptional<ZodTypeAny> {
    return "unwrap" in schema && typeof schema.unwrap === "function";
  }

  private isEnumSchema(
    schema: ZodTypeAny
  ): schema is ZodTypeAny & { options: string[] } {
    return "options" in schema && Array.isArray(schema.options);
  }

  private isNumberSchema(schema: ZodTypeAny): boolean {
    const result = schema.safeParse(123);
    if (!result.success) return false;
    const stringResult = schema.safeParse("not_a_number_string_xyz");
    return !stringResult.success;
  }

  private isBooleanSchema(schema: ZodTypeAny): boolean {
    const trueResult = schema.safeParse(true);
    const falseResult = schema.safeParse(false);
    if (!trueResult.success || !falseResult.success) return false;
    if (trueResult.data !== true || falseResult.data !== false) return false;
    const stringResult = schema.safeParse("not_a_boolean_string_xyz");
    return !stringResult.success;
  }

  private hasDefault(schema: ZodTypeAny): boolean {
    const def = schema._def as unknown as Record<string, unknown> | undefined;
    return def !== undefined && "defaultValue" in def;
  }

  private getDefaultValue(schema: ZodTypeAny): string | number | undefined {
    if (!this.hasDefault(schema)) return undefined;
    const def = schema._def as unknown as {
      defaultValue?: string | number | (() => string | number);
    };
    if (typeof def.defaultValue === "function") {
      return def.defaultValue();
    }
    return def.defaultValue;
  }

  private extractArgMetadata(
    schema: ZodObject<Record<string, ZodTypeAny>> | undefined
  ): ArgMetadata[] {
    if (!schema) {
      return [];
    }

    const result: ArgMetadata[] = [];

    for (const [name, zodType] of Object.entries(schema.shape)) {
      let innerType = zodType as ZodTypeAny;
      let required = true;
      let defaultValue: string | number | undefined;

      if (this.hasDefault(innerType)) {
        required = false;
        defaultValue = this.getDefaultValue(innerType);
        const def = innerType._def as unknown as {
          innerType?: ZodTypeAny;
          type?: ZodTypeAny;
        };
        if (def.innerType) {
          innerType = def.innerType;
        } else if (def.type) {
          innerType = def.type;
        }
      }

      if (this.isOptionalSchema(innerType)) {
        required = false;
        innerType = innerType.unwrap();
      }

      if (this.isEnumSchema(innerType)) {
        result.push({
          name,
          type: "enum",
          required,
          options: innerType.options as string[],
          defaultValue,
        });
      } else if (this.isBooleanSchema(innerType)) {
        result.push({ name, type: "boolean", required, defaultValue });
      } else if (this.isNumberSchema(innerType)) {
        result.push({ name, type: "number", required, defaultValue });
      } else {
        result.push({ name, type: "string", required, defaultValue });
      }
    }

    return result;
  }

  /**
   * Get all registered commands with their documentation.
   * This filters out aliases and returns only the primary command triggers.
   *
   * @returns An array of command triggers with their descriptions, categories, aliases, and arg schemas.
   */
  public getAllCommands(): Array<{
    trigger: string;
    description: string;
    category?: string;
    aliases: string[];
    flags: string[];
    args: ArgMetadata[];
  }> {
    const uniqueCommands = new Map<
      CommandInfo<ZodObject<Record<string, ZodTypeAny>>>,
      string
    >();

    this.commands.forEach((commandInfo, trigger) => {
      if (!uniqueCommands.has(commandInfo)) {
        uniqueCommands.set(commandInfo, trigger);
      }
    });

    const result: Array<{
      trigger: string;
      description: string;
      category?: string;
      aliases: string[];
      flags: string[];
      args: ArgMetadata[];
    }> = [];
    uniqueCommands.forEach((primaryTrigger, commandInfo) => {
      result.push({
        trigger: primaryTrigger,
        description: commandInfo.description,
        category: commandInfo.category,
        aliases: commandInfo.aliases,
        flags: commandInfo.flags,
        args: commandInfo.args ? this.extractArgMetadata(commandInfo.args) : [],
      });
    });

    return result.sort((a, b) => a.trigger.localeCompare(b.trigger));
  }
}
