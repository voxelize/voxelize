//! A world taller than the 256-block default. Nothing in generation,
//! lighting, meshing or the wire format may pin itself to 255/256: a block at
//! the very top row of a 384-tall world must be stored, shade the column
//! under it, mesh in the top section, and survive the trip through
//! `encode_message`. 32-tall sections, as a game that raises its ceiling
//! would keep them.

use std::io::Read;
use std::time::{Duration, Instant};

use lz4_flex::block::decompress_size_prepended;
use lz4_flex::frame::FrameDecoder;

use crate::{
    decode_message, encode_message, Block, BlockUtils, Chunk, ChunkOptions, Chunks, Mesher,
    Message, MessageType, Registry, Vec2, VoxelAccess, WorldConfig,
};

const STONE: u32 = 1;
const SIZE: usize = 16;
const MAX_HEIGHT: usize = 384;
const SUB_CHUNKS: usize = 12;
const SECTION: i32 = (MAX_HEIGHT / SUB_CHUNKS) as i32;
const FLOOR_Y: i32 = 80;
const TOP_Y: i32 = MAX_HEIGHT as i32 - 1;
/// The ceiling block's column.
const BX: i32 = 5;
const BZ: i32 = 7;

fn registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_block(&Block::new("Stone").id(STONE).build());
    registry
}

fn config() -> WorldConfig {
    WorldConfig::new()
        .chunk_size(SIZE)
        .max_height(MAX_HEIGHT)
        .sub_chunks(SUB_CHUNKS)
        .max_light_level(15)
        .min_chunk([-1, -1])
        .max_chunk([1, 1])
        // Mesh on the server here: the test reads the sections back.
        .client_only_meshing(false)
        .build()
}

/// A 3x3 world of chunks, each a solid stone slab up to `FLOOR_Y`, with one
/// stone block on the top row of the centre chunk.
fn world() -> (Chunks, Registry, WorldConfig) {
    let registry = registry();
    let config = config();
    let mut chunks = Chunks::new(&config);
    for cx in -1..=1 {
        for cz in -1..=1 {
            let mut chunk = Chunk::new(
                "tall",
                cx,
                cz,
                &ChunkOptions {
                    size: SIZE,
                    max_height: MAX_HEIGHT,
                    sub_chunks: SUB_CHUNKS,
                },
            );
            for x in 0..SIZE as i32 {
                for z in 0..SIZE as i32 {
                    for y in 0..=FLOOR_Y {
                        chunk.set_voxel(cx * SIZE as i32 + x, y, cz * SIZE as i32 + z, STONE);
                    }
                }
            }
            if cx == 0 && cz == 0 {
                assert!(chunk.set_voxel(BX, TOP_Y, BZ, STONE));
            }
            chunk.calculate_max_height(&registry);
            chunks.add(chunk);
        }
    }
    (chunks, registry, config)
}

/// Light and mesh the centre chunk the way a load does: the server's own
/// `Mesher`, sunlight flood over the 3x3 neighbourhood, greedy mesh per
/// section.
fn light_and_mesh(chunks: &Chunks, registry: &Registry, config: &WorldConfig) -> Chunk {
    let coords = Vec2(0, 0);
    let space = chunks
        .make_space(&coords, config.max_light_level as usize)
        .needs_height_maps()
        .needs_voxels()
        .strict()
        .build();
    let chunk = chunks.raw(&coords).unwrap().clone();
    let mut mesher = Mesher::new();
    mesher.process(vec![(chunk, space)], &MessageType::Load, registry, config);
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if let Some((chunk, _)) = mesher.results().pop() {
            return chunk;
        }
        assert!(Instant::now() < deadline, "the mesher never returned the chunk");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn a_block_on_the_top_row_of_a_384_tall_world_is_stored_lit_meshed_and_sent() {
    let (chunks, registry, config) = world();
    assert_eq!(config.max_height, MAX_HEIGHT);
    assert_eq!(config.max_height / config.sub_chunks, 32);

    let chunk = light_and_mesh(&chunks, &registry, &config);

    // Stored: the voxel and the height map both reach the top row.
    assert_eq!(chunk.get_voxel(BX, TOP_Y, BZ), STONE);
    assert_eq!(chunk.get_max_height(BX, BZ), TOP_Y as u32);
    assert_eq!(chunk.get_max_height(BX + 1, BZ), FLOOR_Y as u32);
    assert_eq!(chunk.voxels.shape, vec![SIZE, MAX_HEIGHT, SIZE]);
    assert_eq!(chunk.lights.shape, vec![SIZE, MAX_HEIGHT, SIZE]);

    // Lit: open columns carry full sunlight from the lid to the floor; the
    // column under the ceiling block is shaded one step, fed sideways by
    // its neighbours, the whole way down.
    for y in (FLOOR_Y + 1)..=TOP_Y {
        assert_eq!(chunk.get_sunlight(BX + 1, y, BZ), 15, "open column at y={y}");
    }
    for y in (FLOOR_Y + 1)..TOP_Y {
        assert_eq!(chunk.get_sunlight(BX, y, BZ), 14, "shaded column at y={y}");
    }
    assert_eq!(chunk.get_sunlight(BX, TOP_Y, BZ), 0, "inside the block");
    assert_eq!(chunk.get_sunlight(BX, FLOOR_Y, BZ), 0, "inside the floor");

    // Meshed: the slab's underside sits in the first section, its top face
    // in the floor's, the ceiling block in the twelfth, and the nine
    // sections of pure air between floor and lid are empty.
    let meshes = chunk.meshes.as_ref().expect("the load meshed the chunk");
    assert_eq!(meshes.len(), SUB_CHUNKS);
    let floor_level = (FLOOR_Y / SECTION) as u32;
    let top_level = (TOP_Y / SECTION) as u32;
    assert_eq!(top_level, SUB_CHUNKS as u32 - 1);
    for level in 0..SUB_CHUNKS as u32 {
        let geometries = &meshes[&level].geometries;
        let expect_faces = level == 0 || level == floor_level || level == top_level;
        assert_eq!(
            !geometries.is_empty(),
            expect_faces,
            "section {level} geometry: {}",
            geometries.len()
        );
    }

    // Sent: the data message round-trips with the top-row voxel intact and
    // both arrays sized by the configured height, not by 256.
    let model = chunk.to_model(true, true, 0..SUB_CHUNKS as u32);
    let message = Message::new(&MessageType::Load).chunks(&[model]).build();
    let bytes = encode_message(&message);
    assert!(!bytes.is_empty());
    // Past the size threshold the whole message travels lz4-framed; the
    // client unframes it before the protobuf decode, and so does this test.
    let mut unframed = Vec::new();
    FrameDecoder::new(&bytes[..])
        .read_to_end(&mut unframed)
        .expect("lz4 frame");
    let decoded = decode_message(&unframed).expect("the message decodes");
    let wire = &decoded.chunks[0];
    let voxels = decompress_size_prepended(&wire.voxels).expect("lz4 voxels");
    let lights = decompress_size_prepended(&wire.lights).expect("lz4 lights");
    assert_eq!(voxels.len(), SIZE * MAX_HEIGHT * SIZE * 4);
    assert_eq!(lights.len(), SIZE * MAX_HEIGHT * SIZE * 4);
    let at = chunk
        .voxels
        .index(&[BX as usize, TOP_Y as usize, BZ as usize])
        * 4;
    let raw = u32::from_le_bytes(voxels[at..at + 4].try_into().unwrap());
    assert_eq!(BlockUtils::extract_id(raw), STONE);
    let above_floor = chunk
        .voxels
        .index(&[BX as usize, (TOP_Y - 1) as usize, BZ as usize])
        * 4;
    let raw = u32::from_le_bytes(voxels[above_floor..above_floor + 4].try_into().unwrap());
    assert_eq!(BlockUtils::extract_id(raw), 0);
    assert_eq!(
        decoded.chunks[0]
            .meshes
            .iter()
            .filter(|mesh| !mesh.geometries.is_empty())
            .count(),
        3
    );
}

/// The sky is nearly free on the wire: 128 more rows of air and open
/// sunlight are 256 KiB of raw voxel and light data, and lz4 folds them
/// into about a kilobyte (a few bytes per row), not into half again the
/// payload.
#[test]
fn the_extra_sky_of_a_taller_world_barely_grows_the_chunk_payload() {
    let payload_bytes = |max_height: usize| {
        let sub_chunks = max_height / 32;
        let registry = registry();
        let config = WorldConfig::new()
            .chunk_size(SIZE)
            .max_height(max_height)
            .sub_chunks(sub_chunks)
            .max_light_level(15)
            .min_chunk([-1, -1])
            .max_chunk([1, 1])
            .build();
        let mut chunks = Chunks::new(&config);
        for cx in -1..=1 {
            for cz in -1..=1 {
                let mut chunk = Chunk::new(
                    "slab",
                    cx,
                    cz,
                    &ChunkOptions {
                        size: SIZE,
                        max_height,
                        sub_chunks,
                    },
                );
                for x in 0..SIZE as i32 {
                    for z in 0..SIZE as i32 {
                        for y in 0..=FLOOR_Y {
                            chunk.set_voxel(cx * SIZE as i32 + x, y, cz * SIZE as i32 + z, STONE);
                        }
                    }
                }
                chunk.calculate_max_height(&registry);
                chunks.add(chunk);
            }
        }
        let chunk = light_and_mesh(&chunks, &registry, &config);
        let model = chunk.to_model(false, true, 0..sub_chunks as u32);
        encode_message(&Message::new(&MessageType::Load).chunks(&[model]).build()).len()
    };
    let short = payload_bytes(256);
    let tall = payload_bytes(384);
    let extra_rows = 384 - 256;
    let raw_growth = extra_rows * SIZE * SIZE * 4 * 2;
    assert!(tall > short, "384-tall payload {tall} B vs 256-tall {short} B");
    assert!(
        tall - short <= extra_rows * 16,
        "384-tall payload {tall} B vs 256-tall {short} B: {} B per extra row of sky ({raw_growth} B raw)",
        (tall - short) / extra_rows
    );
}
