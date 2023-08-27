use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use hashbrown::HashMap;

use super::{Chunk, ChunkCoords};

enum Job {
    Generate(ChunkCoords /* Other necessary info */),
    Mesh(ChunkCoords /* Other necessary info */),
}

impl Job {
    fn process(self, chunks: &mut HashMap<ChunkCoords, Chunk>) -> JobResult {
        match self {
            Job::Generate(coords) => {
                // Return the result
                JobResult::Generated(coords)
            }
            Job::Mesh(coords) => {
                // Return the result
                JobResult::Meshed(coords)
            }
        }
    }
}

enum JobResult {
    Generated(ChunkCoords /* Generation result data */),
    Meshed(ChunkCoords /* Meshing result data */),
}

pub struct ChunkManager {
    pub chunks: HashMap<ChunkCoords, Chunk>,

    job_queue: Arc<Mutex<Vec<Job>>>,
    result_queue: Arc<Mutex<Vec<JobResult>>>,

    chunk_dependency_map: HashMap<ChunkCoords, Vec<ChunkCoords>>,

    workers: Vec<thread::JoinHandle<()>>,
    stop_signal: Arc<AtomicBool>,
}

impl ChunkManager {
    // pub fn generate_chunk()

    pub fn start_job_processor(&mut self, num_threads: usize) {
        self.stop_signal.store(false, Ordering::SeqCst);

        for _ in 0..num_threads {
            let job_queue = self.job_queue.clone();
            let result_queue = self.result_queue.clone();
            let chunks: Arc<Mutex<HashMap<crate::libs::Vec2<i32>, Chunk>>> =
                Arc::new(Mutex::new(self.chunks.clone()));
            let stop_signal = self.stop_signal.clone();

            let worker = thread::spawn(move || {
                while !stop_signal.load(Ordering::SeqCst) {
                    let job_option = job_queue.lock().unwrap().pop();

                    if let Some(job) = job_option {
                        let result = job.process(&mut chunks.lock().unwrap());
                        result_queue.lock().unwrap().push(result);
                    } else {
                        // Sleep for a small duration if there's no job
                        thread::sleep(Duration::from_millis(10));
                    }
                }
            });

            self.workers.push(worker);
        }
    }

    pub fn stop_job_processor(&mut self) {
        self.stop_signal.store(true, Ordering::SeqCst);

        for worker in self.workers.drain(..) {
            // Assuming you want to join the threads and wait for them to finish
            // (Alternatively, you could just let them end)
            let _ = worker.join();
        }

        self.workers.clear();
    }
}
