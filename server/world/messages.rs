use message_io::network::Endpoint;

use crate::{common::ClientFilter, server::Message};

pub type ClientMessages = Vec<(Endpoint, Message)>;

pub type MessageQueue = Vec<(Message, ClientFilter)>;
