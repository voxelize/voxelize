use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use hashbrown::HashMap;
use nanoid::nanoid;
use std::sync::mpsc::{self, Receiver, Sender};

use crate::{ChunkOptions, Space, Vec2};

use super::{Chunk, ChunkCoords, ChunkStatus};

/// A stage in the pipeline where a chunk gets populated.
pub trait ChunkStage: Send + Sync {
    fn name(&self) -> String;

    fn neighbors(&self) -> usize {
        0
    }

    fn needs_space(&self) -> bool {
        false
    }

    fn process(&self, chunk: Chunk) -> Chunk;
}

#[derive(Clone)]
pub enum JobTicket {
    Generate(String, ChunkCoords),
    Light(String, ChunkCoords),
    Mesh(String, ChunkCoords),
}

impl JobTicket {
    pub fn get_coords(&self) -> ChunkCoords {
        match self {
            JobTicket::Generate(_, coords) => coords.to_owned(),
            JobTicket::Light(_, coords) => coords.to_owned(),
            JobTicket::Mesh(_, coords) => coords.to_owned(),
        }
    }
}

pub struct Job {
    ticket: JobTicket,
    chunk: Option<Chunk>,
    space: Option<Space>,
    options: ChunkOptions,
    stages: Vec<Arc<dyn ChunkStage>>,
}

impl Job {
    fn process(&mut self) {
        match &self.ticket {
            JobTicket::Generate(id, coords) => {
                // Generate the chunk
                let mut chunk: Chunk = Chunk::new(&nanoid!(), coords.0, coords.1, &self.options);
                for stage in &self.stages {
                    chunk = stage.process(chunk);
                }
                chunk.status = ChunkStatus::Meshing;
                self.chunk = Some(chunk);
            }
            JobTicket::Light(id, coords) => {
                // Light the chunk

                if let Some(chunk) = self.chunk.as_mut() {
                    chunk.status = ChunkStatus::Lighting;
                }
            }
            JobTicket::Mesh(id, coords) => {
                // Mesh the chunk

                if let Some(chunk) = self.chunk.as_mut() {
                    chunk.status = ChunkStatus::Ready;
                }
            }
        }
    }
}

#[derive(Debug)]
pub struct JobResult {
    pub id: String,
    pub coords: ChunkCoords,
}

pub struct ChunkManager {
    pub options: ChunkOptions,

    pub chunks: HashMap<ChunkCoords, Chunk>,

    job_sender: Sender<Job>,
    job_receiver: Arc<Mutex<Receiver<Job>>>,
    job_queue: Arc<Mutex<Vec<Job>>>,
    result_queue: Arc<Mutex<Vec<JobResult>>>,

    chunk_dependency_map: HashMap<ChunkCoords, Vec<ChunkCoords>>,

    workers: Vec<thread::JoinHandle<()>>,
    stop_signal: Arc<AtomicBool>,
    stages: Vec<Arc<dyn ChunkStage>>,
}

impl ChunkManager {
    pub fn new(options: &ChunkOptions) -> Self {
        let (job_sender, job_receiver) = mpsc::channel();

        Self {
            options: options.clone(),
            chunks: HashMap::new(),
            job_sender,
            job_receiver: Arc::new(Mutex::new(job_receiver)),
            job_queue: Arc::new(Mutex::new(Vec::new())),
            result_queue: Arc::new(Mutex::new(Vec::new())),
            chunk_dependency_map: HashMap::new(),
            workers: Vec::new(),
            stop_signal: Arc::new(AtomicBool::new(false)),
            stages: Vec::new(),
        }
    }

    pub fn add_stage<T: ChunkStage + 'static>(&mut self, stage: T) {
        self.stages.push(Arc::new(stage));
    }

    pub fn generate_space(&self, center: &ChunkCoords, radius: i32) -> Space {
        let mut chunks = HashMap::new();

        for x in -radius..radius {
            for z in -radius..radius {
                let coords = Vec2(center.0 + x, center.1 + z);

                if let Some(chunk) = self.chunks.get(&coords) {
                    chunks.insert(coords, chunk.clone());
                }
            }
        }

        Space {
            chunks,
            radius,
            center: center.clone(),
            options: self.options.clone(),
            extra_block_updates: Vec::new(),
        }
    }

    pub fn add_job_ticket(&mut self, ticket: JobTicket) {
        let light_chunk_radius =
            (self.options.max_light_levels as f32 / self.options.chunk_size as f32).ceil() as i32;

        match &ticket {
            JobTicket::Generate(id, coords) => {
                // Add chunks into the chunk dependency map
                for x in -light_chunk_radius..light_chunk_radius {
                    for z in -light_chunk_radius..light_chunk_radius {
                        let coords = Vec2(coords.0 + x, coords.1 + z);

                        self.chunk_dependency_map
                            .entry(coords.to_owned())
                            .or_insert_with(Vec::new)
                            .push(coords);
                    }
                }
            }
            _ => {}
        }

        let space = match &ticket {
            JobTicket::Generate(_, _) => None,
            JobTicket::Light(_, coords) => Some(self.generate_space(coords, light_chunk_radius)),
            JobTicket::Mesh(_, coords) => Some(self.generate_space(coords, 1)),
        };

        let chunk: Option<Chunk> = self.chunks.get(&ticket.get_coords()).cloned();

        // Package the job and send it to the job queue
        let job = Job {
            ticket,
            space,
            chunk,
            options: self.options.clone(),
            stages: self.stages.clone(),
        };

        self.job_sender.send(job).unwrap();
    }

    pub fn get_done_jobs(&self) -> Vec<JobResult> {
        self.result_queue.lock().unwrap().drain(..).collect()
    }

    pub fn update(&mut self) {
        // Go through the job queue and process all the jobsb
        let mut jobs = self
            .job_queue
            .lock()
            .unwrap()
            .drain(..)
            .collect::<Vec<Job>>();

        for job in jobs.drain(..) {
            let ticket = job.ticket.to_owned();
            let chunk = job.chunk.unwrap();

            println!("Chunk status pushin: {:?}", chunk.status);
            self.chunks.insert(chunk.coords.clone(), chunk);

            // Remove this chunk from all the chunk dependency maps
            for (_, dependencies) in self.chunk_dependency_map.iter_mut() {
                dependencies.retain(|c| c != &ticket.get_coords());
            }

            // If the dependency map of this chunk is empty, add it to the job queue
            if let Some(dependencies) = self.chunk_dependency_map.get(&ticket.get_coords()) {
                println!("Dependencies: {:?}", dependencies);

                if dependencies.is_empty() {
                    match ticket {
                        JobTicket::Generate(id, coords) => {
                            self.add_job_ticket(JobTicket::Light(id, coords))
                        }
                        JobTicket::Light(id, coords) => {
                            self.add_job_ticket(JobTicket::Mesh(id, coords));
                        }
                        JobTicket::Mesh(id, coords) => {
                            self.result_queue
                                .lock()
                                .unwrap()
                                .push(JobResult { id, coords });
                        }
                    }
                }
            }
        }
    }

    pub fn start_job_processor(&mut self, num_threads: usize) {
        self.stop_signal.store(false, Ordering::SeqCst);

        for _ in 0..num_threads {
            let job_receiver = Arc::clone(&self.job_receiver);
            let job_queue = self.job_queue.clone();
            let stop_signal = self.stop_signal.clone();

            let worker = thread::spawn(move || {
                while !stop_signal.load(Ordering::SeqCst) {
                    if let Ok(mut job) = job_receiver.lock().unwrap().recv() {
                        job.process();
                        job_queue.lock().unwrap().push(job);
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
