#[cfg(feature = "profiling")]
use pprof::ProfilerGuard;
use serde::Serialize;
#[cfg(feature = "profiling")]
use std::sync::{Arc, Mutex};

#[derive(Serialize)]
pub struct FlameNode {
    name: String,
    value: isize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    children: Vec<FlameNode>,
}

#[cfg(feature = "profiling")]
impl FlameNode {
    fn new(name: String) -> Self {
        Self {
            name,
            value: 0,
            children: Vec::new(),
        }
    }

    fn add_stack(&mut self, stack: &[String], count: isize) {
        if stack.is_empty() {
            self.value += count;
            return;
        }

        let name = &stack[0];
        let rest = &stack[1..];

        let idx = self.children.iter().position(|c| &c.name == name);
        let child_idx = match idx {
            Some(i) => i,
            None => {
                self.children.push(FlameNode::new(name.clone()));
                self.children.len() - 1
            }
        };

        self.children[child_idx].add_stack(rest, count);
    }
}

#[cfg(feature = "profiling")]
pub struct CpuProfiler {
    guard: Option<ProfilerGuard<'static>>,
}

#[cfg(feature = "profiling")]
impl Default for CpuProfiler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "profiling")]
impl CpuProfiler {
    pub fn new() -> Self {
        Self { guard: None }
    }

    pub fn is_profiling(&self) -> bool {
        self.guard.is_some()
    }

    pub fn start(&mut self, frequency: i32) -> Result<(), String> {
        if self.guard.is_some() {
            return Err("Already profiling".into());
        }
        self.guard = Some(
            pprof::ProfilerGuardBuilder::default()
                .frequency(frequency)
                .blocklist(&["libc", "libgcc", "pthread", "vdso"])
                .build()
                .map_err(|e| e.to_string())?,
        );
        Ok(())
    }

    pub fn stop_json(&mut self) -> Result<FlameNode, String> {
        let guard = self.guard.take().ok_or("Not profiling")?;
        let report = guard.report().build().map_err(|e| e.to_string())?;

        let mut root = FlameNode::new("root".to_string());

        for (frames, count) in report.data.iter() {
            let mut stack: Vec<String> = Vec::new();
            stack.push(frames.thread_name_or_id());

            for frame in frames.frames.iter().rev() {
                for symbol in frame.iter().rev() {
                    stack.push(symbol.name());
                }
            }

            root.add_stack(&stack, *count);
        }

        Ok(root)
    }
}

#[cfg(feature = "profiling")]
lazy_static::lazy_static! {
    pub static ref GLOBAL_CPU_PROFILER: Arc<Mutex<CpuProfiler>> = Arc::new(Mutex::new(CpuProfiler::new()));
}

#[cfg(feature = "profiling")]
pub fn start_profiling(frequency: i32) -> Result<(), String> {
    GLOBAL_CPU_PROFILER.lock().unwrap().start(frequency)
}

#[cfg(feature = "profiling")]
pub fn stop_profiling_json() -> Result<FlameNode, String> {
    GLOBAL_CPU_PROFILER.lock().unwrap().stop_json()
}

#[cfg(feature = "profiling")]
pub fn is_profiling() -> bool {
    GLOBAL_CPU_PROFILER.lock().unwrap().is_profiling()
}

#[cfg(not(feature = "profiling"))]
pub fn start_profiling(_frequency: i32) -> Result<(), String> {
    Err("Profiling not available (compiled without 'profiling' feature)".into())
}

#[cfg(not(feature = "profiling"))]
pub fn stop_profiling_json() -> Result<FlameNode, String> {
    Err("Profiling not available (compiled without 'profiling' feature)".into())
}

#[cfg(not(feature = "profiling"))]
pub fn is_profiling() -> bool {
    false
}
