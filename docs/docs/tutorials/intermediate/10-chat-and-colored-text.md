---
sidebar_position: 10
---

# Chat and Colored Text

Voxelize provides a chat system for player communication and a colored text utility for styled text rendering.

## Chat System

### Client Setup

```ts title="Chat Setup"
import * as VOXELIZE from "@voxelize/core";

const chat = new VOXELIZE.Chat();

network.register(chat);
```

### Sending Messages

```ts title="Sending Chat"
chat.send("player-name", "Hello everyone!");
```

### Receiving Messages

```ts title="Receiving Chat"
chat.onChat = (message) => {
  const { sender, body } = message;
  console.log(`${sender}: ${body}`);
  addToUI(sender, body);
};
```

### Chat UI Example

```ts title="Chat UI Integration"
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const chatMessages = document.getElementById("chat-messages");

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && chatInput.value.trim()) {
    chat.send(username, chatInput.value);
    chatInput.value = "";
  }
});

chat.onChat = (message) => {
  const div = document.createElement("div");
  div.innerHTML = `<strong>${message.sender}:</strong> ${message.body}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
};
```

## Server-Side Chat

### Handling Chat

Chat messages are broadcast to all clients by default. To intercept:

```rust title="Chat Handling"
// Chat messages trigger on_chat internally
// They're automatically broadcast unless handled

// For commands, use the command handler:
world.set_command_handle(|world, client_id, command| {
    // command is the message without the command prefix
    // e.g., "/spawn bot" becomes "spawn bot"
});
```

### Command Symbol

Configure the command prefix in world config:

```rust title="Command Prefix"
let config = WorldConfig::new()
    .command_symbol("/")  // Default is "/"
    .build();
```

### Chat History

Every world remembers its public chat: the lines players send (commands are
never kept) and whatever the server posts with `world.post_chat`. Each line is
stamped with a `seq` (its position in the log) and a `sentAt` time, and a
client that joins or reloads receives the newest 100 lines in its INIT, ahead
of any live line. A saved world also writes the log to
`<save_dir>/chat/chat.jsonl` on a background thread, so it survives restarts;
the file is capped at twice the capacity and rewritten down to it.

```rust title="Chat History"
let config = WorldConfig::new()
    .chat_history_capacity(2000)    // lines kept; 0 turns history off
    .chat_log_dir("runtime/chat")   // persist even when the world isn't saved
    .build();

// A public line from the server, kept in the history like a player's.
world.post_chat("system", "", "", ChatMessageProtocol {
    r#type: "SYSTEM".to_owned(),
    body: "The gates open at dusk.".to_owned(),
    ..Default::default()
});
```

On the client, history never passes through `onChat` (so nothing a live line
triggers runs twice); it arrives through `onHistory`, and older pages are one
call away:

```ts title="Showing History"
chat.onHistory = ({ entries, hasMore, isJoin }) => {
  // entries are oldest first; merge them by `seq` with the live lines
  prependToUI(entries);
};
if (chat.joinHistory) chat.onHistory(chat.joinHistory); // INIT came first

// Scrolled to the top: ask for the 50 lines before the oldest one shown.
chat.requestHistory(oldestSeqShown, 50);
```

### Chat Guard

A game can look at every public line before it is logged and broadcast. The
guard gets the sender's id and the line, may rewrite it, and returns `false`
to drop it (a dropped line is neither kept nor sent). Commands never reach it.

```rust title="Chat Guard"
world.set_chat_guard(|world, sender_id, chat| {
    if chat.body.to_lowercase().contains("@helper") {
        // Answer the mention later, e.g. by posting a reply with post_chat.
    }
    !chat.body.trim().is_empty()
});
```

## Colored Text

### ColorText Utility

`ColorText` renders text with inline color codes:

```ts title="ColorText Usage"
import * as VOXELIZE from "@voxelize/core";

VOXELIZE.ColorText.SPLITTER = "$";

const coloredText = new VOXELIZE.ColorText({
  text: "$red$Hello $blue$World",
});

scene.add(coloredText);
```

### Color Codes

Use the splitter character to change colors:

```
$red$This is red $green$this is green $#FF00FF$this is magenta
```

Supported formats:

- Named colors: `$red$`, `$blue$`, `$green$`, etc.
- Hex colors: `$#FF0000$`, `$#00FF00$`
- RGB: `$rgb(255,0,0)$`

### ColorText Options

```ts title="ColorText Options"
const text = new VOXELIZE.ColorText({
  text: "$white$Player Name",
  fontSize: 48,
  fontFace: "Arial",
  backgroundColor: "rgba(0,0,0,0.5)",
  yOffset: 0.5,
});
```

### Dynamic Updates

```ts title="Updating ColorText"
const nameTag = new VOXELIZE.ColorText({
  text: "$green$Healthy",
});

function updateHealth(health: number) {
  if (health > 50) {
    nameTag.text = "$green$Healthy";
  } else if (health > 25) {
    nameTag.text = "$yellow$Wounded";
  } else {
    nameTag.text = "$red$Critical";
  }
}
```

## SpriteText

For simpler text without colors:

```ts title="SpriteText"
const label = new VOXELIZE.SpriteText("Hello World", {
  fontSize: 32,
  color: "white",
  backgroundColor: "transparent",
});

label.position.set(0, 2, 0);
scene.add(label);
```

## Name Tags

Characters have built-in name tags:

```ts title="Character Name Tags"
const character = new VOXELIZE.Character({
  nameTagOptions: {
    fontFace: "monospace",
    fontSize: 32,
    yOffset: 0.2,
  },
});

character.username = "$red$Admin $white$PlayerName";
```

## Example: Chat with Roles

```ts title="Role-Based Chat Colors"
type Role = "admin" | "mod" | "player";

const roleColors: Record<Role, string> = {
  admin: "#FF0000",
  mod: "#00FF00",
  player: "#FFFFFF",
};

function formatMessage(role: Role, name: string, message: string): string {
  const color = roleColors[role];
  return `$${color}$[${role.toUpperCase()}] ${name}: $white$${message}`;
}

chat.onChat = (msg) => {
  const role = getUserRole(msg.sender);
  const formatted = formatMessage(role, msg.sender, msg.body);
  displayMessage(formatted);
};
```

## Example: Floating Damage Numbers

```ts title="Damage Numbers"
function showDamage(position: THREE.Vector3, damage: number) {
  const color = damage > 50 ? "red" : damage > 25 ? "orange" : "yellow";

  const text = new VOXELIZE.SpriteText(`-${damage}`, {
    fontSize: 48,
    color,
  });

  text.position.copy(position);
  text.position.y += 1;

  world.add(text);

  const startY = text.position.y;
  const animate = () => {
    text.position.y += 0.02;
    text.material.opacity -= 0.02;

    if (text.material.opacity > 0) {
      requestAnimationFrame(animate);
    } else {
      world.remove(text);
    }
  };

  animate();
}
```

Read on to learn about [protocol networking](./protocol-networking).



