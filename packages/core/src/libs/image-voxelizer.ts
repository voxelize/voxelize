// import { Vector3 } from "three";

// import { BlockUpdate, World } from "../core";

// /**
//  * Parameters to process an image voxelization.
//  */
// export type ImageVoxelizerOptions = {
//   /**
//    * The width, in blocks, of the voxelized image. Defaults to `64`.
//    */
//   width: number;

//   /**
//    * The height, in blocks, of the voxelized image. Defaults to `64`.
//    */
//   height: number;

//   /**
//    * Whether or not should the ratio between width and height be locked. If true,
//    * the width would be ignored and be later determined form the height. Defaults to `false`.
//    */
//   lockedRatio: boolean;

//   /**
//    * Which direction to place the voxelized image.
//    */
//   orientation: "x" | "z";
// };

// const defaultOptions: ImageVoxelizerOptions = {
//   width: 64,
//   height: 64,
//   lockedRatio: true,
//   orientation: "x",
// };

// /**
//  * A class that turns a given image into a mosaic of block textures registered in the {@link World}.
//  *
//  * # Example
//  * ```ts
//  * ImageVoxelizer.build(
//  *   "https://i.imgur.com/0Z0Z0Z0.png",
//  *   world,
//  *   new THREE.Vector3(0, 0, 0),
//  *   {
//  *     width: 64,
//  *     height: 64,
//  *     lockedRatio: true,
//  *     orientation: "x",
//  *   }
//  * ).then((success) => {
//  *   if (success) {
//  *     console.log("Image voxelized successfully!");
//  *   } else {
//  *     console.log("Image voxelization failed.");
//  *   }
//  * });
//  * ```
//  *
//  * ![ImageVoxelizer example](/img/docs/image-voxelizer.png)
//  */
// export class ImageVoxelizer {
//   /**
//    * Parse a command line string into image voxelization options.
//    *
//    * @example
//    * ```js
//    * // Parsing a command line string
//    * // https://example.com/image.png { "width": 64, "height": 64, "lockedRatio": true, "orientation": "x" }
//    * // Turns into this object
//    * {
//    *   url: "https://example.com/image.png",
//    *   options: {
//    *     width: 64,
//    *     height: 64,
//    *     lockedRatio: true,
//    *     orientation: "x"
//    *   }
//    * }
//    * ```
//    *
//    * @param rest The rest of the command string to be parsed.
//    * @returns
//    */
//   static parse = (rest: string) => {
//     const index = rest.indexOf("{") === -1 ? rest.length : rest.indexOf("{");

//     let imgURL = rest.substring(0, index).trim();

//     if (imgURL.startsWith('"')) {
//       imgURL = imgURL.substring(1);
//     }
//     if (imgURL.endsWith('"')) {
//       imgURL = imgURL.substring(0, imgURL.length - 1);
//     }

//     let options: Partial<ImageVoxelizerOptions>;

//     try {
//       options = JSON.parse(rest.substring(index) || "{}");
//     } catch (e) {
//       throw new Error("Image voxelizer could not parse options.");
//     }

//     return {
//       url: imgURL,
//       options: {
//         ...defaultOptions,
//         ...options,
//       } as ImageVoxelizerOptions,
//     };
//   };

//   /**
//    * Build a list of block updates that corresponds to a mosaic of the given image using the textures registered in the given world's registry.
//    *
//    * @param imgURL The URL of the image to be voxelized. This will be used to create an `Image` object.
//    * @param world The world to be updated.
//    * @param position The position to start voxelizing the image. This will be the bottom middle of the voxelized image.
//    * @param options The extra options to process the image voxelization.
//    * @returns A list of block updates that corresponds to a mosaic of the given image.
//    */
//   static build = async (
//     imgURL: string,
//     world: World,
//     position: Vector3,
//     options: ImageVoxelizerOptions
//   ) => {
//     console.log(`Starting to voxelize image: ${imgURL}`);

//     const {
//       atlas: { canvas },
//     } = world;

//     const getPixelAt = (
//       context: CanvasRenderingContext2D,
//       x: number,
//       y: number
//     ) => {
//       const {
//         data: [r, g, b, a],
//       } = context.getImageData(x, y, 1, 1);
//       return {
//         r,
//         g,
//         b,
//         a,
//       };
//     };

//     const colorDistSqr = (color1: number[], color2: number[]) => {
//       return (
//         (color1[0] - color2[0]) ** 2 +
//         (color1[1] - color2[1]) ** 2 +
//         (color1[2] - color2[2]) ** 2 +
//         (color1[3] - color2[3]) ** 2
//       );
//     };

//     const { width, height } = canvas;
//     const context = canvas.getContext("2d");
//     const metrics = new Map<number, [number, number, number, number]>();

//     world.registry.blocksById.forEach((block) => {
//       // const { block } = world.getBlockByTextureName(name);
//       const { faces, id } = block;

//       if (!block.isOpaque) {
//         return;
//       }

//       faces.forEach((face) => {
//         const {
//           name,
//           range: { startU, endU, startV, endV },
//         } = face;

//         if (
//           ["px", "py", "pz", "nx", "ny", "nz"].filter((key) =>
//             name.endsWith(key)
//           ).length === 0
//         ) {
//           return;
//         }

//         // TODO: add orientation
//         const startX = startU * width;
//         const startY = startV * height;
//         const endX = endU * width;
//         const endY = endV * height;
//         let sumR = 0;
//         let sumG = 0;
//         let sumB = 0;
//         let sumA = 0;
//         let count = 0;
//         for (let x = startX; x <= endX; x++) {
//           for (let y = startY; y <= endY; y++) {
//             const { r, g, b, a } = getPixelAt(context, x, height - y);
//             sumR += r;
//             sumG += g;
//             sumB += b;
//             sumA += a;
//             count++;
//           }
//         }
//         const avgR = sumR / count;
//         const avgG = sumG / count;
//         const avgB = sumB / count;
//         const avgA = sumA / count;
//         metrics.set(id, [avgR, avgG, avgB, avgA]);
//       });
//     });

//     const getClosest = (color1: number[]) => {
//       let key = -1;
//       let minDistance = Number.MAX_VALUE;
//       metrics.forEach((color2, name) => {
//         const dist = colorDistSqr(color1, color2);
//         if (minDistance > dist) {
//           minDistance = dist;
//           key = name;
//         }
//       });
//       return key;
//     };

//     const updates = await new Promise<BlockUpdate[] | boolean>((resolve) => {
//       const original = new Image();

//       original.crossOrigin = "Anonymous";

//       original.onload = () => {
//         const canvas = document.createElement("canvas");
//         const context = canvas.getContext("2d");
//         let { width, height, orientation } = options;
//         const { lockedRatio } = options;
//         if (lockedRatio) {
//           width = (height * original.width) / original.height;
//         }
//         width = Math.floor(width);
//         height = Math.floor(height);
//         width = width % 2 === 0 ? width : width + 1;
//         height = height % 2 === 0 ? height : height + 1;
//         canvas.width = width;
//         canvas.height = height;
//         orientation = orientation.toLowerCase() as "x" | "z";
//         console.log(
//           `Voxelizing original image (${original.width}, ${original.height}) to (${width}, ${height})`
//         );
//         context.drawImage(
//           original,
//           0,
//           0,
//           original.width,
//           original.height,
//           0,
//           0,
//           width,
//           height
//         );
//         const updates: BlockUpdate[] = [];
//         const [baseX, baseY, baseZ] = position
//           .toArray()
//           .map((n) => Math.floor(n));
//         for (let x = 0; x < width; x++) {
//           for (let y = 0; y < height; y++) {
//             const { r, g, b, a } = getPixelAt(context, x, y);
//             const closest = getClosest([r, g, b, a]);
//             if (closest < 0) continue;
//             const block = world.getBlockById(closest);
//             updates.push({
//               vx: orientation === "z" ? baseX : baseX - width / 2 + x,
//               vy: baseY + height - y,
//               vz: orientation === "z" ? baseZ - width / 2 + x : baseZ,
//               type: block ? block.id : 0,
//             });
//           }
//         }
//         resolve(updates);
//       };

//       original.onerror = (error) => {
//         console.error(error);
//         resolve(false);
//       };

//       original.src = imgURL;
//     });

//     if (!Array.isArray(updates)) {
//       return false;
//     }

//     world.updateVoxels(updates);

//     return true;
//   };

//   private constructor() {
//     // do nothing
//   }
// }
