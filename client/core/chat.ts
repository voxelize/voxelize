import { Client } from "..";
import { ChatHistory, ChatMessage } from "../libs";
import { MESSAGE_TYPE } from "../types";
import { DOMUtils } from "../utils";

type CSSMeasurement = `${number}${string}`;

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

type ChatParams = {
  gap: CSSMeasurement;
  margin: number;
  align: "left" | "center" | "right";
  messagesWidth: CSSMeasurement;
  inputWidth: CSSMeasurement;
  inputHeight: CSSMeasurement;
  borderRadius: CSSMeasurement;
  disappearTimeout: number;
  connectionMessage: string;
  disconnectionMessage: string;
  helpText: string;
};

const defaultParams: ChatParams = {
  gap: "26px",
  margin: 8,
  align: "left",
  messagesWidth: "40vw",
  inputWidth: "100%",
  inputHeight: "29px",
  borderRadius: "4px",
  disappearTimeout: 2000,
  connectionMessage: "Connected to world! Try /help",
  disconnectionMessage: "World disconnected. Reconnecting...",
  helpText: HELP_TEXT,
};

class Chat {
  public params: ChatParams;

  public enabled = false;

  public messages: ChatMessage[] = [];
  public history: ChatHistory;

  public gui: {
    messages: HTMLUListElement;
    wrapper: HTMLDivElement;
    input: HTMLInputElement;
  };

  private disappearTimer: NodeJS.Timeout;

  constructor(public client: Client, params: Partial<ChatParams> = {}) {
    const { connectionMessage, disconnectionMessage } = (this.params = {
      ...defaultParams,
      ...params,
    });

    this.makeDOM();

    client.inputs.bind("t", this.enable, "in-game");
    client.inputs.bind("/", () => this.enable(true), "in-game");
    client.inputs.bind("esc", this.disable, "chat", { occasion: "keyup" });

    client.on("connected", () =>
      this.add({ type: "SERVER", body: connectionMessage })
    );

    client.on("disconnected", () =>
      this.add({ type: "ERROR", body: disconnectionMessage })
    );

    this.history = new ChatHistory(this.gui.input);
  }

  add = ({
    type,
    sender,
    body,
  }: {
    type: MESSAGE_TYPE;
    sender?: string;
    body?: string;
  }) => {
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

  enable = (isCommand = false) => {
    if (this.disappearTimer) {
      clearTimeout(this.disappearTimer);
    }

    this.enabled = true;
    this.client.controls.unlock();
    this.client.emit("chat-enabled");

    this.resetInput();
    this.showInput();
    this.focusInput();
    this.showMessages();

    if (isCommand) {
      this.inputValue = "/";
    }
  };

  disable = () => {
    this.enabled = false;

    this.fadeMessages();
    this.blurInput();
    this.resetInput();
    this.hideInput();

    this.client.controls.lock(() => {
      this.client.emit("chat-disabled");
    });
  };

  showMessages = () => {
    DOMUtils.applyStyles(this.gui.wrapper, {
      opacity: "1",
      visibility: "visible",
      transition: "all 0s ease 0s",
    });
  };

  showInput = () => {
    DOMUtils.applyStyles(this.gui.input, { visibility: "visible" });
  };

  hideInput = () => {
    DOMUtils.applyStyles(this.gui.input, { visibility: "hidden" });
  };

  resetInput = () => (this.inputValue = "");

  focusInput = () => this.gui.input.focus();

  blurInput = () => this.gui.input.blur();

  applyMessagesStyles = (styles: Partial<CSSStyleDeclaration>) => {
    DOMUtils.applyStyles(this.gui.messages, styles);
  };

  applyInputStyles = (styles: Partial<CSSStyleDeclaration>) => {
    DOMUtils.applyStyles(this.gui.input, styles);
  };

  set inputValue(value: string) {
    this.gui.input.value = value;
  }

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
      margin: `${margin}px`,
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
      width: `calc(${inputWidth} - ${margin * 2}px)`,
      margin: `${margin}px`,
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

    if (value.split(" ").filter((ele) => ele).length === 0) return;

    const { network } = this.client;

    if (value === "/help") {
      this.add({ type: "INFO", body: this.params.helpText });
      return;
    }

    //     if (value === "/spectator") {
    //       this.engine.player.toggleSpectatorMode();
    //       return;
    //     }

    //     if (value.startsWith("/")) {
    //       const { inventory, registry } = this.client;

    //       const commands = value.substr(1).split(" ");
    //       switch (commands[0]) {
    //         case "bs":
    //         case "blocks": {
    //           this.add({
    //             type: "INFO",
    //             body: Object.keys(registry.params.blocks)
    //               .map((key) => {
    //                 const { name } = registry.params.blocks[key];
    //                 return `${key}: ${name}`;
    //               })
    //               .join("\n"),
    //           });
    //           return;
    //         }
    //         case "b":
    //         case "block": {
    //           const block = +commands[1];
    //           if (block) {
    //             if (registry.hasBlock(block)) {
    //               inventory.setHand(block);
    //               this.add({ type: "INFO", body: `Block set to: ${block}` });
    //             } else {
    //               this.add({ type: "ERROR", body: `Block not found: ${block}` });
    //             }
    //             return;
    //           }
    //         }
    //       }
    //     }

    network.send({
      type: "CHAT",
      chat: {
        type: "PLAYER",
        sender: this.client.name,
        body: value,
      },
    });

    this.history.add(value);
    this.history.reset();
  };

  private handleUp = () => {
    const previous = this.history.previous();
    if (previous) this.inputValue = previous;
  };

  private handleDown = () => {
    const next = this.history.next();
    if (next) this.inputValue = next;
  };
}

export { Chat, ChatParams };
