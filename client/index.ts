import { EventEmitter } from "events";

import {
  Container,
  ContainerParams,
  World,
  Network,
  RenderingParams,
  Rendering,
  Camera,
  CameraParams,
  Peers,
  PeersParams,
  Inputs,
  Clock,
  Controls,
  ControlsParams,
  Debug,
  Entities,
  EntitiesParams,
  NewEntity,
  Mesher,
  Registry,
  RegistryParams,
  Settings,
  WorldInitParams,
} from "./core";
import { Chunks } from "./core/chunks";
import { ECS, System } from "./libs";
import { Coords3 } from "./types";
import { ChunkUtils } from "./utils";

type ClientParams = {
  container?: Partial<ContainerParams>;
  rendering?: Partial<RenderingParams>;
  camera?: Partial<CameraParams>;
  peers?: Partial<PeersParams>;
  entities?: Partial<EntitiesParams>;
  controls?: Partial<ControlsParams>;
  registry?: Partial<RegistryParams>;
  world?: Partial<WorldInitParams>;
};

class Client extends EventEmitter {
  public name = "test";

  public network: Network | undefined;

  public ecs: ECS;

  public debug: Debug;
  public container: Container;
  public rendering: Rendering;
  public inputs: Inputs;
  public clock: Clock;
  public controls: Controls;
  public camera: Camera;
  public world: World;
  public peers: Peers;
  public entities: Entities;
  public mesher: Mesher;
  public registry: Registry;
  public settings: Settings;
  public chunks: Chunks;

  public joined = false;
  public loaded = false;
  public ready = false;

  public connectionPromise: Promise<boolean> | null = null;

  private animationFrame: number;

  constructor(params: ClientParams = {}) {
    super();

    const {
      container,
      rendering,
      camera,
      peers,
      entities,
      controls,
      registry,
      world,
    } = params;

    this.ecs = new ECS();

    this.debug = new Debug(this);
    this.container = new Container(this, container);
    this.rendering = new Rendering(this, rendering);
    this.world = new World(this, world);
    this.camera = new Camera(this, camera);
    this.peers = new Peers(this, peers);
    this.entities = new Entities(this, entities);
    this.controls = new Controls(this, controls);
    this.registry = new Registry(this, registry);
    this.inputs = new Inputs(this);
    this.mesher = new Mesher(this);
    this.clock = new Clock(this);
    this.settings = new Settings(this);
    this.chunks = new Chunks(this);

    // all members has been initialized
    this.emit("initialized");
  }

  connect = async ({
    serverURL,
    reconnectTimeout,
  }: {
    serverURL: string;
    reconnectTimeout?: number;
  }) => {
    reconnectTimeout = reconnectTimeout || 5000;

    const network = new Network(this, { reconnectTimeout, serverURL });
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
    this.peers.dispose();

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
      text: world,
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

  registerEntity = (type: string, protocol: NewEntity) => {
    this.entities.registerEntity(type, protocol);
  };

  addSystem = (system: System) => {
    this.ecs.addSystem(system);
  };

  setName = (name: string) => {
    this.name = name || " ";
  };

  reset = () => {
    this.entities.reset();
    this.chunks.reset();
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

    this.camera.update();
    this.controls.update();
    this.world.update();
    this.ecs.update();
    this.clock.update();
    this.entities.update();
    this.peers.update();
    this.debug.update();
    this.chunks.update();

    this.rendering.render();
  };
}

export { Client };

export * from "./core";
export * from "./libs";
