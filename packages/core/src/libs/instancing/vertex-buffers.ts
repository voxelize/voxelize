import {
  type BufferAttribute,
  type BufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from "three/webgpu";

/**
 * WebGPU binds at most 8 vertex buffers to a pipeline (and three adds one
 * for an instanced mesh's matrices), and every separate attribute is a
 * buffer. A creature's geometry carries eight per-vertex attributes and four
 * per-instance ones: as separate buffers it cannot be drawn at all.
 *
 * This interleaves a geometry's float attributes into one buffer per rate:
 * the per-vertex ones into one, the per-instance ones into another, each a
 * Float32 array with the attributes side by side. The attributes keep their
 * names and API (`setX`, `needsUpdate` reach the shared buffer), so code
 * that holds them by name keeps working; code holding the old attribute
 * objects must take the returned ones. Integer and normalized attributes
 * become plain floats, which the shaders read them as anyway. Runs once,
 * where a geometry is built, never per frame.
 */
export function packVertexBuffers(
  geometry: BufferGeometry,
): Map<string, InterleavedBufferAttribute> {
  const packed = new Map<string, InterleavedBufferAttribute>();
  const groups: { instanced: boolean; names: string[] }[] = [
    { instanced: false, names: [] },
    { instanced: true, names: [] },
  ];
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const source = attribute as BufferAttribute & {
      isInstancedBufferAttribute?: boolean;
      isInterleavedBufferAttribute?: boolean;
    };
    if (source.isInterleavedBufferAttribute) continue;
    groups[source.isInstancedBufferAttribute ? 1 : 0].names.push(name);
  }

  for (const { instanced, names } of groups) {
    if (names.length < 2) continue;
    const attributes = names.map(
      (name) => geometry.getAttribute(name) as BufferAttribute,
    );
    const count = attributes[0].count;
    if (attributes.some((attribute) => attribute.count !== count)) continue;
    const stride = attributes.reduce(
      (sum, attribute) => sum + attribute.itemSize,
      0,
    );
    const array = new Float32Array(count * stride);
    let offset = 0;
    for (const attribute of attributes) {
      const { itemSize } = attribute;
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < itemSize; c++) {
          array[i * stride + offset + c] = attribute.getComponent(i, c);
        }
      }
      offset += itemSize;
    }
    const buffer = instanced
      ? new InstancedInterleavedBuffer(
          array,
          stride,
          (attributes[0] as BufferAttribute & { meshPerAttribute?: number })
            .meshPerAttribute ?? 1,
        )
      : new InterleavedBuffer(array, stride);
    buffer.setUsage(attributes[0].usage);
    offset = 0;
    names.forEach((name, index) => {
      const attribute = attributes[index];
      const view = new InterleavedBufferAttribute(
        buffer,
        attribute.itemSize,
        offset,
        false,
      );
      view.name = name;
      geometry.setAttribute(name, view);
      packed.set(name, view);
      offset += attribute.itemSize;
    });
  }
  return packed;
}
