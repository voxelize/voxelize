import { Client } from "..";
import { Registry } from "../core";
import { Coords3, BlockUpdate } from "../types";

/**
 * Parameters to process an image voxelization.
 */
type ImageVoxelizerParams = {
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
   * The voxel at which to offset the voxelizer at.
   */
  voxel?: Coords3;

  /**
   * Which direction to place the voxelized image.
   */
  orientation: "x" | "z";
};

const defaultParams: ImageVoxelizerParams = {
  width: 64,
  height: 64,
  lockedRatio: false,
  orientation: "x",
};

class ImageVoxelizer {
  static commander = async (rest: string, client: Client) => {
    const index = rest.indexOf("{") === -1 ? rest.length : rest.indexOf("{");

    let file = rest.substring(0, index).trim();

    if (file.startsWith('"')) {
      file = file.substring(1);
    }
    if (file.endsWith('"')) {
      file = file.substring(0, file.length - 1);
    }

    let params: Partial<ImageVoxelizerParams>;

    console.log(rest.substring(index), file);

    try {
      params = JSON.parse(rest.substring(index) || "{}");
    } catch (e) {
      throw new Error("Image voxelizer could not parse parameters.");
    }

    const fullParams = {
      ...defaultParams,
      ...params,
    };

    if (!fullParams.voxel) {
      fullParams.voxel = client.controls.voxel;
    }

    const updates = await ImageVoxelizer.process(
      file,
      fullParams,
      client.registry
    );

    client.world.setServerVoxels(updates);
    client.chat.add({ type: "INFO", body: `Image voxelization done: ${file}` });
  };

  static process = async (
    file: string,
    params: ImageVoxelizerParams,
    registry: Registry
  ) => {
    console.log(`Starting to voxelize image: ${file}`);

    const {
      ranges,
      atlas: { canvas },
    } = registry;

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
      const block = registry.getBlockByTextureName(name);
      if (block.isTransparent) {
        return;
      }

      if (
        name.endsWith("bottom") ||
        name.endsWith("top") ||
        ["px", "py", "pz", "nx", "ny", "nz"].filter((key) => name.endsWith(key))
          .length > 0
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

    return new Promise<BlockUpdate[]>((resolve) => {
      const original = new Image();
      original.crossOrigin = "Anonymous";
      original.onload = () => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        let { width, height, orientation } = params;
        const { lockedRatio, voxel } = params;

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

        const [baseX, baseY, baseZ] = voxel || [0, 0, 0];

        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const { r, g, b, a } = getPixelAt(context, x, y);

            const closest = getClosest([r, g, b, a]);
            const block = registry.getBlockByTextureName(closest);

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

      original.onerror = console.error;
      original.src = file;
    });
  };
}

export { ImageVoxelizer, ImageVoxelizerParams };
