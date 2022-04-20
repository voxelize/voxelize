use message_io::network::Endpoint;

use crate::{common::ClientFilter, server::models::Message};

pub type ClientMessages = Vec<(Endpoint, Message)>;

pub type MessageQueue = Vec<(Message, ClientFilter)>;
