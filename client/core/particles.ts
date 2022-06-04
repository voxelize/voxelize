import { AABB, RigidBody } from "@voxelize/voxel-physics-engine";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector2,
} from "three";
import Tweezer from "tweezer.js";

import { Client } from "..";
import { Coords3 } from "../types";

import ParticlesFragmentShader from "./shaders/particles/fragment.glsl";
import ParticlesVertexShader from "./shaders/particles/vertex.glsl";

const flatten = (arr: any[][]) => {
  return arr.reduce((acc, val) => acc.concat(val), []);
};

type ParticleParams = {
  count: number;
  force: number;
  timeout: number;
  gravity: boolean;
  fadeTimeout: number;
  impulseFunc: (f: number) => Coords3;
};

type Group = {
  mesh: Points;
  particles: RigidBody[];
  params: ParticleParams;
  update: () => void;
};

const defaultParams: ParticleParams = {
  count: 12,
  force: 4,
  timeout: 1000,
  gravity: true,
  fadeTimeout: 100,
  impulseFunc: (force) => [
    Math.random() * force - force / 2,
    Math.random() * force,
    Math.random() * force - force / 2,
  ],
};

const PARTICLE_SCALE = 0.6;
const MAX_GROUPS = 3;
const MAX_PARTICLES = 100;

class Particles {
  public groups: Group[] = [];

  constructor(public client: Client) {}

  addBreakParticles = (
    voxels: { voxel: Coords3; type: number }[],
    params: Partial<ParticleParams> = {}
  ) => {
    this.sanityCheck();

    const allParams = {
      ...defaultParams,
      ...params,
    } as ParticleParams;
    const { count, force, gravity, timeout, impulseFunc } = allParams;

    const particles = [];
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

      const typeUVObj = this.client.registry.getUV(type);
      const typeUVArr = [];

      Object.values(typeUVObj).forEach((uv) => {
        typeUVArr.push(uv[0][uv[1]]);
      });

      for (let i = 0; i < count; i++) {
        const body = this.client.physics.core.addBody({
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
        particles.push(body);
        uvs.push(typeUVArr[i % typeUVArr.length]);

        // TODO: fix this. this is costly
        lights.push(red, green, blue, sun);
      }
    });

    if (particles.length === 0) {
      return;
    }

    geometry.setAttribute("uv", new Float32BufferAttribute(flatten(uvs), 2));
    geometry.setAttribute("lights", new Float32BufferAttribute(lights, 4));
    geometry.attributes.uv.needsUpdate = true;

    const { dimension } = this.client.registry.params;
    const countPerSide = this.client.registry.perSide;

    const material = new ShaderMaterial({
      uniforms: {
        uTexture: { value: this.client.registry.atlasUniform.value },
        uPointSize: {
          value:
            (window.innerHeight /
              (2.0 * Math.tan((0.5 * 60.0 * Math.PI) / 180.0))) *
            PARTICLE_SCALE,
        },
        uRepeat: {
          value: new Vector2(
            1 / countPerSide - (0.1 / dimension) * 2,
            1 / countPerSide - (0.1 / dimension) * 2
          ),
        },
        uScale: {
          value: 1,
        },
        uSunlightIntensity: this.client.world.uSunlightIntensity,
      },
      vertexShader: ParticlesVertexShader,
      fragmentShader: ParticlesFragmentShader,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      vertexColors: true,
    });

    const points = new Points(geometry, material);
    points.renderOrder = 10000;
    this.client.rendering.scene.add(points);

    const group = {
      mesh: points,
      particles,
      params: allParams,
      update: () => {
        this.updatePositions(geometry, particles);
      },
    };

    this.groups.push(group);

    setTimeout(() => {
      this.removeGroup(group);
    }, timeout);
  };

  update = () => {
    this.groups.forEach((g) => g.update());
  };

  private removeGroup(group: Group, animate = true) {
    const { physics, rendering } = this.client;

    const index = this.groups.indexOf(group);
    if (index > -1) {
      const [group] = this.groups.splice(index, 1);
      const { mesh, particles, params } = group;

      particles.forEach((particle) => {
        physics.core.removeBody(particle);
      });

      if (animate) {
        const tweenResolution = 100;
        new Tweezer({
          start:
            // @ts-ignore
            group.mesh.material.uniforms.uScale.value * tweenResolution,
          end: 0,
          duration: params.fadeTimeout,
        })
          .on("tick", (v) => {
            // @ts-ignore
            group.mesh.material.uniforms.uScale.value = v / tweenResolution;
          })
          .on("done", () => {
            rendering.scene.remove(mesh);
          })
          .stop()
          .begin();
      } else {
        rendering.scene.remove(mesh);
      }
    }
  }

  private updatePositions = (
    geometry: BufferGeometry,
    particles: RigidBody[]
  ) => {
    const positions = [];
    for (const particle of particles) {
      positions.push(...particle.getPosition());
    }
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.attributes.position.needsUpdate = true;
  };

  private sanityCheck() {
    if (this.groups.length > MAX_GROUPS) {
      let total = 0;
      this.groups.forEach((g) => (total += g.particles.length));

      if (total > MAX_PARTICLES) {
        this.removeGroup(this.groups[0]);
      }
    }
  }
}

export { Particles };
