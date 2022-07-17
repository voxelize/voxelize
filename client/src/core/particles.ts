import { Tween } from "@tweenjs/tween.js";
import { AABB } from "@voxelize/aabb";
import { RigidBody } from "@voxelize/physics-engine";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector2,
} from "three";

import { Client } from "..";
import { TRANSPARENT_RENDER_ORDER } from "../common";
import { Coords3 } from "../types";

import ParticlesFragmentShader from "./shaders/particles/fragment.glsl";
import ParticlesVertexShader from "./shaders/particles/vertex.glsl";

const flatten = (arr: any[][]) => {
  return arr.reduce((acc, val) => acc.concat(val), []);
};

/**
 * Parameters to initialize **a group of** particles.
 */
type ParticleParams = {
  /**
   * Number of particles spawned in this group.
   */
  count: number;

  /**
   * The magnitude of the default force applied to each particle.
   */
  force: number;

  /**
   * The time until this particle is discarded.
   */
  timeout: number;

  /**
   * Whether or not this particle is effected by gravity.
   */
  gravity: boolean;

  /**
   * The time for the particle to fade away once the timeout is reached.
   */
  fadeTimeout: number;

  /**
   * The scale of each particles.
   */
  scale: number;

  /**
   * A function returning a 3-element array that modifies the force applied on each particle.
   */
  impulseFunc: (f: number) => Coords3;

  /**
   * A function used to update the particles.
   */
  update: (g: ParticleGroup) => void;
};

/**
 * An object storing the data for a group of particles.
 */
type ParticleGroup = {
  /**
   * The ThreeJS Points instance for rendering.
   */
  mesh: Points;

  /**
   * The rigid bodies of the particles, allowing them to act physically.
   */
  bodies: RigidBody[];

  /**
   * Parameters used to initialize this particle group.
   */
  params: ParticleParams;
};

const defaultUpdate = ({ bodies, mesh }: ParticleGroup) => {
  const positions = [];

  for (const body of bodies) {
    positions.push(...body.getPosition());
  }

  mesh.geometry.setAttribute(
    "position",
    new Float32BufferAttribute(positions, 3)
  );
  mesh.geometry.attributes.position.needsUpdate = true;
};

const defaultBreakingParams: ParticleParams = {
  count: 12,
  force: 4,
  timeout: 2000,
  gravity: true,
  fadeTimeout: 200,
  scale: 0.4,
  impulseFunc: (force) => [
    Math.random() * force - force / 2,
    Math.random() * force,
    Math.random() * force - force / 2,
  ],
  update: defaultUpdate,
};

const MAX_GROUPS = 3;
const MAX_PARTICLES = 100;

/**
 * A **built-in** manager for everything particles in Voxelize.
 *
 * @category Core
 */
class Particles {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * An array of active particle groups.
   */
  public groups: ParticleGroup[] = [];

  /**
   * A function called before every update per tick.
   */
  public onBeforeUpdate?: () => void;

  /**
   * A function called after every update per tick.
   */
  public onAfterUpdate?: () => void;

  /**
   * Initialize a Voxelize particle manager.
   *
   * @hidden
   */
  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Create a group of particles for a voxel breaking effect. Returns `null` if empty voxels is passed in.
   *
   * @param voxels - The original voxel and block type that was broken.
   * @param params - Parameters to customize the particle initialization.
   */
  addBreakParticles = (
    voxels: { voxel: Coords3; type: number }[],
    params: Partial<ParticleParams> = {}
  ) => {
    this.sanityCheck();

    if (voxels.length === 0) {
      return null;
    }

    const allParams = {
      ...defaultBreakingParams,
      ...params,
    } as ParticleParams;

    const { count, force, gravity, timeout, impulseFunc, scale } = allParams;

    const bodies = [];
    const lights = [];
    const uvs = [];

    const geometry = new BufferGeometry();

    voxels.forEach(({ voxel, type }) => {
      if (type === 0) return;

      const [x, y, z] = voxel;

      const red = this.client.world.getTorchLightByVoxel(x, y, z, "RED") / 15;
      const green =
        this.client.world.getTorchLightByVoxel(x, y, z, "GREEN") / 15;
      const blue = this.client.world.getTorchLightByVoxel(x, y, z, "BLUE") / 15;
      const sun = this.client.world.getSunlightByVoxel(x, y, z) / 15;

      const typeUVObj = this.client.world.getUV(type);
      const typeUVArr = [];

      Object.values(typeUVObj).forEach((uv) => {
        typeUVArr.push(uv[0][uv[1]]);
      });

      for (let i = 0; i < count; i++) {
        const body = this.client.physics.addBody({
          aabb: new AABB(0, 0, 0, 0, 0.1, 0),
          gravityMultiplier: gravity ? 1 : 0,
          restitution: 0.3,
        });
        body.setPosition([
          x + Math.random(),
          y + Math.random(),
          z + Math.random(),
        ]);

        body.applyImpulse(impulseFunc(force));
        bodies.push(body);
        uvs.push(typeUVArr[i % typeUVArr.length]);

        // TODO: fix this. this is costly
        lights.push(red, green, blue, sun);
      }
    });

    if (bodies.length === 0) {
      return null;
    }

    geometry.setAttribute("uv", new Float32BufferAttribute(flatten(uvs), 2));
    geometry.setAttribute("lights", new Float32BufferAttribute(lights, 4));
    geometry.attributes.uv.needsUpdate = true;

    const countPerSide = this.client.world.registry.perSide;
    const margin = this.client.world.atlas.margin;

    const material = new ShaderMaterial({
      uniforms: {
        uTexture: { value: this.client.world.uniforms.atlas.value },
        uPointSize: {
          value:
            (window.innerHeight /
              (2.0 * Math.tan((0.5 * 60.0 * Math.PI) / 180.0))) *
            scale,
        },
        uRepeat: {
          value: new Vector2(
            1 / countPerSide - margin * 2,
            1 / countPerSide - margin * 2
          ),
        },
        uScale: {
          value: 1,
        },
        uSunlightIntensity: this.client.world.uniforms.sunlight,
      },
      vertexShader: ParticlesVertexShader,
      fragmentShader: ParticlesFragmentShader,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      vertexColors: true,
    });

    const points = new Points(geometry, material);
    points.renderOrder = TRANSPARENT_RENDER_ORDER;
    this.client.world.add(points);

    const group = {
      mesh: points,
      bodies,
      params: allParams,
    } as ParticleGroup;

    this.groups.push(group);

    setTimeout(() => {
      this.removeGroup(group);
    }, timeout);

    return group;
  };

  /**
   * Updater of Voxelize particles manager.
   *
   * @hidden
   */
  update = () => {
    this.onBeforeUpdate?.();

    this.groups.forEach((g) => {
      g.params.update(g);
    });

    this.onAfterUpdate?.();
  };

  private removeGroup(group: ParticleGroup, animate = true) {
    const { physics, world } = this.client;

    const index = this.groups.indexOf(group);
    if (index > -1) {
      const [group] = this.groups.splice(index, 1);
      const { mesh, bodies, params } = group;

      bodies.forEach((body) => {
        physics.removeBody(body);
      });

      if (animate) {
        new Tween(
          // @ts-ignore
          group.mesh.material.uniforms.uScale
        )
          .to({ value: 0 }, params.fadeTimeout)
          .onComplete(() => {
            world.remove(mesh);
          })
          .start();
      } else {
        world.remove(mesh);
      }
    }
  }

  private sanityCheck() {
    if (this.groups.length > MAX_GROUPS) {
      let total = 0;
      this.groups.forEach((g) => (total += g.bodies.length));

      if (total > MAX_PARTICLES) {
        this.removeGroup(this.groups[0]);
      }
    }
  }
}

export type { ParticleParams, ParticleGroup };

export { Particles };
