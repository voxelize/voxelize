mod common;
mod errors;
mod libs;
mod perf;
mod runtime;
mod server;
mod types;
pub mod webrtc;
mod world;

use std::sync::Arc;

use hashbrown::HashMap;
use tokio::sync::{mpsc, Mutex};

pub use common::*;
pub use libs::*;
pub use runtime::*;
pub use server::*;
pub use types::*;
pub use webrtc::signaling::{rtc_candidate, rtc_offer, WebRTCPeers};
pub use webrtc::{create_webrtc_api, datachannel::fragment_message};
pub use world::system_profiler::{
    clear_timing_data_for_world, get_all_world_names, get_timing_summary_for_world, SystemTimer,
    TimedDispatcherBuilder, TimedSystem, WorldTimingContext,
};
pub use world::*;

pub type RtcSenders = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Vec<u8>>>>>;

pub fn create_rtc_senders() -> RtcSenders {
    Arc::new(Mutex::new(HashMap::new()))
}
