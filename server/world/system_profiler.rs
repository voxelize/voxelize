use hashbrown::{hash_map::RawEntryMut, HashMap};
use lazy_static::lazy_static;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, RwLock};
use std::time::Instant;

const MAX_SAMPLES: usize = 100;

#[inline]
fn unix_timestamp_millis() -> u64 {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

#[derive(Clone, Serialize)]
pub struct SystemSample {
    pub duration_ms: f64,
    pub timestamp: u64,
}

#[derive(Default)]
pub struct SystemTimings {
    samples: HashMap<String, VecDeque<SystemSample>>,
}

impl SystemTimings {
    pub fn record(&mut self, name: &str, duration_ms: f64) {
        let samples = match self.samples.raw_entry_mut().from_key(name) {
            RawEntryMut::Occupied(entry) => entry.into_mut(),
            RawEntryMut::Vacant(entry) => {
                entry
                    .insert(name.to_owned(), VecDeque::with_capacity(MAX_SAMPLES))
                    .1
            }
        };
        if samples.len() >= MAX_SAMPLES {
            samples.pop_front();
        }
        samples.push_back(SystemSample {
            duration_ms,
            timestamp: unix_timestamp_millis(),
        });
    }

    pub fn get_summary(&self) -> HashMap<String, SystemStats> {
        let mut summary = HashMap::with_capacity(self.samples.len());
        for (name, samples) in self.samples.iter() {
            if samples.is_empty() {
                continue;
            }
            let sample_count = samples.len();
            if sample_count == 1 {
                if let Some(sample) = samples.front() {
                    let duration = sample.duration_ms;
                    summary.insert(
                        name.clone(),
                        SystemStats {
                            avg: duration,
                            max: duration,
                            min: duration,
                            samples: 1,
                        },
                    );
                }
                continue;
            }

            let mut sum = 0.0;
            let mut max = f64::NEG_INFINITY;
            let mut min = f64::INFINITY;
            for sample in samples {
                let duration = sample.duration_ms;
                sum += duration;
                max = max.max(duration);
                min = min.min(duration);
            }
            let avg = sum / sample_count as f64;
            summary.insert(
                name.clone(),
                SystemStats {
                    avg,
                    max,
                    min,
                    samples: sample_count,
                },
            );
        }
        summary
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
        let timings = match world_timings.raw_entry_mut().from_key(world_name) {
            RawEntryMut::Occupied(entry) => entry.into_mut(),
            RawEntryMut::Vacant(entry) => entry.insert(world_name.to_owned(), SystemTimings::default()).1,
        };
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
    if let Ok(world_timings) = WORLD_TIMINGS.read() {
        if let Some(timings) = world_timings.get(world_name) {
            return timings.get_summary();
        }
    }
    HashMap::new()
}

pub fn get_all_world_names() -> Vec<String> {
    WORLD_TIMINGS
        .read()
        .map(|wt| {
            let mut world_names = Vec::with_capacity(wt.len());
            for name in wt.keys() {
                world_names.push(name.clone());
            }
            world_names
        })
        .unwrap_or_default()
}

pub fn clear_timing_data_for_world(world_name: &str) {
    if let Ok(mut world_timings) = WORLD_TIMINGS.write() {
        if let Some(timings) = world_timings.get_mut(world_name) {
            timings.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SystemTimings, MAX_SAMPLES};

    #[test]
    fn record_keeps_only_latest_max_samples() {
        let mut timings = SystemTimings::default();
        for index in 0..(MAX_SAMPLES + 5) {
            timings.record("system", index as f64);
        }

        let samples = timings.samples.get("system").expect("expected samples");
        assert_eq!(samples.len(), MAX_SAMPLES);
        assert_eq!(samples.front().map(|sample| sample.duration_ms), Some(5.0));
        assert_eq!(
            samples.back().map(|sample| sample.duration_ms),
            Some((MAX_SAMPLES + 4) as f64)
        );
    }

    #[test]
    fn get_summary_reports_expected_statistics() {
        let mut timings = SystemTimings::default();
        timings.record("system", 10.0);
        timings.record("system", 20.0);
        timings.record("system", 30.0);

        let summary = timings.get_summary();
        let stats = summary.get("system").expect("expected system summary");
        assert_eq!(stats.samples, 3);
        assert_eq!(stats.min, 10.0);
        assert_eq!(stats.max, 30.0);
        assert_eq!(stats.avg, 20.0);
    }
}
