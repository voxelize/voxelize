import { EventEmitter } from "events";

import TWEEN from "@tweenjs/tween.js";

import {
  Camera,
  CameraParams,
  Chat,
  ChatParams,
  Clock,
  Container,
  ContainerParams,
  Controls,
  ControlsParams,
  Debug,
  Entities,
  EntitiesParams,
  Inputs,
  Loader,
  Network,
  Particles,
  Peers,
  PeersParams,
  Permission,
  Physics,
  Registry,
  RegistryParams,
  Rendering,
  RenderingParams,
  Settings,
  World,
  WorldInitParams,
} from "./core";
import { ECS } from "./libs";

type ClientParams = {
  container?: Partial<ContainerParams>;
  rendering?: Partial<RenderingParams>;
  camera?: Partial<CameraParams>;
  peers?: Partial<PeersParams>;
  entities?: Partial<EntitiesParams>;
  controls?: Partial<ControlsParams>;
  registry?: Partial<RegistryParams>;
  world?: Partial<WorldInitParams>;
  chat?: Partial<ChatParams>;
};

class Client extends EventEmitter {
  public id = "";
  public username;

  public network: Network | undefined;

  public ecs: ECS;

  public debug: Debug;
  public loader: Loader;
  public container: Container;
  public rendering: Rendering;
  public inputs: Inputs;
  public clock: Clock;
  public controls: Controls;
  public camera: Camera;
  public world: World;
  public peers: Peers;
  public entities: Entities;
  public registry: Registry;
  public settings: Settings;
  public physics: Physics;
  public particles: Particles;
  public chat: Chat;

  public permission: Permission;

  public joined = false;
  public loaded = false;
  public ready = false;

  public connectionPromise: Promise<boolean> | null = null;

  private animationFrame: number;

  constructor(params: ClientParams = {}, permission: Partial<Permission> = {}) {
    super();

    this.permission = new Permission(permission);

    const {
      container,
      rendering,
      camera,
      peers,
      entities,
      controls,
      registry,
      world,
      chat,
    } = params;

    this.ecs = new ECS();

    this.debug = new Debug(this);
    this.loader = new Loader(this);
    this.container = new Container(this, container);
    this.rendering = new Rendering(this, rendering);
    this.world = new World(this, world);
    this.camera = new Camera(this, camera);
    this.peers = new Peers(this, peers);
    this.entities = new Entities(this, entities);
    this.controls = new Controls(this, controls);
    this.registry = new Registry(this, registry);
    this.chat = new Chat(this, chat);
    this.inputs = new Inputs(this);
    this.clock = new Clock(this);
    this.settings = new Settings(this);
    this.physics = new Physics(this);
    this.particles = new Particles(this);

    // Randomly set an ID to this client.
    const MAX = 10000;
    let index = Math.floor(Math.random() * MAX).toString();
    index =
      new Array(MAX.toString().length - index.length).fill("0").join("") +
      index;
    this.username = `Guest ${index}`;

    // all members has been initialized
    this.emit("initialized");
  }

  connect = async ({
    serverURL,
    reconnectTimeout,
  }: {
    serverURL?: string;
    reconnectTimeout?: number;
  }) => {
    if (!serverURL) {
      throw new Error("Server URL undefined, cannot connect.");
    }

    reconnectTimeout = reconnectTimeout || 5000;

    const network = new Network(this, {
      reconnectTimeout,
      serverURL,
    });
    this.network = network;

    this.connectionPromise = new Promise<boolean>((resolve) => {
      network
        .connect()
        .then(() => {
          resolve(true);
        })
        .catch(() => {
          resolve(false);
        });
    });

    return this.connectionPromise;
  };

  disconnect = async () => {
    this.peers.reset();

    if (this.network) {
      if (this.joined) {
        this.leave();
      }

      this.network.disconnect();
    }

    if (this.animationFrame) {
      // render one last time to clear things
      this.rendering.render();
      cancelAnimationFrame(this.animationFrame);
    }

    this.joined = false;
    this.network = undefined;
  };

  join = (world: string) => {
    if (this.joined) {
      this.leave();
    }

    this.joined = true;
    this.network.world = world;

    this.network.send({
      type: "JOIN",
      json: {
        world,
        username: this.username,
      },
    });

    this.reset();
    this.run();

    this.emit("join");
  };

  leave = () => {
    if (!this.joined) {
      return;
    }

    this.peers.reset();

    this.joined = false;

    this.network.send({
      type: "LEAVE",
      text: this.network?.world,
    });

    this.stop();

    this.emit("leave");
  };

  setID = (id: string) => {
    this.id = id || "";
  };

  setUsername = (username: string) => {
    this.username = username || " ";
  };

  reset = () => {
    this.entities.reset();
    this.world.reset();
    this.controls.reset();
    this.peers.reset();
  };

  private run = () => {
    const animate = () => {
      this.animationFrame = requestAnimationFrame(animate);
      this.animate();
    };

    animate();
  };

  private stop = () => {
    cancelAnimationFrame(this.animationFrame);
  };

  private animate = () => {
    if (
      !this.network.connected ||
      !this.joined ||
      !this.ready ||
      !this.loaded
    ) {
      return;
    }

    TWEEN.update();

    this.camera.update();
    this.controls.update();
    this.world.update();
    this.ecs.update();
    this.clock.update();
    this.entities.update();
    this.peers.update();
    this.debug.update();
    this.particles.update();
    this.physics.update();

    this.rendering.render();
  };
}

export { Client };

export * from "./core";
export * from "./libs";
export * from "./types";
