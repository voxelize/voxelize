import { Client } from "..";
import { ChatHistory, ChatMessage } from "../libs";
import { CSSMeasurement, MESSAGE_TYPE } from "../types";
import { DOMUtils } from "../utils";

const HELP_TEXT = `
Basic controls of the game:
- <kbd>R</kbd>: Toggle sprint
- <kbd>T</kbd>: Toggle chat
- <kbd>J</kbd>: Toggle debug 
- <kbd>F</kbd>: Toggle physical fly 
- <kbd>G</kbd>: Toggle ghost mode
- <kbd>X</kbd>: Bulk destruction
- <kbd>Space</kbd>: Jump / fly up
- <kbd>W/A/S/D</kbd>: Movements
- <kbd>L-Shift</kbd>: Fly down
- <kbd>L-Mouse</kbd>: Break block
- <kbd>R-Mouse</kbd>: Place block
`;

/**
 * Parameters to initialize the Voxelize {@link Chat}.
 */
type ChatParams = {
  /**
   * Alignment of the chat. Defaults to `left`.
   */
  align: "left" | "center" | "right";

  /**
   * Border radius of both the radius and the message list. Defaults to `4px`.
   */
  borderRadius: CSSMeasurement;

  /**
   * The message sent when a connection is made. Defaults to `Connected to world! Try /help`.
   */
  connectionMessage: string;

  /**
   * The message sent when connection is lost. Defaults to `World disconnected. Reconnecting...`.
   */
  disconnectionMessage: string;

  /**
   * The timeout for chat to disappear once input is closed in milliseconds. Defaults to `2000`.
   */
  disappearTimeout: number;

  /**
   * The gap between the input and the message list. Defaults to `26px`.
   */
  gap: CSSMeasurement;

  /**
   * A text message that is sent to the client frontend-only when '/help' is typed in the chat.
   */
  helpText: string;

  /**
   * A text message that is sent to the client frontend-only when a command they're trying is not within their permission.
   */
  permissionText: string;

  /**
   * Height of the chat input. Defaults to `29px`.
   */
  inputHeight: CSSMeasurement;

  /**
   * Width of the chat input, not regarding the margins. Defaults to `100%`.
   */
  inputWidth: CSSMeasurement;

  /**
   * The margin of the chat to the viewport in pixels. Defaults to `8px`.
   */
  margin: CSSMeasurement;

  /**
   * The default width of the message list. Defaults to `40vw`.
   */
  messagesWidth: CSSMeasurement;

  /**
   * Symbol to activate typing a command, needs to be 1 character long! Defaults to `/`.
   */
  commandSymbol: string;
};

const defaultParams: ChatParams = {
  gap: "26px",
  margin: "8px",
  align: "left",
  messagesWidth: "40vw",
  inputWidth: "100%",
  inputHeight: "29px",
  borderRadius: "4px",
  disappearTimeout: 2000,
  connectionMessage: "Connected to world! Try /help",
  disconnectionMessage: "World disconnected. Reconnecting...",
  helpText: HELP_TEXT,
  permissionText: "Sorry, but you do not have permissions to this command!",
  commandSymbol: "/",
};

/**
 * A process that gets run when a command is triggered.
 */
type CommandProcessor = (rest: string, client: Client) => void;

/**
 * The **built-in** chat of the Voxelize engine. Handles the networking of sending messages, and displaying
 * all messages received.
 *
 * ## Example
 * Access the chat through the client:
 * ```ts
 * client.chat.enable();
 * ```
 *
 * @category Core
 */
class Chat {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Parameters to initialize the Voxelize chat.
   */
  public params: ChatParams;

  /**
   * Whether this chat is enabled or not.
   */
  public enabled = false;

  /**
   * The list of chat messages received in this session.
   */
  public messages: ChatMessage[] = [];

  /**
   * A manager to control the history of chats, used to retrieve old sent messages.
   */
  public history: ChatHistory;

  /**
   * The DOM elements of this chat.
   */
  public gui: {
    /**
     * The wrapper around both the chat and the input.
     */
    wrapper: HTMLDivElement;

    /**
     * The list of all the received and rendered messages.
     */
    messages: HTMLUListElement;

    /**
     * The input of the chat.
     */
    input: HTMLInputElement;
  };

  private disappearTimer: number;
  private commands: Map<string, CommandProcessor> = new Map();

  /**
   * Construct a new Voxelize chat instance.
   *
   * @hidden
   */
  constructor(client: Client, params: Partial<ChatParams> = {}) {
    this.client = client;

    const { connectionMessage, disconnectionMessage, commandSymbol } =
      (this.params = {
        ...defaultParams,
        ...params,
      });

    if (commandSymbol.length !== 1) {
      throw new Error("Command symbol needs to be 1 character long.");
    }

    this.makeDOM();

    client.on("connected", () =>
      this.add({ type: "SERVER", body: connectionMessage })
    );

    client.on("disconnected", () =>
      this.add({ type: "ERROR", body: disconnectionMessage })
    );

    client.on("initialized", () => {
      client.inputs.bind("t", this.enable, "in-game");
      client.inputs.bind(commandSymbol, () => this.enable(true), "in-game");
      client.inputs.bind("esc", this.disable, "chat", { occasion: "keyup" });
    });

    this.history = new ChatHistory(this.gui.input);
  }

  /**
   * Add a message to the chat.
   *
   * @param data - The data of new chat message.
   * @param data.type - Type of message, used for color rendering.
   * @param data.sender - The name of the sender.
   * @param data.body - The body text of the message.
   */
  add = (data: { type: MESSAGE_TYPE; sender?: string; body?: string }) => {
    const { type, sender, body } = data;
    const { messagesWidth } = this.params;

    const newMessage = new ChatMessage(type, sender, body, {
      width: messagesWidth,
    });

    this.messages.push(newMessage);
    this.gui.messages.appendChild(newMessage.wrapper);

    this.showMessages();
    if (!this.enabled) {
      this.fadeMessages();
    }
  };

  /**
   * Add a command to the chat system. Commands are case sensitive.
   *
   * @param trigger - The text to trigger the command, needs to be one single word without spaces.
   * @param process - The process run when this command is triggered.
   */
  addCommand = (trigger: string, process: CommandProcessor) => {
    if (trigger.split(" ").length > 1) {
      throw new Error("Command trigger must be one word.");
    }

    this.commands.set(trigger, process);
  };

  /**
   * Remove a command from the chat system. Case sensitive.
   *
   * @param trigger - The trigger to remove.
   */
  removeCommand = (trigger: string) => {
    return !!this.commands.delete(trigger);
  };

  /**
   * Opens the Voxelize chat. Sets the `client.inputs` namespace to "chat".
   *
   * @param isCommand - Whether if this is triggered to type a command.
   */
  enable = (isCommand = false) => {
    const { controls, inputs } = this.client;

    if (this.disappearTimer) {
      clearTimeout(this.disappearTimer);
    }

    this.enabled = true;

    controls.unlock();
    this.client.emit("chat-enabled");
    inputs.setNamespace("chat");

    this.resetInput();
    this.showInput();
    this.focusInput();
    this.showMessages();

    if (isCommand) {
      this.inputValue = this.params.commandSymbol;
    }
  };

  /**
   * Disable the chat of Voxelize. Sets the namespace back to "in-game".
   */
  disable = () => {
    const { controls, inputs } = this.client;

    this.enabled = false;

    this.fadeMessages();
    this.blurInput();
    this.resetInput();
    this.hideInput();

    controls.lock(() => {
      this.client.emit("chat-disabled");
    });

    inputs.setNamespace("in-game");
  };

  /**
   * Show the chat messages list.
   */
  showMessages = () => {
    DOMUtils.applyStyles(this.gui.wrapper, {
      opacity: "1",
      visibility: "visible",
      transition: "all 0s ease 0s",
    });
  };

  /**
   * Show the chat input.
   */
  showInput = () => {
    DOMUtils.applyStyles(this.gui.input, { visibility: "visible" });
  };

  /**
   * Hide the chat input.
   */
  hideInput = () => {
    DOMUtils.applyStyles(this.gui.input, { visibility: "hidden" });
  };

  /**
   * Return the chat input, setting the input to empty string.
   */
  resetInput = () => (this.inputValue = "");

  /**
   * Focus the page onto the input element.
   */
  focusInput = () => this.gui.input.focus();

  /**
   * Unfocus the page from the input element.
   */
  blurInput = () => this.gui.input.blur();

  /**
   * Apply a set of styles to the messages list DOM element.
   *
   * @param styles - An object describing the styles to be added to the DOM element.
   */
  applyMessagesStyles = (styles: Partial<CSSStyleDeclaration>) => {
    DOMUtils.applyStyles(this.gui.messages, styles);
  };

  /**
   * Apply a set of styles to the chat input DOM element.
   *
   * @param styles - An object describing the styles to be added to the DOM element.
   */
  applyInputStyles = (styles: Partial<CSSStyleDeclaration>) => {
    DOMUtils.applyStyles(this.gui.input, styles);
  };

  /**
   * Set the value of the chat input.
   */
  set inputValue(value: string) {
    this.gui.input.value = value;
  }

  /**
   * Get the value of the chat input.
   */
  get inputValue() {
    return this.gui.input.value;
  }

  private makeDOM = () => {
    const { margin, align, inputWidth, inputHeight, gap, borderRadius } =
      this.params;

    this.gui = {
      messages: document.createElement("ul"),
      wrapper: document.createElement("div"),
      input: document.createElement("input"),
    };

    this.gui.wrapper.id = "voxelize-chat-wrapper";

    DOMUtils.applyStyles(this.gui.wrapper, {
      position: "fixed",
      bottom: "0",
      left: "0",
      zIndex: "4",
      width: "100vw",
      height: "32px",
      visibility: "hidden",
    });

    DOMUtils.applyStyles(this.gui.messages, {
      position: "fixed",
      bottom: `calc(${gap} + ${inputHeight})`,
      ...(align === "left"
        ? { left: "0" }
        : align === "center"
        ? { left: "50%", transform: "translateX(-50%)" }
        : {
            right: "0",
          }),
      margin,
      maxHeight: "50vh",
      overflowY: "auto",
      wordBreak: "break-all",
      display: "flex",
      flex: "1",
      flexDirection: "column",
      justifyContent: "flex-end",
      listStyle: "none",
      borderRadius,
    });

    DOMUtils.applyStyles(this.gui.input, {
      position: "fixed",
      bottom: "0",
      ...(align === "left"
        ? { left: "0" }
        : align === "center"
        ? { left: "50%", transform: "translateX(-50%)" }
        : {
            right: "0",
          }),
      width: `calc(${inputWidth} - ${margin} * 2)`,
      margin,
      height: inputHeight,
      background: "rgba(0,0,0,0.45)",
      padding: "5px",
      zIndex: "5",
      fontSize: "14px",
      color: "#eee",
      border: "none",
      outline: "none",
      visibility: "hidden",
      borderRadius,
    });

    this.gui.input.type = "text";
    this.gui.input.autocapitalize = "off";
    this.gui.input.autocomplete = "off";
    // @ts-ignore
    this.gui.input.autofocus = false;
    this.gui.input.spellcheck = false;
    this.gui.input.maxLength = 256;

    this.gui.messages.classList.add("hide-scrollbar");

    this.gui.wrapper.addEventListener("click", this.focusInput, false);
    this.gui.wrapper.appendChild(this.gui.messages);

    this.client.container.domElement.appendChild(this.gui.wrapper);
    this.client.container.domElement.appendChild(this.gui.input);

    this.gui.input.addEventListener(
      "keyup",
      (e) => {
        if (this.client.inputs.namespace !== "chat") return;

        switch (e.key) {
          case "Escape":
            this.disable();
            break;
          case "Enter":
            this.handleEnter();
            this.disable();
            break;
          case "ArrowUp":
            this.handleUp();
            break;
          case "ArrowDown":
            this.handleDown();
            break;
        }
      },
      false
    );
  };

  private fadeMessages = () => {
    if (this.disappearTimer) {
      clearTimeout(this.disappearTimer);
    }

    DOMUtils.applyStyles(this.gui.wrapper, { opacity: "0.8" });

    this.disappearTimer = setTimeout(() => {
      DOMUtils.applyStyles(this.gui.wrapper, {
        opacity: "0",
        transition: "opacity 1s ease-out",
      });
      clearTimeout(this.disappearTimer);
      this.disappearTimer = undefined;
    }, this.params.disappearTimeout);
  };

  private handleEnter = () => {
    const value = this.inputValue;
    const { commandSymbol, helpText, permissionText } = this.params;

    if (value.split(" ").filter((ele) => ele).length === 0) return;

    this.history.add(value);
    this.history.reset();

    const { network } = this.client;

    if (value === `${commandSymbol}help`) {
      this.add({ type: "INFO", body: helpText });
      return;
    }

    if (value.startsWith(commandSymbol)) {
      const words = value
        .substring(commandSymbol.length)
        .split(" ")
        .filter(Boolean);
      const trigger = words.shift();
      const rest = words.join(" ");

      const allowedCommands = this.client.permission.commands;
      if (allowedCommands !== "*" && !allowedCommands.includes(trigger)) {
        this.add({
          type: "ERROR",
          body: permissionText,
        });
      }

      const process = this.commands.get(trigger);

      if (process) {
        process(rest.trim(), this.client);
        return;
      }
    }

    network.send({
      type: "CHAT",
      chat: {
        type: "PLAYER",
        sender: this.client.username,
        body: value.startsWith(commandSymbol)
          ? `COMMAND: ${value.substring(1)}`
          : value,
      },
    });
  };

  private handleUp = () => {
    const previous = this.history.previous();
    console.log(previous);
    if (previous) this.inputValue = previous;
  };

  private handleDown = () => {
    const next = this.history.next();
    if (next) this.inputValue = next;
  };
}

export type { ChatParams };

export { Chat };
