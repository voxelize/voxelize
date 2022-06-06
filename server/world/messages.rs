use crate::{common::ClientFilter, server::Message};

pub type MessageQueue = Vec<(Message, ClientFilter)>;
