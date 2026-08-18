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

        for (id, requests) in (&ids, &mut requests).join() {
            let mut to_add_back_to_requested = HashSet::new();

            for coords in requests.requests.drain(..) {
                if chunks.is_chunk_ready(&coords) {
                    let clients_to_send = to_send.entry(id.0.clone()).or_default();

                    if clients_to_send.len() >= max_response_per_tick {
                        to_add_back_to_requested.insert(coords);
                        continue;
                    }

                    clients_to_send.insert(coords.clone());
                    interests.add(&id.0, &coords);
                    continue;
                }

                interests.add(&id.0, &coords);

                // Every request for a not-yet-ready chunk re-ensures the whole
                // path to `Ready`, unconditionally. This used to run only for
                // the first asker (gated on the interest set being empty), so
                // any race that lost that one promotion — a chunk mid-disk-load,
                // a mesher entry superseded — wedged the chunk for every client
                // forever: retries saw an existing interest and did nothing.
                // Each arm below is idempotent, so re-asking is always safe:
                // in-flight work is left alone, parked work is re-queued, and
                // a client retrying a stale request always makes progress.
                for n_coords in chunks.light_traversed_chunks(&coords) {
                    let is_target = n_coords == coords;

                    match chunks.raw(&n_coords).map(|chunk| &chunk.status) {
                        Some(ChunkStatus::Ready) => {}
                        // The asked-for chunk parked short of the mesher (or is
                        // already queued there — the mesher dedupes): revive it.
                        // A *ring* member parked at `Meshing` is left alone: its
                        // voxel data already exists, which is all the target's
                        // mesh needs from it.
                        Some(ChunkStatus::Meshing) => {
                            if is_target {
                                mesher.add_chunk(&n_coords, true);
                            }
                        }
                        // Mid-generation: the pipeline already carries it;
                        // recording demand for the target is what stops it from
                        // parking when it comes out the far end.
                        Some(ChunkStatus::Generating(_)) => {
                            if is_target {
                                pipeline.add_chunk(&n_coords, false);
                            }
                        }
                        // Nothing anywhere: the asked-for chunk is demand, its
                        // ring is context (voxel data for lighting) so a request
                        // never conscripts first-class neighbors.
                        None => {
                            if is_target {
                                pipeline.add_chunk(&n_coords, false);
                            } else {
                                pipeline.add_context_chunk(&n_coords);
                            }
                        }
                    }
                }
            }

            requests.requests.extend(to_add_back_to_requested);
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
    }
}
