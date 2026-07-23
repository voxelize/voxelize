use hashbrown::{HashMap, HashSet};
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ChunkInterests, ChunkProtocol, ChunkRequestsComp, ChunkStatus, Chunks, ClientFilter, IDComp,
    Mesher, Message, MessageQueues, MessageType, Pipeline, Vec2, WorldConfig,
};

pub struct ChunkRequestsSystem;

impl<'a> System<'a> for ChunkRequestsSystem {
    type SystemData = (
        ReadExpect<'a, Chunks>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, ChunkInterests>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Mesher>,
        WriteExpect<'a, MessageQueues>,
        ReadStorage<'a, IDComp>,
        WriteStorage<'a, ChunkRequestsComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (chunks, config, mut interests, mut pipeline, mut mesher, mut queue, ids, mut requests) =
            data;

        let max_response_per_tick = config.max_response_per_tick;

        let mut to_send: HashMap<String, HashSet<Vec2<i32>>> = HashMap::new();
        let mut to_send_lod: HashMap<String, Vec<(Vec2<i32>, u32)>> = HashMap::new();
        let mut send_counts: HashMap<String, usize> = HashMap::new();

        // Queue a chunk's generation/meshing work if nobody was interested in
        // it yet, mirroring the not-ready branch of full-detail requests.
        let mut schedule_chunk = |coords: &Vec2<i32>,
                                  interests: &ChunkInterests,
                                  pipeline: &mut Pipeline,
                                  mesher: &mut Mesher| {
            if !interests.has_interests(coords) {
                for coords in chunks.light_traversed_chunks(coords) {
                    match chunks.raw(&coords) {
                        Some(chunk) if matches!(chunk.status, ChunkStatus::Meshing) => {
                            mesher.add_chunk(&coords, false);
                        }
                        None | Some(_) => {
                            pipeline.add_chunk(&coords, false);
                        }
                    }
                }
            }
        };

        for (id, requests) in (&ids, &mut requests).join() {
            let mut to_add_back_to_requested = HashSet::new();

            for coords in requests.requests.drain(..) {
                if chunks.is_chunk_ready(&coords) {
                    let count = send_counts.entry(id.0.clone()).or_default();

                    if *count >= max_response_per_tick {
                        to_add_back_to_requested.insert(coords);
                        continue;
                    }

                    *count += 1;
                    to_send.entry(id.0.clone()).or_default().insert(coords.clone());
                    interests.add(&id.0, &coords);
                } else {
                    schedule_chunk(&coords, &interests, &mut pipeline, &mut mesher);
                    interests.add(&id.0, &coords);
                }
            }

            requests.requests.extend(to_add_back_to_requested);

            let mut to_add_back_to_lod = Vec::new();

            for (coords, level) in requests.lod_requests.drain(..) {
                let has_lod_mesh = chunks
                    .raw(&coords)
                    .map(|chunk| {
                        chunk.status == ChunkStatus::Ready
                            && chunk
                                .lod_meshes
                                .as_ref()
                                .map_or(false, |meshes| meshes.contains_key(&level))
                    })
                    .unwrap_or(false);

                if has_lod_mesh {
                    let count = send_counts.entry(id.0.clone()).or_default();

                    if *count >= max_response_per_tick {
                        to_add_back_to_lod.push((coords, level));
                        continue;
                    }

                    *count += 1;
                    to_send_lod
                        .entry(id.0.clone())
                        .or_default()
                        .push((coords.clone(), level));
                    interests.add_lod(&id.0, &coords, level);
                } else {
                    if chunks.is_chunk_ready(&coords) {
                        // Ready but the pyramid level is missing (e.g. chunk
                        // meshed before a restart that changed the config):
                        // remesh so the send path can self-heal.
                        mesher.add_chunk(&coords, false);
                    } else {
                        schedule_chunk(&coords, &interests, &mut pipeline, &mut mesher);
                    }
                    interests.add_lod(&id.0, &coords, level);
                }
            }

            requests.lod_requests.extend(to_add_back_to_lod);
        }

        for (id, coords) in to_send {
            let include_meshes = !config.client_only_meshing;
            let chunks: Vec<ChunkProtocol> = coords
                .into_iter()
                .filter_map(|coords| {
                    chunks.get(&coords).map(|chunk| {
                        chunk.to_model(include_meshes, true, 0..config.sub_chunks as u32)
                    })
                })
                .collect();

            let message = Message::new(&MessageType::Load).chunks(&chunks).build();
            queue.push((message, ClientFilter::Direct(id)));
        }

        for (id, coords_levels) in to_send_lod {
            let chunks: Vec<ChunkProtocol> = coords_levels
                .into_iter()
                .filter_map(|(coords, level)| {
                    chunks
                        .get(&coords)
                        .and_then(|chunk| chunk.to_lod_model(level))
                })
                .collect();

            if chunks.is_empty() {
                continue;
            }

            let message = Message::new(&MessageType::Load).chunks(&chunks).build();
            queue.push((message, ClientFilter::Direct(id)));
        }
    }
}
