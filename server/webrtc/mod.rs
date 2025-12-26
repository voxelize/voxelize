pub mod datachannel;
pub mod peer;
pub mod signaling;

pub use datachannel::*;
pub use peer::*;
pub use signaling::*;

use std::sync::Arc;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::api::API;
use webrtc::interceptor::registry::Registry;

pub fn create_webrtc_api() -> Arc<API> {
    let mut media_engine = MediaEngine::default();
    let _ = media_engine.register_default_codecs();

    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut media_engine)
        .expect("Failed to register default interceptors");

    let api = APIBuilder::new()
        .with_media_engine(media_engine)
        .with_interceptor_registry(registry)
        .build();

    Arc::new(api)
}
