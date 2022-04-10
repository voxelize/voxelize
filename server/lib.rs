mod app;
mod libs;

use actix::{Addr, SystemService};
use actix_web::{middleware::Logger, web, App, HttpServer};
use app::network::{has_world, messages::CreateWorld, server::WsServer, ws_route};
use fern::colors::{Color, ColoredLevelConfig};

pub use app::world::WorldConfig;

pub struct Server {
    pub port: u16,
    pub started: bool,

    pending_worlds: Vec<(String, WorldConfig)>,
}

impl Server {
    pub fn new(port: u16) -> ServerBuilder {
        ServerBuilder { port }
    }

    pub fn create_world(&mut self, name: &str, config: &WorldConfig) {
        let packet = (name.to_owned(), config.to_owned());

        if self.started {
            self.send_world_to_create(packet);
            return;
        }

        self.pending_worlds.insert(0, packet);
    }

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

    pub fn ws_server(&self) -> Addr<WsServer> {
        WsServer::from_registry()
    }

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
            // .chain(fern::log_file("output.log")?)
            .apply()?;

        Ok(())
    }

    fn prepare(&mut self) {
        while let Some(world) = self.pending_worlds.pop() {
            self.send_world_to_create(world);
        }
    }

    fn send_world_to_create(&self, packet: (String, WorldConfig)) {
        self.ws_server().do_send(CreateWorld {
            name: packet.0,
            config: packet.1,
        });
    }
}

#[derive(Default)]
pub struct ServerBuilder {
    port: u16,
}

impl ServerBuilder {
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    pub fn build(self) -> Server {
        Server {
            port: self.port,

            started: false,
            pending_worlds: vec![],
        }
    }
}
