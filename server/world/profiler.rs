use std::collections::HashMap;
use std::collections::VecDeque;
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
        self.times
            .insert(label.to_string(), (Instant::now(), Duration::new(0, 0)));
    }

    pub fn time_end(&mut self, label: &str) {
        if let Some((start, _)) = self.times.remove(label) {
            let duration = start.elapsed();
            self.times
                .insert(label.to_string(), (start.clone(), duration));
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
        let mut printed = std::collections::HashSet::new();

        for hierarchy in self.hierarchy_records.iter() {
            if let Some(root_label) = hierarchy.first() {
                if let Some(duration) = self.times.get(root_label) {
                    if duration.1.as_secs_f32() > self.threshold.as_secs_f32() {
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

    fn print_hierarchy_recursive(
        &self,
        label: &str,
        indent: usize,
        printed: &mut std::collections::HashSet<String>,
    ) {
        if printed.contains(label) {
            return;
        }

        if let Some((_, duration)) = self.times.get(label) {
            info!("{}{} took {:?}", " ".repeat(indent * 2), label, duration);
            printed.insert(label.to_string());

            for hierarchy in self.hierarchy_records.iter() {
                if let Some(index) = hierarchy.iter().position(|l| l == label) {
                    for child_label in hierarchy.iter().skip(index + 1) {
                        self.print_hierarchy_recursive(child_label, indent + 1, printed);
                    }
                }
            }
        }
    }
}
