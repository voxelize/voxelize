import { Client } from "@voxelize/client";
import { setupCommands } from "./commands";
import { setupEntities } from "./entities";
import { setupEvents } from "./events";
import { setupInputs } from "./inputs";
import { setupWorld } from "./world";
import { setupSounds } from "./sounds";

declare global {
  interface Window {
    hand: string;
  }
}

let BACKEND_SERVER_INSTANCE = new URL(window.location.href);

if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}

const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

export function setupClient(domElement: HTMLDivElement) {
  const client = new Client(
    {
      container: {
        domElement,
      },
      debug: {
        onByDefault: true,
      },
      world: {
        textureDimension: 128,
      },
    },
    {
      canChat: true,
      canDebug: true,
      canFly: true,
      canGhost: true,
      commands: "*",
    }
  );

  setupWorld(client);
  setupCommands(client);
  setupInputs(client);
  setupSounds(client);
  setupEvents(client);
  setupEntities(client);

  client?.connect({
    secret: "test",
    serverURL: BACKEND_SERVER,
    reconnectTimeout: 5000,
  });

  return client;
}
