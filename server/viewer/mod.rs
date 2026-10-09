//! The backend of `@voxelize/viewer`: a long-running process that turns a
//! world into what the browser viewer draws, with no server running, no
//! players and no network. A host gives it a [`ViewerSource`] (a world's
//! own generation via [`capture_world`] and [`PipelineSource`], saved chunk
//! files via [`SavedChunks`], or its own) and calls [`serve_viewer_stdio`];
//! the viewer's Node side speaks the protocol over the process's stdin and
//! stdout.
//!
//! For each requested chunk the backend lands its neighbours' cross-chunk
//! writes, floods light and meshes it with the server's own lighting and
//! greedy mesher (the load path `Mesher` runs), then writes a mesh file
//! keyed by the 3x3 neighbourhood's voxels, the registry and the world's
//! dimensions. A mesh is therefore reused by every later request, process
//! and source that agrees on those, which is what makes re-viewing a world
//! after a generation change cheap: only chunks whose voxels changed are
//! meshed again.
//!
//! Requests are JSON lines on stdin; replies are JSON lines on stdout
//! prefixed with [`LINE_PREFIX`]:
//!
//! ```text
//! {"op":"chunks","id":1,"chunks":[[0,0],[1,0]]}      mesh files (format.rs)
//! {"op":"far","id":2,"tiles":[{"x0":0,"z0":0,"step":8,"size":33}]}
//! {"op":"query","id":3,"points":[[12,-40]]}           top/ground/water + source facts
//! {"op":"annotations","id":4,"min":[-256,-256],"max":[256,256]}
//! {"op":"stats","id":5}   {"op":"evict","id":6}
//! ```
mod backend;
mod capture;
mod format;
mod pipeline;
mod saved;
mod source;

#[cfg(test)]
mod tests;

pub use backend::{
    read_launch, serve_viewer, serve_viewer_stdio, ViewerLaunch, LINE_PREFIX, PROTOCOL_VERSION,
};
pub use capture::{capture_world, CapturedWorld};
pub use format::{
    encode_chunk_mesh, encode_far_tile, summarize, BlockClasses, ColumnTop, LevelGeometry,
    CHUNK_MESH_MAGIC, FAR_TILE_MAGIC, FORMAT_VERSION,
};
pub use pipeline::PipelineSource;
pub use saved::SavedChunks;
pub use source::{
    Annotation, FarMaterials, FarTile, FarTileSpec, LayerInfo, LayerType, SourceChunk,
    SourceDescription, ViewerSource,
};
