use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Chunk, Registry, VoxelUpdate, WorldConfig};

/// One chunk as a source hands it over: its voxels once its own generation
/// (or load) has finished, and the writes it aimed outside itself. The
/// backend lands those on their target chunks the way the server's
/// leftovers do, so a tree on a chunk border is whole in the viewer too.
pub struct SourceChunk {
    pub chunk: Chunk,
    pub extra: Vec<VoxelUpdate>,
}

/// A coarse heightfield tile: `size` x `size` samples `step` blocks apart,
/// starting at world (`x0`, `z0`), row-major by z then x.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FarTileSpec {
    pub x0: i32,
    pub z0: i32,
    pub step: i32,
    pub size: usize,
}

impl FarTileSpec {
    pub fn samples(&self) -> usize {
        self.size * self.size
    }

    /// World column of sample `i`.
    pub fn column(&self, i: usize) -> (i32, i32) {
        let (row, col) = (i / self.size, i % self.size);
        (
            self.x0 + col as i32 * self.step,
            self.z0 + row as i32 * self.step,
        )
    }
}

/// What a far tile's `materials` mean.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FarMaterials {
    /// Block ids; the viewer colours each by its block's top texture.
    Blocks,
    /// Classes the source defines; the host gives the viewer a colour per
    /// class, in this order.
    Classes { names: Vec<String> },
}

/// Element type of an extra far-tile raster.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LayerType {
    U8,
    U16,
    U32,
}

impl LayerType {
    pub fn bytes(self) -> usize {
        match self {
            LayerType::U8 => 1,
            LayerType::U16 => 2,
            LayerType::U32 => 4,
        }
    }
}

/// A raster every far tile of this source carries beside its heights, for
/// overlays keyed by x,z (a biome map, a landform mask).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: LayerType,
    /// Names of the values (an enumeration) or of the bits (`bits: true`).
    pub labels: Vec<String>,
    pub bits: bool,
}

/// A coarse heightfield tile's samples.
pub struct FarTile {
    /// Top face y of each sample's surface; 0 where there is nothing.
    pub heights: Vec<u16>,
    /// What each sample is made of (`FarMaterials`).
    pub materials: Vec<u16>,
    /// Top face y of water over each sample; 0 where there is none.
    pub water: Vec<u16>,
    /// One little-endian buffer per `LayerInfo`, in `describe().layers`
    /// order, `samples * type.bytes()` long.
    pub layers: Vec<Vec<u8>>,
}

/// A labelled place or footprint a source can point out (a structure, a
/// landmark), for a vector overlay.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub kind: String,
    pub label: String,
    pub detail: String,
    /// x, y, z of the point the label stands on.
    pub anchor: [i32; 3],
    /// x0, z0, x1, z1 (inclusive) footprint.
    pub bounds: [i32; 4],
}

/// How a source describes itself to the viewer.
pub struct SourceDescription {
    pub name: String,
    pub far: Option<FarMaterials>,
    pub layers: Vec<LayerInfo>,
    /// Inclusive chunk bounds the source has data in, when it knows them
    /// (a saved world); a generator is unbounded.
    pub chunk_bounds: Option<[i32; 4]>,
    /// Anything else the host wants on the viewer's meta: build identity,
    /// seed, a suggested starting pose.
    pub info: Value,
    /// Ways this source's output may differ from what a live server shows.
    pub warnings: Vec<String>,
}

/// Where the viewer's world comes from. A generator, a save on disk or a
/// game's own harness implements this; the backend does the rest
/// (cross-chunk writes, lighting, meshing, caching, the protocol).
pub trait ViewerSource: Send + Sync {
    fn registry(&self) -> &Registry;

    /// The world's config. Meshing reads its chunk size, height, sub-chunk
    /// count and light levels.
    fn config(&self) -> &WorldConfig;

    fn describe(&self) -> SourceDescription;

    /// The chunk at `cx, cz`, or `None` where the source has nothing (past
    /// a saved world's edge). An `Err` fails the request that needed it.
    fn chunk(&self, cx: i32, cz: i32) -> Result<Option<SourceChunk>, String>;

    /// A coarse tile for the far layer, without generating chunks; `None`
    /// when the source has no far layer.
    fn far_tile(&self, _spec: &FarTileSpec) -> Option<FarTile> {
        None
    }

    /// What the source knows about one column beyond its voxels.
    fn query(&self, _x: i32, _z: i32) -> Value {
        Value::Null
    }

    fn annotations(&self, _min: [i32; 2], _max: [i32; 2]) -> Vec<Annotation> {
        Vec::new()
    }
}
