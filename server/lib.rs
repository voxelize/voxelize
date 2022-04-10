mod app;
mod libs;

use actix_web::{middleware::Logger, web, App, HttpServer};
use app::network::Network;
use fern::colors::{Color, ColoredLevelConfig};

pub struct Server {
    port: u16,
}

impl Server {
    pub fn new(port: u16) -> ServerBuilder {
        ServerBuilder { port }
    }

    #[actix_web::main]
    pub async fn start(&self) -> std::io::Result<()> {
        Server::setup_logger().expect("Something went wrong with fern.");

        log::info!("Starting HTTP server at http://localhost:{}", self.port);

        HttpServer::new(move || {
            App::new()
                .service(web::resource("/ws").to(Network::ws_route))
                .wrap(Logger::default())
        })
        .workers(2)
        .bind(("127.0.0.1", self.port))?
        .run()
        .await
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
        Server { port: self.port }
    }
}
