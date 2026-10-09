use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine};
use libflate::zlib::Encoder;
use serde_json::Value;

use crate::{Block, BlockFaces, Chunk, ChunkOptions, Registry, Vec3, VoxelAccess, WorldConfig};

use super::*;

const STONE: u32 = 1;
const SAND: u32 = 2;

fn registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_blocks(&[
        Block::new("Stone")
            .id(STONE)
            .faces(&BlockFaces::six_faces().build())
            .build(),
        Block::new("Sand")
            .id(SAND)
            .faces(&BlockFaces::six_faces().build())
            .build(),
    ]);
    registry.generate();
    registry
}

fn config() -> WorldConfig {
    WorldConfig {
        chunk_size: 16,
        max_height: 64,
        max_light_level: 15,
        sub_chunks: 2,
        ..Default::default()
    }
}

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "voxelize-viewer-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Flat stone four blocks deep; chunk (0, 0) also throws one sand block
/// into chunk (1, 0) the way a tree's leaves cross a border.
struct Flat {
    registry: Registry,
    config: WorldConfig,
}

impl ViewerSource for Flat {
    fn registry(&self) -> &Registry {
        &self.registry
    }

    fn config(&self) -> &WorldConfig {
        &self.config
    }

    fn describe(&self) -> SourceDescription {
        SourceDescription {
            name: "flat".into(),
            far: None,
            layers: vec![],
            chunk_bounds: None,
            info: Value::Null,
            warnings: vec![],
        }
    }

    fn chunk(&self, cx: i32, cz: i32) -> Result<Option<SourceChunk>, String> {
        let options = ChunkOptions {
            size: 16,
            max_height: 64,
            sub_chunks: 2,
        };
        let mut chunk = Chunk::new("flat", cx, cz, &options);
        let Vec3(min_x, _, min_z) = chunk.min;
        for x in min_x..min_x + 16 {
            for z in min_z..min_z + 16 {
                for y in 0..4 {
                    chunk.set_voxel(x, y, z, STONE);
                }
            }
        }
        chunk.calculate_max_height(&self.registry);
        let extra = if (cx, cz) == (0, 0) {
            vec![(Vec3(17, 4, 3), SAND)]
        } else {
            vec![]
        };
        Ok(Some(SourceChunk { chunk, extra }))
    }
}

#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl Write for Captured {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn replies(out: &Captured) -> Vec<Value> {
    String::from_utf8(out.0.lock().unwrap().clone())
        .unwrap()
        .lines()
        .filter_map(|line| line.strip_prefix(LINE_PREFIX))
        .map(|json| serde_json::from_str(json).unwrap())
        .collect()
}

fn launch(root: &Path) -> ViewerLaunch {
    serde_json::from_value(serde_json::json!({
        "out": root.join("out"),
        "meshDir": root.join("meshes"),
        "threads": 2,
    }))
    .unwrap()
}

fn serve(root: &Path, requests: &[&str]) -> Vec<Value> {
    let out = Captured::default();
    let input = Cursor::new(requests.join("\n"));
    serve_viewer(
        Flat {
            registry: registry(),
            config: config(),
        },
        launch(root),
        input,
        Box::new(out.clone()),
    )
    .unwrap();
    replies(&out)
}

fn by_id(replies: &[Value], id: u64) -> &Value {
    replies
        .iter()
        .find(|r| r["id"] == id)
        .unwrap_or_else(|| panic!("no reply {id} in {replies:?}"))
}

#[test]
fn a_chunk_is_meshed_once_and_reused_by_the_next_process() {
    let root = scratch("reuse");
    let first = serve(&root, &[r#"{"op":"chunks","id":1,"chunks":[[0,0],[1,0]]}"#]);
    assert_eq!(first[0]["event"], "ready");
    let rows = by_id(&first, 1)["chunks"].as_array().unwrap().clone();
    assert_eq!(rows.len(), 2);
    for row in &rows {
        assert_eq!(row["cached"], false, "{row}");
        let bytes = std::fs::read(row["file"].as_str().unwrap()).unwrap();
        assert_eq!(&bytes[..4], CHUNK_MESH_MAGIC);
    }
    let again = serve(&root, &[r#"{"op":"chunks","id":7,"chunks":[[0,0],[1,0]]}"#]);
    let rows_again = by_id(&again, 7)["chunks"].as_array().unwrap().clone();
    for (a, b) in rows.iter().zip(&rows_again) {
        assert_eq!(b["cached"], true, "{b}");
        assert_eq!(a["key"], b["key"]);
    }
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn cross_chunk_writes_land_on_their_target() {
    let root = scratch("extras");
    let replies = serve(
        &root,
        &[r#"{"op":"query","id":2,"points":[[17,3],[20,3]]}"#],
    );
    let points = by_id(&replies, 2)["points"].as_array().unwrap().clone();
    assert_eq!(points[0]["top"]["name"], "Sand", "{}", points[0]);
    assert_eq!(points[0]["top"]["y"], 4);
    assert_eq!(points[1]["top"]["name"], "Stone", "{}", points[1]);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn the_chunk_mesh_header_and_summary_follow_the_documented_layout() {
    let root = scratch("layout");
    let replies = serve(&root, &[r#"{"op":"chunks","id":3,"chunks":[[1,0]]}"#]);
    let row = &by_id(&replies, 3)["chunks"][0];
    let bytes = std::fs::read(row["file"].as_str().unwrap()).unwrap();
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let i32_at = |at: usize| i32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    assert_eq!(u32_at(4), FORMAT_VERSION);
    assert_eq!((i32_at(8), i32_at(12)), (1, 0));
    assert_eq!((u32_at(16), u32_at(20), u32_at(24)), (16, 64, 32));
    // Summary starts after the tint flag and 12 tint bytes; the column at
    // local (1, 3) (world 17, 3) holds the landed sand.
    let summary = 32 + 12;
    let column = summary + (3 * 16 + 1) * 10;
    let u16_at = |at: usize| u16::from_le_bytes(bytes[at..at + 2].try_into().unwrap());
    assert_eq!(u16_at(column), 5, "top is y 4 + 1");
    assert_eq!(u16_at(column + 2), SAND as u16);
    let geometries = u32_at(summary + 16 * 16 * 10);
    assert!(geometries > 0, "a stone floor meshes to something");
    std::fs::remove_dir_all(&root).ok();
}

fn write_saved_chunk(dir: &Path, cx: i32, cz: i32, fill: u32) {
    let options = ChunkOptions {
        size: 16,
        max_height: 64,
        sub_chunks: 2,
    };
    let mut chunk = Chunk::new("saved", cx, cz, &options);
    let Vec3(min_x, _, min_z) = chunk.min;
    for x in min_x..min_x + 16 {
        for z in min_z..min_z + 16 {
            for y in 0..2 {
                chunk.set_voxel(x, y, z, fill);
            }
        }
    }
    let encode = |words: &[u32]| {
        let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        let mut encoder = Encoder::new(Vec::new()).unwrap();
        encoder.write_all(&bytes).unwrap();
        STANDARD.encode(encoder.finish().into_result().unwrap())
    };
    let body = serde_json::json!({
        "id": format!("{cx}-{cz}"),
        "voxels": encode(&chunk.voxels.data),
        "heightMap": encode(&vec![1u32; 256]),
        "version": 1,
    });
    std::fs::write(dir.join(format!("{cx}|{cz}.json")), body.to_string()).unwrap();
}

fn listing(dir: &Path) -> Vec<(String, u64)> {
    let mut out: Vec<(String, u64)> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| {
            (
                e.file_name().to_string_lossy().to_string(),
                e.metadata().unwrap().len(),
            )
        })
        .collect();
    out.sort();
    out
}

#[test]
fn saved_chunks_are_read_and_never_written_even_when_corrupt() {
    let root = scratch("saved");
    let dir = root.join("chunks");
    std::fs::create_dir_all(&dir).unwrap();
    write_saved_chunk(&dir, 0, 0, STONE);
    write_saved_chunk(&dir, 1, 0, SAND);
    std::fs::write(dir.join("2|0.json"), "{ not json").unwrap();
    let before = listing(&dir);

    let saved = SavedChunks::open("saved", &dir, registry(), config()).unwrap();
    assert_eq!(saved.config().chunk_size, 16);
    assert_eq!(saved.config().max_height, 64);
    assert_eq!(saved.describe().chunk_bounds, Some([0, 0, 2, 0]));
    let chunk = saved.load(1, 0).unwrap().unwrap();
    assert_eq!(chunk.get_voxel(20, 1, 4), SAND);
    assert!(saved.load(5, 5).unwrap().is_none());
    assert!(saved.load(2, 0).is_err(), "a corrupt file is an error");

    let tile = saved
        .far_tile(&FarTileSpec {
            x0: 0,
            z0: 0,
            step: 8,
            size: 5,
        })
        .unwrap();
    assert_eq!(tile.heights[0], 2, "two layers of stone, top face at 2");
    assert_eq!(tile.materials[2], SAND as u16, "x 16 is the sand chunk");
    assert_eq!(tile.heights[4], 0, "x 32 is the corrupt chunk, shown empty");

    assert_eq!(listing(&dir), before, "nothing in the save was touched");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn far_tile_samples_are_row_major_by_z_then_x() {
    let spec = FarTileSpec {
        x0: -16,
        z0: 32,
        step: 4,
        size: 3,
    };
    assert_eq!(spec.column(0), (-16, 32));
    assert_eq!(spec.column(1), (-12, 32));
    assert_eq!(spec.column(3), (-16, 36));
    let tile = FarTile {
        heights: vec![1; 9],
        materials: vec![2; 9],
        water: vec![0; 9],
        layers: vec![vec![7; 9]],
    };
    let bytes = encode_far_tile(&spec, &tile);
    assert_eq!(&bytes[..4], FAR_TILE_MAGIC);
    // 28-byte header, three u16 arrays of 9 padded to 20, one layer.
    assert_eq!(bytes.len(), 28 + 20 * 3 + 4 + 12);
}
