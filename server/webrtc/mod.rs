pub mod datachannel;
pub mod signaling;

use std::sync::Arc;

use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::api::API;
use webrtc::ice::network_type::NetworkType;

pub fn create_webrtc_api() -> Arc<API> {
    let mut se = SettingEngine::default();
    se.set_network_types(vec![NetworkType::Udp4, NetworkType::Tcp4]);
    Arc::new(APIBuilder::new().with_setting_engine(se).build())
}
