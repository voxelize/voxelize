import * as THREE from "three";

const BONE_TEXTURE_MAX_WIDTH = 2048;
const IDENTITY_MATRIX_ELEMENTS = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
] as const;

export class BoneTextureManager {
  private texture: THREE.DataTexture;
  private data: Uint16Array;
  private width: number;
  private height: number;
  private bonesPerInstance: number;
  private maxInstances: number;
  private freeSlots: number[] = [];
  private usedSlots: Set<number> = new Set();
  private dirtyMinPixel = Infinity;
  private dirtyMaxPixel = -1;

  constructor(maxInstances: number, bonesPerInstance: number) {
    this.maxInstances = maxInstances;
    this.bonesPerInstance = bonesPerInstance;

    const pixelsPerInstance = bonesPerInstance * 4;
    this.width = Math.min(
      BONE_TEXTURE_MAX_WIDTH,
      pixelsPerInstance * maxInstances,
    );
    this.height = Math.ceil((pixelsPerInstance * maxInstances) / this.width);

    const totalPixels = this.width * this.height;
    this.data = new Uint16Array(totalPixels * 4);

    for (let i = 0; i < maxInstances; i++) {
      for (let b = 0; b < bonesPerInstance; b++) {
        this.setIdentityMatrix(i, b);
      }
    }

    this.texture = new THREE.DataTexture(
      this.data,
      this.width,
      this.height,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    );
    this.texture.needsUpdate = true;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;

    for (let i = maxInstances - 1; i >= 0; i--) {
      this.freeSlots.push(i);
    }
  }

  private markDirty(instanceIndex: number, boneIndex: number): void {
    const pixelStart = (instanceIndex * this.bonesPerInstance + boneIndex) * 4;
    const pixelEnd = pixelStart + 3;
    if (pixelStart < this.dirtyMinPixel) this.dirtyMinPixel = pixelStart;
    if (pixelEnd > this.dirtyMaxPixel) this.dirtyMaxPixel = pixelEnd;
  }

  private setIdentityMatrix(instanceIndex: number, boneIndex: number): void {
    const pixelOffset = (instanceIndex * this.bonesPerInstance + boneIndex) * 4;
    const dataOffset = pixelOffset * 4;

    this.setMatrixData(dataOffset, IDENTITY_MATRIX_ELEMENTS);
    this.markDirty(instanceIndex, boneIndex);
  }

  private setMatrixData(dataOffset: number, elements: ArrayLike<number>): void {
    for (let i = 0; i < 16; i++) {
      this.data[dataOffset + i] = THREE.DataUtils.toHalfFloat(elements[i]);
    }
  }

  allocate(): number {
    const slot = this.freeSlots.pop();
    if (slot === undefined) {
      console.warn("BoneTextureManager: No free slots available");
      return -1;
    }
    this.usedSlots.add(slot);

    for (let b = 0; b < this.bonesPerInstance; b++) {
      this.setIdentityMatrix(slot, b);
    }

    return slot;
  }

  free(slot: number): void {
    if (!this.usedSlots.has(slot)) {
      console.warn("BoneTextureManager: Trying to free unused slot", slot);
      return;
    }
    this.usedSlots.delete(slot);
    this.freeSlots.push(slot);

    for (let b = 0; b < this.bonesPerInstance; b++) {
      this.setIdentityMatrix(slot, b);
    }
  }

  setBoneMatrix(
    instanceIndex: number,
    boneIndex: number,
    matrix: THREE.Matrix4,
  ): void {
    if (instanceIndex < 0 || instanceIndex >= this.maxInstances) return;
    if (boneIndex < 0 || boneIndex >= this.bonesPerInstance) return;

    const pixelOffset = (instanceIndex * this.bonesPerInstance + boneIndex) * 4;
    const dataOffset = pixelOffset * 4;

    this.setMatrixData(dataOffset, matrix.elements);
    this.markDirty(instanceIndex, boneIndex);
  }

  // Uploads only the rows covering the dirty pixel range with a raw
  // texSubImage2D. Marking the whole texture with `needsUpdate` re-uploaded
  // every pool's full bone texture each animated frame, and three's partial
  // paths (updateRanges, copyTextureToTexture) bracket uploads with
  // synchronous gl.getParameter round-trips to the GPU process that stall
  // the main thread for longer than the upload itself.
  upload(renderer: THREE.WebGLRenderer): void {
    if (this.dirtyMaxPixel < 0) return;

    const textureProperties = renderer.properties.get(this.texture) as {
      __webglTexture?: WebGLTexture;
    };
    if (!textureProperties.__webglTexture) {
      // Not GPU-resident yet: the first bind uploads the full data array.
      this.texture.needsUpdate = true;
      this.dirtyMinPixel = Infinity;
      this.dirtyMaxPixel = -1;
      return;
    }

    const gl = renderer.getContext() as WebGL2RenderingContext;
    const startRow = Math.floor(this.dirtyMinPixel / this.width);
    const endRow = Math.floor(this.dirtyMaxPixel / this.width);
    const rowCount = endRow - startRow + 1;

    renderer.state.bindTexture(gl.TEXTURE_2D, textureProperties.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.texture.flipY);
    gl.pixelStorei(
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
      this.texture.premultiplyAlpha,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, this.texture.unpackAlignment);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      startRow,
      this.width,
      rowCount,
      gl.RGBA,
      gl.HALF_FLOAT,
      this.data,
      startRow * this.width * 4,
    );
    renderer.state.unbindTexture();

    this.dirtyMinPixel = Infinity;
    this.dirtyMaxPixel = -1;
  }

  getTexture(): THREE.DataTexture {
    return this.texture;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getBonesPerInstance(): number {
    return this.bonesPerInstance;
  }

  getActiveCount(): number {
    return this.usedSlots.size;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
