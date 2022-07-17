import { DOMUtils } from "../../utils";

export type ChatMessageParams = {
  width?: `${number}${string}`;
  color?: string;
};

const defaultParams: ChatMessageParams = {
  width: "40vw",
};

export class ChatMessage {
  public wrapper = document.createElement("li");
  public sender = document.createElement("p");
  public body = document.createElement("p");

  constructor(
    public type: string,
    sender?: string,
    body?: string,
    params: ChatMessageParams = {}
  ) {
    const { color, width } = { ...defaultParams, ...params };

    body = body.trim().split("\n").join("<br />");

    DOMUtils.applyStyles(this.wrapper, {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-start",
      verticalAlign: "middle",
      padding: "5px",
      width,
      background: "rgba(0,0,0,0.45)",
    });

    DOMUtils.applyStyles([this.sender, this.body], {
      fontSize: "14px",
      color: "white",
    });

    if (this.sender) {
      DOMUtils.applyStyles(this.body, {
        marginLeft: "8px",
      });
    }

    DOMUtils.applyStyles(this.sender, {
      width: "fit-content",
      flexShrink: "0",
    });

    this.sender.innerHTML = sender ? `${sender}:&nbsp;` : "";
    this.body.innerHTML = body || "";

    if (color) {
      DOMUtils.applyStyles([this.sender, this.body], {
        color,
      });
    } else {
      switch (type) {
        case "ERROR":
          DOMUtils.applyStyles([this.sender, this.body], {
            color: "#f14668",
          });
          break;
        case "SERVER":
          DOMUtils.applyStyles([this.sender, this.body], {
            color: "#29bb89",
          });
          break;
        case "PLAYER":
          DOMUtils.applyStyles([this.sender, this.body], {
            color: "#eee",
          });
          this.sender.innerHTML = `&lt;${sender}&gt;`;
          this.body.innerHTML = body;
          break;
        case "INFO":
          DOMUtils.applyStyles([this.sender, this.body], {
            color: "#fed049",
          });
          break;
        default:
          break;
      }
    }

    this.wrapper.appendChild(this.sender);
    this.wrapper.appendChild(this.body);
  }
}
