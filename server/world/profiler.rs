use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use log::{info, warn};

pub struct Profiler {
    times: HashMap<String, (Instant, Duration)>,
    current_hierarchy: Vec<String>,
    hierarchy_records: Vec<Vec<String>>,
    threshold: Duration,
}

impl Profiler {
    pub fn new(threshold: Duration) -> Self {
        Profiler {
            times: HashMap::new(),
            current_hierarchy: Vec::new(),
            hierarchy_records: Vec::new(),
            threshold,
        }
    }

    pub fn time(&mut self, label: &str) {
        self.current_hierarchy.push(label.to_string());
        let now = Instant::now();
        if let Some((start, duration)) = self.times.get_mut(label) {
            *start = now;
            *duration = Duration::ZERO;
        } else {
            self.times
                .insert(label.to_string(), (now, Duration::ZERO));
        }
    }

    pub fn time_end(&mut self, label: &str) {
        if let Some((start, duration)) = self.times.get_mut(label) {
            *duration = start.elapsed();
            if let Some(last_label) = self.current_hierarchy.last() {
                if last_label == label {
                    self.hierarchy_records.push(self.current_hierarchy.clone());
                    self.current_hierarchy.pop();
                }
            }
        } else {
            warn!("Profiler: No start time found for label '{}'", label);
        }
    }

    pub fn summarize(&mut self) {
        let mut printed = HashSet::with_capacity(self.times.len());
        let threshold_secs = self.threshold.as_secs_f32();

        for hierarchy in self.hierarchy_records.iter() {
            if let Some(root_label) = hierarchy.first() {
                if let Some(duration) = self.times.get(root_label) {
                    if duration.1.as_secs_f32() > threshold_secs {
                        self.print_hierarchy_recursive(root_label, 0, &mut printed);
                    }
                }
            }
        }

        // Clear the times and hierarchy records after summarizing
        self.times.clear();
        self.current_hierarchy.clear();
        self.hierarchy_records.clear();
    }

    fn print_hierarchy_recursive<'a>(
        &'a self,
        label: &'a str,
        indent: usize,
        printed: &mut HashSet<&'a str>,
    ) {
        if printed.contains(label) {
            return;
        }

        if let Some((_, duration)) = self.times.get(label) {
            info!("{}{} took {:?}", " ".repeat(indent * 2), label, duration);
            printed.insert(label);

            for hierarchy in self.hierarchy_records.iter() {
                let mut seen_label = false;
                for child_label in hierarchy.iter() {
                    if !seen_label {
                        if child_label == label {
                            seen_label = true;
                        }
                        continue;
                    }
                    self.print_hierarchy_recursive(child_label, indent + 1, printed);
                }
            }
        }
    }
}
