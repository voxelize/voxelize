mod common;
mod errors;
mod libs;
mod logging;
mod perf;
mod runtime;
mod server;
mod types;
pub mod viewer;
pub mod webrtc;
mod world;

use std::sync::Arc;

use hashbrown::HashMap;
use tokio::sync::{mpsc, Mutex};

pub use common::*;
pub use libs::*;
pub use logging::LogRateLimiter;
pub use runtime::*;
pub use server::*;
pub use types::*;
pub use webrtc::signaling::{rtc_candidate, rtc_offer, WebRTCPeers};
pub use webrtc::{
    create_webrtc_api,
    datachannel::{fits_one_datagram, fragment_message},
};
pub use world::system_profiler::{
    clear_timing_data_for_world, get_all_world_names, get_timing_summary_for_world, SystemTimer,
    TimedDispatcherBuilder, TimedSystem, WorldTimingContext,
};
pub use world::*;

/// No longer routes anything: a data channel attaches to its own socket
/// ([`WsSender::attach_rtc`]), since one client id may hold a socket in
/// several worlds. Kept so adapters that still create and install it build.
pub type RtcSenders = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Vec<u8>>>>>;

pub fn create_rtc_senders() -> RtcSenders {
    Arc::new(Mutex::new(HashMap::new()))
}
