importScripts("https://cdn.jsdelivr.net/npm/noisejs@2.1.0/index.min.js");

function set(arr, x, y, z, stride, value) {
  arr[x * stride[0] + y * stride[1] + z * stride[2]] = value;
}

// @ts-ignore
const perlin = (function () {
  const p = (function () {
    // Perlin's artisanal shuffle
    const p_bootstrap = [
      151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
      140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247,
      120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177,
      33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165,
      71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211,
      133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25,
      63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196,
      135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217,
      226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206,
      59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248,
      152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22,
      39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218,
      246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
      81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
      184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
      222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
    ];
    return new Uint8Array(p_bootstrap.concat(p_bootstrap));
  })();

  const fade = function (t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

  const lerp = function (t, a, b) {
    return a + t * (b - a);
  };

  const grad = function (hash, x, y, z) {
    const h = hash & 15; // CONVERT LO 4 BITS OF HASH CODE
    const u = h < 8 ? x : y, // INTO 12 GRADIENT DIRECTIONS.
      v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  const noisefunc = function (x, y, z) {
    const X = Math.floor(x) & 255,
      Y = Math.floor(y) & 255,
      Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x),
      v = fade(y),
      w = fade(z);
    const A = p[X] + Y,
      AA = p[A] + Z,
      AB = p[A + 1] + Z, // HASH COORDINATES OF
      B = p[X + 1] + Y,
      BA = p[B] + Z,
      BB = p[B + 1] + Z; // THE 8 CUBE CORNERS,
    return lerp(
      w,
      lerp(
        v,
        lerp(
          u,
          grad(p[AA], x, y, z), // AND ADD
          grad(p[BA], x - 1, y, z)
        ), // BLENDED
        lerp(
          u,
          grad(p[AB], x, y - 1, z), // RESULTS
          grad(p[BB], x - 1, y - 1, z)
        )
      ), // FROM  8
      lerp(
        v,
        lerp(
          u,
          grad(p[AA + 1], x, y, z - 1), // CORNERS
          grad(p[BA + 1], x - 1, y, z - 1)
        ), // OF CUBE
        lerp(
          u,
          grad(p[AB + 1], x, y - 1, z - 1),
          grad(p[BB + 1], x - 1, y - 1, z - 1)
        )
      )
    );
  };
  return noisefunc;
})();

const perlinOctaves = function () {
  if (arguments.length) {
    // eslint-disable-next-line prefer-rest-params
    const args = Array.prototype.slice.call(arguments, 0);
    const funcs = args.map(function (n, i) {
      return function (x, y, z) {
        const pow2 = (1 << i) * 0.05; //FIXME: Maybe shouldn't be power 2?
        return n * perlin(pow2 * x, pow2 * y, pow2 * z);
      };
    });
    return function (x, y, z) {
      return funcs.reduce(function (prev, f) {
        return f(x, y, z) + prev;
      }, 0);
    };
  } else {
    return perlin;
  }
};

const perlinFalloff = function (octaves, falloff) {
  const a = Array(octaves);
  let f = 1;
  for (let i = 0; i < a.length; i++) {
    a[i] = f;
    f *= falloff;
  }
  return perlinOctaves.apply(this, a);
};

onmessage = function (e) {
  const {
    data: dataBuffer,
    configs: { min, max, scale, threshold, stride, octaves, falloff },
  } = e.data;

  // @ts-ignore
  const octaveNoise = perlinFalloff(octaves, falloff);

  const data = new Uint8Array(dataBuffer);

  const [startX, startY, startZ] = min;
  const [endX, endY, endZ] = max;

  for (let vx = startX, lx = 0; vx < endX; ++vx, ++lx) {
    for (let vz = startZ, lz = 0; vz < endZ; ++vz, ++lz) {
      for (let vy = startY, ly = 0; vy < endY; ++vy, ++ly) {
        const noiseVal = octaveNoise(vx * scale, vy * scale, vz * scale);
        const value = Math.abs(noiseVal) > threshold ? 1 : 0;
        set(data, lx, ly, lz, stride, value);
      }
    }
  }

  // @ts-ignore
  postMessage(data, [data.buffer]);
};
