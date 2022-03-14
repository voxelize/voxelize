import { EventEmitter } from "events";

import { ECS, System } from "@voxelize/common";

import {
  Container,
  ContainerParams,
  World,
  WorldParams,
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
} from "./core";

type ClientParams = {
  container?: Partial<ContainerParams>;
  rendering?: Partial<RenderingParams>;
  world?: Partial<WorldParams>;
  camera?: Partial<CameraParams>;
  peers?: Partial<PeersParams>;
  entities?: Partial<EntitiesParams>;
  controls?: Partial<ControlsParams>;
  registry?: Partial<RegistryParams>;
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

  private animationFrame: number;

  constructor(params: ClientParams = {}) {
    super();

    const {
      container,
      rendering,
      world,
      camera,
      peers,
      entities,
      controls,
      registry,
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

    // all members has been initialized
    this.emit("initialized");
  }

  connect = async ({
    room,
    serverURL,
    reconnectTimeout,
  }: {
    room: string;
    serverURL: string;
    reconnectTimeout?: number;
  }) => {
    reconnectTimeout = reconnectTimeout || 5000;

    // re-instantiate networking instance
    const network = new Network(this, { reconnectTimeout, serverURL });
    const hasRoom = await network.fetch("has-room", { room });

    if (!hasRoom) {
      console.error("Room not found.");
      return false;
    }

    network.connect(room).then(() => {
      console.log(`Joined room "${room}"`);
    });

    this.network = network;

    this.run();

    return true;
  };

  disconnect = async () => {
    this.peers.dispose();

    if (this.network) {
      this.network.disconnect();
      console.log(`Left room "${this.network.room}"`);
    }

    if (this.animationFrame) {
      // render one last time to clear things
      this.rendering.render();
      cancelAnimationFrame(this.animationFrame);
    }

    this.network = undefined;
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

  private run = () => {
    const animate = () => {
      this.animationFrame = requestAnimationFrame(animate);
      this.animate();
    };

    animate();
  };

  private animate = () => {
    this.ecs.update();
    this.clock.update();
    this.camera.update();
    this.entities.update();
    this.peers.update();
    this.controls.update();
    this.debug.update();

    this.rendering.render();
  };
}

export { Client };

export * from "./core";
export * from "./libs";
