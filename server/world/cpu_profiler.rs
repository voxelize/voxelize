use pprof::ProfilerGuard;
use std::sync::{Arc, Mutex};

pub struct CpuProfiler {
    guard: Option<ProfilerGuard<'static>>,
}

impl Default for CpuProfiler {
    fn default() -> Self {
        Self::new()
    }
}

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

    pub fn stop_svg(&mut self) -> Result<Vec<u8>, String> {
        let guard = self.guard.take().ok_or("Not profiling")?;
        let report = guard.report().build().map_err(|e| e.to_string())?;

        let mut svg_data = Vec::new();
        report
            .flamegraph(&mut svg_data)
            .map_err(|e| e.to_string())?;

        Ok(svg_data)
    }
}

lazy_static::lazy_static! {
    pub static ref GLOBAL_CPU_PROFILER: Arc<Mutex<CpuProfiler>> = Arc::new(Mutex::new(CpuProfiler::new()));
}

pub fn start_profiling(frequency: i32) -> Result<(), String> {
    GLOBAL_CPU_PROFILER.lock().unwrap().start(frequency)
}

pub fn stop_profiling_svg() -> Result<Vec<u8>, String> {
    GLOBAL_CPU_PROFILER.lock().unwrap().stop_svg()
}

pub fn is_profiling() -> bool {
    GLOBAL_CPU_PROFILER.lock().unwrap().is_profiling()
}
