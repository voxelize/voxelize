use crate::utils::{
    chunk::ChunkUtils,
    ndarray::Ndarray,
    vec::{Vec2, Vec3},
};

#[derive(Default, Clone)]
pub struct ChunkParams {
    size: usize,
    max_height: u32,
}

#[derive(Default)]
pub struct Chunk {
    pub id: String,
    pub name: String,
    pub coords: Vec2<i32>,

    pub voxels: Ndarray<u32>,
    pub lights: Ndarray<u32>,
    pub height_map: Ndarray<u32>,

    pub min: Vec3<i32>,
    pub max: Vec3<i32>,

    pub params: ChunkParams,
}

impl Chunk {
    pub fn new(id: &str, cx: i32, cz: i32, params: &ChunkParams) -> Self {
        let ChunkParams { size, max_height } = *params;

        let voxels = Ndarray::new(&[size, max_height as usize, size], 0);
        let lights = Ndarray::new(&[size, max_height as usize, size], 0);
        let height_map = Ndarray::new(&[size, size], 0);

        let min = Vec3(cx * size as i32, 0, cz * size as i32);
        let max = Vec3(
            (cx + 1) * size as i32,
            max_height as i32,
            (cz + 1) * size as i32,
        );

        Self {
            id: id.to_owned(),
            name: ChunkUtils::get_chunk_name(cx, cz),
            coords: Vec2(cx, cz),

            voxels,
            lights,
            height_map,

            min,
            max,

            params: params.to_owned(),
        }
    }
}
