use std::collections::HashMap;
use std::time::{Duration, Instant};

use log::{info, warn};

pub struct Profiler {
    times: HashMap<String, (Instant, Duration)>,
    threshold: Duration,
}

impl Profiler {
    pub fn new(threshold: Duration) -> Self {
        Profiler {
            times: HashMap::new(),
            threshold,
        }
    }

    pub fn time(&mut self, label: &str) {
        self.times
            .insert(label.to_string(), (Instant::now(), Duration::new(0, 0)));
    }

    pub fn time_end(&mut self, label: &str) {
        if let Some((start, _)) = self.times.remove(label) {
            let duration = start.elapsed();
            self.times
                .insert(label.to_string(), (start.clone(), duration));
        } else {
            warn!("Profiler: No start time found for label '{}'", label);
        }
    }

    pub fn summarize(&mut self) {
        let mut summary: Vec<(&String, &Duration)> = self
            .times
            .iter()
            .map(|(label, (_, duration))| (label, duration))
            .collect();

        summary.sort_by(|a, b| b.1.cmp(a.1));

        for (label, duration) in summary.iter() {
            if **duration > self.threshold {
                info!("{} took {:?}", label, duration);
            }
        }

        // Clear the times after summarizing
        self.times.clear();
    }
}
