import { LightColor } from "./light";
import { BlockRotation } from "./rotation";

export interface VoxelAccess {
  getVoxel(vx: number, vy: number, vz: number): number;
  getRawVoxel(vx: number, vy: number, vz: number): number;
  getVoxelRotation(vx: number, vy: number, vz: number): BlockRotation;
  getVoxelStage(vx: number, vy: number, vz: number): number;
  getSunlight(vx: number, vy: number, vz: number): number;
  getTorchLight(vx: number, vy: number, vz: number, color: LightColor): number;
  getAllLights(vx: number, vy: number, vz: number): [number, number, number, number];
  getMaxHeight(vx: number, vz: number): number;
  contains(vx: number, vy: number, vz: number): boolean;
}
