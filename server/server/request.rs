use chrono::prelude::*;
use log::info;

#[derive(Debug)]
pub struct Request {
    pub http_version: String,
    pub method: String,
    pub path: String,
    pub time: DateTime<Local>,
}

impl Request {
    pub fn parse(buf: &[u8]) -> Result<Self, ()> {
        let request = String::from_utf8_lossy(buf);

        let mut parts = request.split(' ');
        let method = match parts.next() {
            Some(method) => method.trim().to_string(),
            None => return Err(()),
        };
        let path = match parts.next() {
            Some(path) => {
                if path.trim().to_string().eq("/") {
                    "/index.html".to_string()
                } else {
                    path.trim().to_string()
                }
            }
            None => return Err(()),
        };
        let http_version = match parts.next() {
            Some(version) => version.trim().to_string(),
            None => return Err(()),
        };
        let time = Local::now();

        Ok(Request {
            http_version,
            method,
            path,
            time,
        })
    }
}
