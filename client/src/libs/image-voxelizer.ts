import { Vector3 } from "three";

import { BlockUpdate, World } from "../core";

/**
 * Parameters to process an image voxelization.
 */
export type ImageVoxelizerParams = {
  /**
   * The width, in blocks, of the voxelized image. Defaults to `64`.
   */
  width: number;

  /**
   * The height, in blocks, of the voxelized image. Defaults to `64`.
   */
  height: number;

  /**
   * Whether or not should the ratio between width and height be locked. If true,
   * the width would be ignored and be later determined form the height. Defaults to `false`.
   */
  lockedRatio: boolean;

  /**
   * Which direction to place the voxelized image.
   */
  orientation: "x" | "z";
};

const defaultParams: ImageVoxelizerParams = {
  width: 64,
  height: 64,
  lockedRatio: true,
  orientation: "x",
};

export class ImageVoxelizer {
  static parse = (rest: string) => {
    const index = rest.indexOf("{") === -1 ? rest.length : rest.indexOf("{");

    let imgURL = rest.substring(0, index).trim();

    if (imgURL.startsWith('"')) {
      imgURL = imgURL.substring(1);
    }
    if (imgURL.endsWith('"')) {
      imgURL = imgURL.substring(0, imgURL.length - 1);
    }

    let params: Partial<ImageVoxelizerParams>;

    try {
      params = JSON.parse(rest.substring(index) || "{}");
    } catch (e) {
      throw new Error("Image voxelizer could not parse parameters.");
    }

    return {
      ...defaultParams,
      ...params,
    } as ImageVoxelizerParams;
  };

  static build = async (
    imgURL: string,
    world: World,
    position: Vector3,
    params: ImageVoxelizerParams
  ) => {
    console.log(`Starting to voxelize image: ${imgURL}`);

    const {
      registry: { ranges },
      atlas: { canvas },
    } = world;

    const getPixelAt = (
      context: CanvasRenderingContext2D,
      x: number,
      y: number
    ) => {
      const {
        data: [r, g, b, a],
      } = context.getImageData(x, y, 1, 1);
      return {
        r,
        g,
        b,
        a,
      };
    };

    const colorDistSqr = (color1: number[], color2: number[]) => {
      return (
        (color1[0] - color2[0]) ** 2 +
        (color1[1] - color2[1]) ** 2 +
        (color1[2] - color2[2]) ** 2 +
        (color1[3] - color2[3]) ** 2
      );
    };

    const { width, height } = canvas;
    const context = canvas.getContext("2d");
    const metrics = new Map<string, [number, number, number, number]>();

    ranges.forEach(({ startU, startV, endU, endV }, name) => {
      const block = world.getBlockByTextureName(name);
      if (!block.isOpaque) {
        return;
      }
      if (
        ["px", "py", "pz", "nx", "ny", "nz"].filter((key) => name.endsWith(key))
          .length === 0
      ) {
        return;
      }
      // TODO: add orientation
      const startX = startU * width;
      const startY = startV * height;
      const endX = endU * width;
      const endY = endV * height;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let count = 0;
      for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
          const { r, g, b, a } = getPixelAt(context, x, height - y);
          sumR += r;
          sumG += g;
          sumB += b;
          sumA += a;
          count++;
        }
      }
      const avgR = sumR / count;
      const avgG = sumG / count;
      const avgB = sumB / count;
      const avgA = sumA / count;
      metrics.set(name, [avgR, avgG, avgB, avgA]);
    });

    const getClosest = (color1: number[]) => {
      let key = "";
      let minDistance = Number.MAX_VALUE;
      metrics.forEach((color2, name) => {
        const dist = colorDistSqr(color1, color2);
        if (minDistance > dist) {
          minDistance = dist;
          key = name;
        }
      });
      return key;
    };

    const updates = await new Promise<BlockUpdate[] | boolean>((resolve) => {
      const original = new Image();

      original.crossOrigin = "Anonymous";

      original.onload = () => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        let { width, height, orientation } = params;
        const { lockedRatio } = params;
        if (lockedRatio) {
          width = (height * original.width) / original.height;
        }
        width = Math.floor(width);
        height = Math.floor(height);
        width = width % 2 === 0 ? width : width + 1;
        height = height % 2 === 0 ? height : height + 1;
        canvas.width = width;
        canvas.height = height;
        orientation = orientation.toLowerCase() as "x" | "z";
        console.log(
          `Voxelizing original image (${original.width}, ${original.height}) to (${width}, ${height})`
        );
        context.drawImage(
          original,
          0,
          0,
          original.width,
          original.height,
          0,
          0,
          width,
          height
        );
        const updates: BlockUpdate[] = [];
        const [baseX, baseY, baseZ] = position.toArray();
        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const { r, g, b, a } = getPixelAt(context, x, y);
            const closest = getClosest([r, g, b, a]);
            const block = world.getBlockByTextureName(closest);
            updates.push({
              vx: orientation === "z" ? baseX : baseX - width / 2 + x,
              vy: baseY + height - y,
              vz: orientation === "z" ? baseZ - width / 2 + x : baseZ,
              type: block ? block.id : 0,
            });
          }
        }
        resolve(updates);
      };

      original.onerror = (error) => {
        console.error(error);
        resolve(false);
      };

      original.src = imgURL;
    });

    if (!Array.isArray(updates)) {
      return false;
    }

    world.updateVoxels(updates);

    return true;
  };
}
