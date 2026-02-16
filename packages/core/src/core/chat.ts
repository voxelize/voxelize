import { ChatProtocol, MessageProtocol } from "@voxelize/protocol";
import { z, ZodError, ZodObject, ZodOptional, ZodTypeAny } from "zod";

import { DOMUtils } from "../utils/dom-utils";
import { JsonValue } from "../types";

import { NetIntercept } from "./network";

type CommandErrorValue = Error | JsonValue | object;
const isWhitespaceCode = (code: number) =>
  code === 32 || (code >= 9 && code <= 13);
const containsWhitespace = (value: string) => {
  const length = value.length;
  for (let index = 0; index < length; index++) {
    if (isWhitespaceCode(value.charCodeAt(index))) {
      return true;
    }
  }
  return false;
};
const containsEquals = (value: string) => {
  const length = value.length;
  for (let index = 0; index < length; index++) {
    if (value.charCodeAt(index) === 61) {
      return true;
    }
  }
  return false;
};
const getFirstEqualsIndex = (value: string) => {
  const length = value.length;
  for (let index = 1; index < length; index++) {
    if (value.charCodeAt(index) === 61) {
      return index;
    }
  }
  return -1;
};
const assignParsedArg = (
  rawObj: Record<string, string>,
  rawObjKeys: string[],
  key: string,
  value: string
) => {
  if (rawObj[key] === undefined) {
    rawObjKeys.push(key);
  }
  rawObj[key] = value;
};

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
  tabComplete?: Partial<Record<keyof z.infer<T>, () => string[]>>;
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
  tabComplete: Partial<Record<string, () => string[]>>;
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
  tabComplete?: () => string[];
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
  private _commandSymbol = "";
  private _commandSymbolCode = "";
  private _commandSymbolLength = 0;
  private _commandSymbolFirstCode = -1;

  private fallbackCommand: ((rest: string) => void) | null = null;
  private quotedTokensBuffer: string[] = [];
  private positionalValuesBuffer: string[] = [];
  private parsedArgsObjectBuffer: Record<string, string> = {};
  private parsedArgsObjectKeysBuffer: string[] = [];
  private parsedCommandTrigger = "";
  private parsedCommandRest = "";
  private parseSchemaInfoBySchema = new WeakMap<
    ZodObject<Record<string, ZodTypeAny>>,
    {
      keys: string[];
      keySet: Set<string>;
      booleanKeys: Set<string>;
      positionalKeys: string[];
      isRestOnly: boolean;
    }
  >();

  /**
   * Send a chat to the server.
   *
   * @param chat The chat message to send.
   */
  public send(chat: T) {
    const body = chat.body;
    const commandSymbol = this._commandSymbol;
    const commandBodyStart = this._commandSymbolLength;
    const commandSymbolFirstCode = this._commandSymbolFirstCode;
    const isCommand =
      commandSymbolFirstCode >= 0
        ? body.charCodeAt(0) === commandSymbolFirstCode
        : commandBodyStart > 1 &&
          body.length >= commandBodyStart &&
          body.charCodeAt(0) === commandSymbol.charCodeAt(0) &&
          body.startsWith(commandSymbol);
    if (isCommand) {
      this.parseCommandBody(body, commandBodyStart);
      const trigger = this.parsedCommandTrigger || undefined;
      const rest = this.parsedCommandRest;

      const commandInfo = this.commands.get(trigger);

      if (commandInfo) {
        try {
          const parsedArgs = this.parseArgs(rest, commandInfo.args);
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
              error as CommandErrorValue,
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
        const commandBodyLength = body.length - commandBodyStart;
        const shouldTrim =
          commandBodyLength > 0 &&
          (isWhitespaceCode(body.charCodeAt(commandBodyStart)) ||
            isWhitespaceCode(body.charCodeAt(body.length - 1)));
        const commandBody = body.substring(commandBodyStart);
        this.fallbackCommand(shouldTrim ? commandBody.trim() : commandBody);
      }
    }

    this.packets.push({
      type: "CHAT",
      chat,
    });
  }

  private parseCommandBody(raw: string, startIndex = 0) {
    const length = raw.length;
    let triggerStart = startIndex;

    if (
      triggerStart < length &&
      isWhitespaceCode(raw.charCodeAt(triggerStart))
    ) {
      do {
        triggerStart++;
      } while (
        triggerStart < length &&
        isWhitespaceCode(raw.charCodeAt(triggerStart))
      );
    }

    if (triggerStart >= length) {
      this.parsedCommandTrigger = "";
      this.parsedCommandRest = "";
      return;
    }

    let triggerEnd = triggerStart;
    while (
      triggerEnd < length &&
      !isWhitespaceCode(raw.charCodeAt(triggerEnd))
    ) {
      triggerEnd++;
    }
    if (triggerEnd === length) {
      this.parsedCommandTrigger =
        triggerStart === 0 ? raw : raw.substring(triggerStart);
      this.parsedCommandRest = "";
      return;
    }
    this.parsedCommandTrigger = raw.substring(triggerStart, triggerEnd);

    let restStart = triggerEnd + 1;
    if (restStart < length && isWhitespaceCode(raw.charCodeAt(restStart))) {
      do {
        restStart++;
      } while (
        restStart < length &&
        isWhitespaceCode(raw.charCodeAt(restStart))
      );
    }

    this.parsedCommandRest = restStart < length ? raw.substring(restStart) : "";
  }

  private splitQuotedTokens(raw: string): string[] {
    const tokens = this.quotedTokensBuffer;
    tokens.length = 0;
    const length = raw.length;
    if (length === 0) {
      return tokens;
    }
    let firstSpecialIndex = -1;
    for (let index = 0; index < length; index++) {
      const code = raw.charCodeAt(index);
      if (code === 34 || code === 39 || isWhitespaceCode(code)) {
        firstSpecialIndex = index;
        break;
      }
    }
    if (firstSpecialIndex === -1) {
      tokens.push(raw);
      return tokens;
    }
    let current = "";
    let tokenScanStart = firstSpecialIndex;
    if (tokenScanStart > 0) {
      current = raw.substring(0, tokenScanStart);
    }
    let quoteCharCode = 0;
    let segmentStart = -1;
    let sawWhitespace = false;
    let sawQuote = false;

    for (let i = tokenScanStart; i < length; i++) {
      const code = raw.charCodeAt(i);

      if (quoteCharCode !== 0) {
        if (code === quoteCharCode) {
          if (segmentStart >= 0) {
            current += raw.substring(segmentStart, i);
            segmentStart = -1;
          }
          quoteCharCode = 0;
        }
        continue;
      }

      if (code === 34 || code === 39) {
        sawQuote = true;
        if (segmentStart >= 0) {
          current += raw.substring(segmentStart, i);
        }
        quoteCharCode = code;
        segmentStart = i + 1;
        continue;
      }

      if (isWhitespaceCode(code)) {
        sawWhitespace = true;
        if (segmentStart >= 0) {
          current += raw.substring(segmentStart, i);
          segmentStart = -1;
        }
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      if (segmentStart < 0) {
        segmentStart = i;
      }
    }

    if (segmentStart >= 0) {
      current += raw.substring(segmentStart, length);
    }

    if (current) {
      tokens.push(current);
    }

    if (
      !sawQuote &&
      !sawWhitespace &&
      tokens.length === 1 &&
      tokens[0].length === length
    ) {
      tokens[0] = raw;
    }

    return tokens;
  }

  private getParseSchemaInfo<T extends ZodObject<Record<string, ZodTypeAny>>>(
    schema: T
  ): {
    keys: string[];
    keySet: Set<string>;
    booleanKeys: Set<string>;
    positionalKeys: string[];
    isRestOnly: boolean;
  } {
    const cached = this.parseSchemaInfoBySchema.get(schema);
    if (cached) {
      return cached;
    }

    const shape = schema.shape;
    const hasOwn = Object.prototype.hasOwnProperty;
    const keys: string[] = [];
    const keySet = new Set<string>();
    const booleanKeys = new Set<string>();
    const positionalKeys: string[] = [];

    for (const key in shape) {
      if (!hasOwn.call(shape, key)) {
        continue;
      }
      keys.push(key);
      keySet.add(key);

      let innerType = shape[key] as ZodTypeAny;
      if (this.isOptionalSchema(innerType)) {
        innerType = innerType.unwrap();
      }
      if (this.hasDefault(innerType)) {
        const def = (
          innerType as ZodTypeAny & { _def: { innerType: ZodTypeAny } }
        )._def;
        innerType = def.innerType;
      }
      if (this.isBooleanSchema(innerType)) {
        booleanKeys.add(key);
      } else {
        positionalKeys.push(key);
      }
    }

    const isRestOnly = keys.length === 1 && keys[0] === "rest";
    const info = { keys, keySet, booleanKeys, positionalKeys, isRestOnly };
    this.parseSchemaInfoBySchema.set(schema, info);
    return info;
  }

  private parseArgs<T extends ZodObject<Record<string, ZodTypeAny>>>(
    raw: string,
    schema: T
  ): z.infer<T> {
    const { keys, keySet, booleanKeys, positionalKeys, isRestOnly } =
      this.getParseSchemaInfo(schema);

    if (isRestOnly) {
      const rawLength = raw.length;
      const shouldTrim =
        rawLength > 0 &&
        (isWhitespaceCode(raw.charCodeAt(0)) ||
          isWhitespaceCode(raw.charCodeAt(rawLength - 1)));
      return schema.parse({ rest: shouldTrim ? raw.trim() : raw });
    }
    if (keys.length === 0) {
      return schema.parse({});
    }

    if (raw.length === 0) {
      return schema.parse({});
    }

    const words = this.splitQuotedTokens(raw);
    const wordsLength = words.length;
    if (wordsLength === 0) {
      return schema.parse({});
    }
    const rawObj = this.parsedArgsObjectBuffer;
    const rawObjKeys = this.parsedArgsObjectKeysBuffer;
    const rawObjKeysLength = rawObjKeys.length;
    if (rawObjKeysLength > 0) {
      for (let index = 0; index < rawObjKeysLength; index++) {
        delete rawObj[rawObjKeys[index]];
      }
    }
    rawObjKeys.length = 0;
    const positionalValues = this.positionalValuesBuffer;
    positionalValues.length = 0;
    const hasPositionalKeys = positionalKeys.length > 0;
    const hasBooleanKeys = booleanKeys.size > 0;
    const hasEquals = containsEquals(raw);

    if (!hasBooleanKeys && !hasEquals) {
      const assignCount =
        wordsLength < positionalKeys.length ? wordsLength : positionalKeys.length;
      for (let keyIndex = 0; keyIndex < assignCount; keyIndex++) {
        const key = positionalKeys[keyIndex];
        assignParsedArg(rawObj, rawObjKeys, key, words[keyIndex]);
      }
      return schema.parse(rawObj);
    }

    if (!hasBooleanKeys) {
      for (let wordIndex = 0; wordIndex < wordsLength; wordIndex++) {
        const word = words[wordIndex];
        const eqIndex = getFirstEqualsIndex(word);
        if (eqIndex > 0) {
          const key = word.substring(0, eqIndex);
          if (keySet.has(key)) {
            const value = word.substring(eqIndex + 1);
            assignParsedArg(rawObj, rawObjKeys, key, value);
            continue;
          }
        }
        positionalValues.push(word);
      }
    } else if (!hasPositionalKeys) {
      if (!hasEquals) {
        for (let wordIndex = 0; wordIndex < wordsLength; wordIndex++) {
          const word = words[wordIndex];
          if (booleanKeys.has(word)) {
            assignParsedArg(rawObj, rawObjKeys, word, "true");
          }
        }
      } else {
        for (let wordIndex = 0; wordIndex < wordsLength; wordIndex++) {
          const word = words[wordIndex];
          if (booleanKeys.has(word)) {
            assignParsedArg(rawObj, rawObjKeys, word, "true");
            continue;
          }
          const eqIndex = getFirstEqualsIndex(word);
          if (eqIndex > 0) {
            const key = word.substring(0, eqIndex);
            if (keySet.has(key)) {
              const value = word.substring(eqIndex + 1);
              assignParsedArg(rawObj, rawObjKeys, key, value);
            }
          }
        }
      }
    } else {
      if (!hasEquals) {
        for (let wordIndex = 0; wordIndex < wordsLength; wordIndex++) {
          const word = words[wordIndex];
          if (booleanKeys.has(word)) {
            assignParsedArg(rawObj, rawObjKeys, word, "true");
          } else {
            positionalValues.push(word);
          }
        }
      } else {
        for (let wordIndex = 0; wordIndex < wordsLength; wordIndex++) {
          const word = words[wordIndex];
          if (booleanKeys.has(word)) {
            assignParsedArg(rawObj, rawObjKeys, word, "true");
            continue;
          }
          const eqIndex = getFirstEqualsIndex(word);
          if (eqIndex > 0) {
            const key = word.substring(0, eqIndex);
            if (keySet.has(key)) {
              const value = word.substring(eqIndex + 1);
              assignParsedArg(rawObj, rawObjKeys, key, value);
              continue;
            }
          }
          positionalValues.push(word);
        }
      }
    }

    let posIndex = 0;
    for (let keyIndex = 0; keyIndex < positionalKeys.length; keyIndex++) {
      const key = positionalKeys[keyIndex];
      if (rawObj[key] !== undefined) continue;
      if (posIndex < positionalValues.length) {
        assignParsedArg(rawObj, rawObjKeys, key, positionalValues[posIndex]);
        posIndex++;
      }
    }

    return schema.parse(rawObj);
  }

  private formatCommandError(
    error: CommandErrorValue,
    trigger: string,
    commandInfo: CommandInfo<ZodObject<Record<string, ZodTypeAny>>>
  ): string {
    const argMetadata = this.extractArgMetadata(commandInfo.args);
    let usageArgs = "";
    for (let argIndex = 0; argIndex < argMetadata.length; argIndex++) {
      const arg = argMetadata[argIndex];
      if (argIndex > 0) {
        usageArgs += " ";
      }
      if (arg.type === "boolean") {
        usageArgs += `[${arg.name}]`;
      } else {
        usageArgs += arg.required ? `<${arg.name}=>` : `[${arg.name}=]`;
      }
    }
    const usage = `Usage: ${this._commandSymbol}${trigger}${
      usageArgs ? ` ${usageArgs}` : ""
    }`;

    if (error instanceof ZodError) {
      const errorLines: string[] = [];
      const argMetadataByName = new Map<string, ArgMetadata>();
      for (let argIndex = 0; argIndex < argMetadata.length; argIndex++) {
        const arg = argMetadata[argIndex];
        argMetadataByName.set(arg.name, arg);
      }

      for (let issueIndex = 0; issueIndex < error.issues.length; issueIndex++) {
        const issue = error.issues[issueIndex];
        const fieldName = String(issue.path[0] ?? "argument");
        const argMeta = argMetadataByName.get(fieldName);

        if (argMeta?.type === "enum" && argMeta.options) {
          const options = argMeta.options;
          if (options.length <= 6) {
            let allOptions = "";
            for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
              if (optionIndex > 0) {
                allOptions += ", ";
              }
              allOptions += options[optionIndex];
            }
            errorLines.push(
              `$#FF6B6B$Invalid ${fieldName}. Valid options: $white$${allOptions}`
            );
          } else {
            let preview = "";
            const previewCount = 5;
            for (
              let optionIndex = 0;
              optionIndex < previewCount && optionIndex < options.length;
              optionIndex++
            ) {
              if (optionIndex > 0) {
                preview += ", ";
              }
              preview += options[optionIndex];
            }
            errorLines.push(
              `$#FF6B6B$Invalid ${fieldName}. Valid: $white$${preview}$#FF6B6B$ (+${options.length - 5} more)`
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
    if (trigger.length === 0) {
      throw new Error("Command trigger must not be empty.");
    }
    if (this.commands.has(trigger)) {
      throw new Error(`Command trigger already taken: ${trigger}`);
    }

    if (containsWhitespace(trigger)) {
      throw new Error("Command trigger must be one word.");
    }

    const aliases = options.aliases || [];
    const commandInfo: CommandInfo<T> = {
      process,
      description: options.description,
      category: options.category,
      aliases: [],
      flags: options.flags || [],
      args: (options.args ?? Chat.emptySchema) as T,
      tabComplete:
        (options.tabComplete as Partial<Record<string, () => string[]>>) ?? {},
    };

    this.commands.set(
      trigger,
      commandInfo as CommandInfo<ZodObject<Record<string, ZodTypeAny>>>
    );

    for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
      const alias = aliases[aliasIndex];
      if (alias.length === 0 || containsWhitespace(alias)) {
        console.warn(
          `Command alias for "${trigger}", "${alias}" ignored as invalid.`
        );
        continue;
      }
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
      commandInfo.aliases.push(alias);
    }

    return () => {
      this.commands.delete(trigger);
      const aliases = commandInfo.aliases;
      const aliasesLength = aliases.length;
      for (let aliasIndex = 0; aliasIndex < aliasesLength; aliasIndex++) {
        this.commands.delete(aliases[aliasIndex]);
      }
    };
  }

  /**
   * Remove a command from the chat system. Case sensitive.
   *
   * @param trigger - The trigger to remove.
   */
  public removeCommand(trigger: string) {
    const commandInfo = this.commands.get(trigger);
    if (!commandInfo) {
      return false;
    }
    const aliases = commandInfo.aliases;
    let aliasIndex = -1;
    for (let index = 0; index < aliases.length; index++) {
      if (aliases[index] === trigger) {
        aliasIndex = index;
        break;
      }
    }
    const isAliasTrigger = aliasIndex >= 0;
    this.commands.delete(trigger);
    if (isAliasTrigger) {
      aliases.splice(aliasIndex, 1);
      return true;
    }
    const aliasesLength = aliases.length;
    for (let aliasIndex = 0; aliasIndex < aliasesLength; aliasIndex++) {
      this.commands.delete(aliases[aliasIndex]);
    }
    aliases.length = 0;
    return true;
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
        this._commandSymbolLength = commandSymbol.length;
        this._commandSymbolFirstCode =
          this._commandSymbolLength === 1 ? commandSymbol.charCodeAt(0) : -1;
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
    if (!stringResult.success) return true;
    return stringResult.data === true;
  }

  private hasDefault(schema: ZodTypeAny): boolean {
    const def = schema._def as {
      defaultValue?: string | number | boolean | (() => string | number | boolean);
    };
    return def.defaultValue !== undefined;
  }

  private getDefaultValue(schema: ZodTypeAny): string | number | boolean | undefined {
    const def = schema._def as {
      defaultValue?: string | number | boolean | (() => string | number | boolean);
    };
    const defaultValue = def.defaultValue;
    if (defaultValue === undefined) {
      return undefined;
    }
    if (typeof defaultValue === "function") {
      return defaultValue();
    }
    return defaultValue;
  }

  private extractArgMetadata(
    schema: ZodObject<Record<string, ZodTypeAny>> | undefined,
    tabComplete?: Partial<Record<string, () => string[]>>
  ): ArgMetadata[] {
    if (!schema) {
      return [];
    }

    const result: ArgMetadata[] = [];
    const shape = schema.shape;
    const hasOwn = Object.prototype.hasOwnProperty;

    for (const name in shape) {
      if (!hasOwn.call(shape, name)) {
        continue;
      }
      const zodType = shape[name];
      let innerType = zodType as ZodTypeAny;
      let required = true;
      let defaultValue: string | number | boolean | undefined;

      if (this.hasDefault(innerType)) {
        required = false;
        defaultValue = this.getDefaultValue(innerType);
        const def = innerType._def as {
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

      const tc = tabComplete?.[name];

      if (this.isEnumSchema(innerType)) {
        result.push({
          name,
          type: "enum",
          required,
          options: innerType.options as string[],
          defaultValue,
          tabComplete: tc,
        });
      } else if (this.isBooleanSchema(innerType)) {
        result.push({
          name,
          type: "boolean",
          required,
          defaultValue,
          tabComplete: tc,
        });
      } else if (this.isNumberSchema(innerType)) {
        result.push({
          name,
          type: "number",
          required,
          defaultValue,
          tabComplete: tc,
        });
      } else {
        result.push({
          name,
          type: "string",
          required,
          defaultValue,
          tabComplete: tc,
        });
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
    if (this.commands.size === 0) {
      return [];
    }

    const uniqueCommands = new Map<
      CommandInfo<ZodObject<Record<string, ZodTypeAny>>>,
      string
    >();

    let commandEntries = this.commands.entries();
    let commandEntry = commandEntries.next();
    while (!commandEntry.done) {
      const [trigger, commandInfo] = commandEntry.value;
      if (!uniqueCommands.has(commandInfo)) {
        uniqueCommands.set(commandInfo, trigger);
      }
      commandEntry = commandEntries.next();
    }

    const result: Array<{
      trigger: string;
      description: string;
      category?: string;
      aliases: string[];
      flags: string[];
      args: ArgMetadata[];
    }> = [];
    let uniqueEntries = uniqueCommands.entries();
    let uniqueEntry = uniqueEntries.next();
    while (!uniqueEntry.done) {
      const [commandInfo, primaryTrigger] = uniqueEntry.value;
      result.push({
        trigger: primaryTrigger,
        description: commandInfo.description,
        category: commandInfo.category,
        aliases: commandInfo.aliases.slice(),
        flags: commandInfo.flags.slice(),
        args: commandInfo.args
          ? this.extractArgMetadata(commandInfo.args, commandInfo.tabComplete)
          : [],
      });
      uniqueEntry = uniqueEntries.next();
    }

    if (result.length <= 1) {
      return result;
    }

    return result.sort((a, b) => a.trigger.localeCompare(b.trigger));
  }
}
