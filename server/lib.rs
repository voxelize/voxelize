mod app;
mod libs;

use actix::{Addr, SystemService};
use actix_web::{middleware::Logger, web, App, HttpServer};
use app::network::{messages::CreateRoom, server::WsServer, Network};
use fern::colors::{Color, ColoredLevelConfig};

pub use app::network::room::Room;

pub struct Server {
    pub port: u16,
    pub started: bool,

    pending_rooms: Vec<Room>,
}

impl Server {
    pub fn new(port: u16) -> ServerBuilder {
        ServerBuilder { port }
    }

    pub fn add_room(&mut self, room: Room) {
        if self.started {
            self.create_room(room);
            return;
        }

        self.pending_rooms.push(room);
    }

    #[actix_web::main]
    pub async fn start(&mut self) -> std::io::Result<()> {
        Server::setup_logger().expect("Something went wrong with fern.");

        let server = HttpServer::new(move || {
            App::new()
                .service(web::resource("/ws").to(Network::ws_route))
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
        // Load in rooms
        while let Some(room) = self.pending_rooms.pop() {
            self.create_room(room);
        }
    }

    fn create_room(&self, room: Room) {
        self.ws_server().do_send(CreateRoom { room });
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
            pending_rooms: vec![],
        }
    }
}
