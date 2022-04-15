use message_io::network::Endpoint;

use crate::server::models::Message;

pub type ClientMessages = Vec<(Endpoint, Message)>;
