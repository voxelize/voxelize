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
  DebugParams,
  Entities,
  Inputs,
  Loader,
  Network,
  Particles,
  Peers,
  Permission,
  Rendering,
  RenderingParams,
  Settings,
  World,
  Sounds,
  WorldClientParams,
} from "./core";
import { Events } from "./core/events";
import { ECS } from "./libs";

type ClientParams = {
  debug?: Partial<DebugParams>;
  container?: Partial<ContainerParams>;
  rendering?: Partial<RenderingParams>;
  camera?: Partial<CameraParams>;
  controls?: Partial<ControlsParams>;
  world?: Partial<WorldClientParams>;
  chat?: Partial<ChatParams>;
};

class Client extends EventEmitter {
  public id = "";
  public username: string;

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
  public peers: Peers<any>;
  public entities: Entities<any>;
  public settings: Settings;
  public particles: Particles;
  public events: Events;
  public sounds: Sounds;
  public chat: Chat;

  public permission: Permission;

  public joined = false;
  public loaded = false;
  public ready = false;

  public connectionPromise: Promise<boolean> | null = null;

  public userData: { [key: string]: any } = {};

  private animationFrame: number;

  constructor(params: ClientParams = {}, permission: Partial<Permission> = {}) {
    super();

    this.permission = new Permission(permission);

    const { container, rendering, camera, controls, world, chat, debug } =
      params;

    this.ecs = new ECS();

    this.loader = new Loader(this);
    this.debug = new Debug(this, debug);
    this.container = new Container(this, container);
    this.rendering = new Rendering(this, rendering);
    this.world = new World(this.loader, world);
    this.camera = new Camera(this, camera);
    this.peers = new Peers(this);
    this.entities = new Entities(this);
    this.chat = new Chat(this, chat);
    this.inputs = new Inputs(this);
    this.clock = new Clock(this);
    this.settings = new Settings(this);
    this.particles = new Particles(this);
    this.events = new Events(this);
    this.sounds = new Sounds(this);
    this.controls = new Controls(this.camera, this.world, controls);
    this.controls.setupListeners(this.container, this.inputs, this.permission);

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
    secret,
  }: {
    serverURL?: string;
    reconnectTimeout?: number;
    secret?: string;
  }) => {
    if (!serverURL) {
      throw new Error("Server URL undefined, cannot connect.");
    }

    const network = new Network(this, {
      reconnectTimeout,
      serverURL,
      secret,
    });
    this.network = network;

    // Register default network interceptors
    this.network
      .cover(this.world)
      .cover(this.entities)
      .cover(this.peers)
      .cover(this.chat)
      .cover(this.events)
      .cover(this.controls);

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
    this.world.reset();
    this.controls.reset();
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

    const delta = this.clock.delta;

    this.camera.update();
    this.controls.update(delta);

    const { x, z } = this.controls.getDirection();

    this.world.update(this.controls.position, [x, z], delta);

    this.ecs.update();
    this.clock.update();
    this.peers.update();
    this.debug.update();
    this.particles.update();

    this.network.flush();

    this.rendering.render();
  };
}

export { Client };

export * from "./core";
export * from "./libs";
export * from "./types";
