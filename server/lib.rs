mod app;
mod libs;

use actix::{Addr, SystemService};
use actix_web::{middleware::Logger, web, App, HttpServer};
use app::network::{has_world, messages::CreateWorld, server::WsServer, ws_route};
use fern::colors::{Color, ColoredLevelConfig};

pub use app::world::WorldConfig;

/// A voxelize server.
pub struct Server {
    /// Port that the voxelize server runs on.
    pub port: u16,

    /// If the voxelize server has started.
    pub started: bool,

    pending_worlds: Vec<(String, WorldConfig)>,
}

impl Server {
    /// Create a new Voxelize server using the idiomatic Builder pattern.
    ///
    /// # Example
    ///
    /// ```
    /// let server = Server::new(4000).build()
    /// ```
    pub fn new(port: u16) -> ServerBuilder {
        ServerBuilder { port }
    }

    /// Create a world in the server. Different worlds have different configurations, and can hold
    /// their own set of clients within. If the server has already started, the added world will be
    /// started right away.
    pub fn create_world(&mut self, name: &str, config: &WorldConfig) {
        let packet = (name.to_owned(), config.to_owned());

        if self.started {
            self.send_world_to_create(packet);
            return;
        }

        self.pending_worlds.insert(0, packet);
    }

    /// Start the voxelize server using the Actix-web library, does the following:
    /// - Sets up robust debug logging.
    /// - Kickstart all worlds.
    /// - Listens on port `port` for incoming messages.
    #[actix_web::main]
    pub async fn start(&mut self) -> std::io::Result<()> {
        Server::setup_logger().expect("Something went wrong with fern.");

        let server = HttpServer::new(move || {
            App::new()
                .service(web::resource("/ws").to(ws_route))
                .service(has_world)
                .wrap(Logger::default())
        })
        .workers(2)
        .bind(("127.0.0.1", self.port))?;

        self.prepare();
        self.started = true;

        log::info!("Starting HTTP server at http://localhost:{}", self.port);

        server.run().await
    }

    /// Obtain the WebSocket server.
    pub fn ws_server(&self) -> Addr<WsServer> {
        WsServer::from_registry()
    }

    /// Setup `fern` logging.
    /// TODO: make logging configurable.
    fn setup_logger() -> Result<(), fern::InitError> {
        fern::Dispatch::new()
            .format(|out, message, record| {
                let colors = ColoredLevelConfig::new().info(Color::Green);

                out.finish(format_args!(
                    "{} [{}] [{}]: {}",
                    chrono::Local::now().format("[%H:%M:%S]"),
                    colors.color(record.level()),
                    record.target(),
                    message
                ))
            })
            .level(log::LevelFilter::Debug)
            .chain(std::io::stdout())
            .apply()?;

        Ok(())
    }

    /// Load all added worlds.
    fn prepare(&mut self) {
        while let Some(world) = self.pending_worlds.pop() {
            self.send_world_to_create(world);
        }
    }

    /// Send a world creation message to the actix websocket server actor.
    fn send_world_to_create(&self, packet: (String, WorldConfig)) {
        self.ws_server().do_send(CreateWorld {
            name: packet.0,
            config: packet.1,
        });
    }
}

/// Builder for a voxelize server.
#[derive(Default)]
pub struct ServerBuilder {
    port: u16,
}

impl ServerBuilder {
    /// Configure the port to the voxelize server.
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    /// Instantiate a voxelize server instance.
    pub fn build(self) -> Server {
        Server {
            port: self.port,

            started: false,
            pending_worlds: vec![],
        }
    }
}
