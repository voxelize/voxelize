use actix::{Message as ActixMessage, Recipient};
use hashbrown::HashMap;
use serde_json::Value;
use voxelize::World;
use voxelize_protocol::Message;

#[derive(ActixMessage, Clone)]
#[rtype(result = "()")]
pub struct EncodedMessage(pub Vec<u8>);

pub type MessageRecipient = Recipient<EncodedMessage>;

/// New chat session is created
#[derive(ActixMessage)]
#[rtype(result = "String")]
pub struct Connect {
    pub id: Option<String>,
    pub recipient: MessageRecipient,
}

/// Session is disconnected
#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct Disconnect {
    pub id: String,
}

/// Send message to specific world
#[derive(ActixMessage)]
#[rtype(result = "Result<(), &'static str>")]
pub struct ClientMessage {
    /// Id of the client session
    pub id: String,

    /// Protobuf message
    pub data: Message,
}

#[derive(ActixMessage)]
#[rtype(result = "HashMap<String, Value>")]
pub struct GetWorlds;
