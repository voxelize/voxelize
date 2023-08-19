use actix::{Actor, AsyncContext, Context, Handler, MessageResult};
use hashbrown::HashMap;
use nanoid::nanoid;
use voxelize::World;
use voxelize_protocol::{encode_message, Message};

use crate::{
    client::Client,
    messages::{ClientMessage, Connect, Disconnect, EncodedMessage, MessageRecipient},
};

/// A Voxelize server is a websocket server that listens for connections from
/// clients and processes all in-game events.
///
/// The server will also be an Actix actor, which means it can receive messages
/// from other actors or send messages to other actors.
pub struct Server {
    /// The interval at which the server runs each update.
    pub update_interval: std::time::Duration,

    /// A list of worlds that the server manages.
    pub worlds: Vec<Box<dyn World>>,

    /// A list of clients that are connected to the server, mapped by their
    /// unique ID to their actor address.
    clients: HashMap<String, Client>,
}

impl Server {
    /// Creates a new server.
    pub fn new(update_interval: std::time::Duration) -> Self {
        Self {
            update_interval,
            worlds: vec![],
            clients: HashMap::new(),
        }
    }

    pub fn add_world<T: World + 'static>(&mut self, world: T) {
        self.worlds.push(Box::new(world));
    }

    pub fn add_client(&mut self, id: &str, client: MessageRecipient) {
        if let Some(_) = self
            .clients
            .insert(id.to_owned(), Client::new(id.to_owned(), client))
        {
            println!("Client {} already exists, replacing with new client", id);
        } else {
            println!("Client {} added", id);
        }
    }

    pub fn remove_client(&mut self, id: &str) {
        if let Some(_) = self.clients.remove(id) {
            println!("Client {} removed", id);
        } else {
            println!("Client {} does not exist", id);
        }
    }

    /// Updates the server state.
    pub fn update(&mut self) {
        for world in &mut self.worlds {
            world.update();
        }
    }

    /// Stops the server.
    pub fn stop(&mut self) {
        for world in &mut self.worlds {
            world.stop();
        }
    }

    pub(crate) fn on_request(&mut self, client_id: &str, data: Message) {
        // Echo the message back to the client.
        if let Some(client) = self.clients.get_mut(client_id) {
            client
                .recipient
                .do_send(EncodedMessage(encode_message(&data)));
        }
    }

    fn start(&mut self) {
        for world in &mut self.worlds {
            world.start();
        }
    }
}

impl Actor for Server {
    type Context = Context<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        // Start the server.
        self.start();

        ctx.run_interval(self.update_interval, |act, _| {
            act.update();
        });
    }

    fn stopped(&mut self, _: &mut Self::Context) {
        // Stop the server.
        self.stop();
    }
}

/// Handler for Connect message.
///
/// Register new session and assign unique id to this session
impl Handler<Connect> for Server {
    type Result = MessageResult<Connect>;

    fn handle(&mut self, msg: Connect, _: &mut Context<Self>) -> Self::Result {
        // notify all users in same room
        // self.send_message("Main", "Someone joined", 0);

        // register session with random id
        let id = if msg.id.is_none() {
            nanoid!()
        } else {
            msg.id.unwrap()
        };

        self.add_client(&id, msg.recipient);

        // send id back
        MessageResult(id)
    }
}

/// Handler for Disconnect message.
impl Handler<Disconnect> for Server {
    type Result = ();

    fn handle(&mut self, msg: Disconnect, _: &mut Context<Self>) {
        self.remove_client(&msg.id);
    }
}

/// Handler for client-side messages.
impl Handler<ClientMessage> for Server {
    type Result = Result<(), &'static str>;

    fn handle(&mut self, msg: ClientMessage, _: &mut Context<Self>) -> Self::Result {
        self.on_request(&msg.id, msg.data);

        Ok(())
    }
}
