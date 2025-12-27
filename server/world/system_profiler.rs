use hashbrown::HashMap;
use lazy_static::lazy_static;
use serde::Serialize;
use std::sync::{Arc, RwLock};
use std::time::Instant;

const MAX_SAMPLES: usize = 100;

#[derive(Clone, Serialize)]
pub struct SystemSample {
    pub duration_ms: f64,
    pub timestamp: u64,
}

#[derive(Default)]
pub struct SystemTimings {
    samples: HashMap<String, Vec<SystemSample>>,
}

impl SystemTimings {
    pub fn record(&mut self, name: &str, duration_ms: f64) {
        let samples = self.samples.entry(name.to_string()).or_default();
        if samples.len() >= MAX_SAMPLES {
            samples.remove(0);
        }
        samples.push(SystemSample {
            duration_ms,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        });
    }

    pub fn get_summary(&self) -> HashMap<String, SystemStats> {
        self.samples
            .iter()
            .map(|(name, samples)| {
                let durations: Vec<f64> = samples.iter().map(|s| s.duration_ms).collect();
                let avg = durations.iter().sum::<f64>() / durations.len() as f64;
                let max = durations.iter().cloned().fold(0.0, f64::max);
                let min = durations.iter().cloned().fold(f64::MAX, f64::min);
                (
                    name.clone(),
                    SystemStats {
                        avg,
                        max,
                        min,
                        samples: durations.len(),
                    },
                )
            })
            .collect()
    }

    pub fn clear(&mut self) {
        self.samples.clear();
    }
}

#[derive(Serialize)]
pub struct SystemStats {
    pub avg: f64,
    pub max: f64,
    pub min: f64,
    pub samples: usize,
}

type WorldTimingsMap = HashMap<String, SystemTimings>;

lazy_static! {
    pub static ref WORLD_TIMINGS: Arc<RwLock<WorldTimingsMap>> =
        Arc::new(RwLock::new(HashMap::new()));
}

pub fn record_timing(world_name: &str, system_name: &str, duration_ms: f64) {
    if let Ok(mut world_timings) = WORLD_TIMINGS.write() {
        let timings = world_timings.entry(world_name.to_string()).or_default();
        timings.record(system_name, duration_ms);
    }
}

#[derive(Clone)]
pub struct WorldTimingContext {
    pub world_name: Arc<String>,
}

impl WorldTimingContext {
    pub fn new(world_name: &str) -> Self {
        Self {
            world_name: Arc::new(world_name.to_string()),
        }
    }

    pub fn timer(&self, name: &'static str) -> WorldSystemTimer {
        WorldSystemTimer {
            name,
            world_name: self.world_name.clone(),
            start: Instant::now(),
        }
    }
}

pub struct WorldSystemTimer {
    name: &'static str,
    world_name: Arc<String>,
    start: Instant,
}

impl WorldSystemTimer {
    pub fn elapsed_ms(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * 1000.0
    }
}

impl Drop for WorldSystemTimer {
    fn drop(&mut self) {
        let duration_ms = self.start.elapsed().as_secs_f64() * 1000.0;
        record_timing(&self.world_name, self.name, duration_ms);
    }
}

pub struct SystemTimer {
    name: &'static str,
    start: Instant,
}

impl SystemTimer {
    pub fn new(name: &'static str) -> Self {
        Self {
            name,
            start: Instant::now(),
        }
    }

    pub fn elapsed_ms(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * 1000.0
    }

    pub fn name(&self) -> &'static str {
        self.name
    }
}

pub fn get_timing_summary_for_world(world_name: &str) -> HashMap<String, SystemStats> {
    WORLD_TIMINGS
        .read()
        .map(|wt| {
            wt.get(world_name)
                .map(|t| t.get_summary())
                .unwrap_or_default()
        })
        .unwrap_or_default()
}

pub fn get_all_world_names() -> Vec<String> {
    WORLD_TIMINGS
        .read()
        .map(|wt| wt.keys().cloned().collect())
        .unwrap_or_default()
}

pub fn clear_timing_data_for_world(world_name: &str) {
    if let Ok(mut world_timings) = WORLD_TIMINGS.write() {
        if let Some(timings) = world_timings.get_mut(world_name) {
            timings.clear();
        }
    }
}
