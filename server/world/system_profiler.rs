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

lazy_static! {
    pub static ref GLOBAL_TIMINGS: Arc<RwLock<SystemTimings>> =
        Arc::new(RwLock::new(SystemTimings::default()));
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
}

impl Drop for SystemTimer {
    fn drop(&mut self) {
        let duration_ms = self.start.elapsed().as_secs_f64() * 1000.0;
        if let Ok(mut timings) = GLOBAL_TIMINGS.write() {
            timings.record(self.name, duration_ms);
        }
    }
}

pub fn get_timing_summary() -> HashMap<String, SystemStats> {
    GLOBAL_TIMINGS
        .read()
        .map(|t| t.get_summary())
        .unwrap_or_default()
}

pub fn clear_timing_data() {
    if let Ok(mut timings) = GLOBAL_TIMINGS.write() {
        timings.clear();
    }
}
