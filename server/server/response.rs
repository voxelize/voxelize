use http::StatusCode;
use log::info;
use std::io::ErrorKind;
use std::{env, fs};

use super::{content::ContentType, request::Request};

pub struct ResponseHeaders {
    content_type: Option<ContentType>,
}

impl ResponseHeaders {
    fn new() -> ResponseHeaders {
        ResponseHeaders { content_type: None }
    }
}

pub struct Response {
    pub body: Option<Vec<u8>>,
    pub headers: ResponseHeaders,
    pub status: StatusCode,
}

impl Response {
    pub fn new() -> Response {
        Response {
            body: None,
            headers: ResponseHeaders::new(),
            status: StatusCode::OK,
        }
    }

    pub fn file_request(request: &Request, static_root: &str) -> Self {
        let mut response = Response::new();

        if request.method != "GET" {
            response.status = StatusCode::METHOD_NOT_ALLOWED;
        } else {
            response.add_file(&request.path, static_root);
        }

        response
    }

    pub fn add_file(&mut self, path: &str, static_root: &str) {
        let path = format!("{}{}", static_root, path);
        let contents = fs::read(&path);
        match contents {
            Ok(contents) => {
                self.body = Some(contents);
                let ext = path.split('.').last().unwrap_or("");
                self.headers.content_type = Some(ContentType::from_file_ext(ext));
            }
            Err(e) => {
                self.status = match e.kind() {
                    ErrorKind::NotFound => StatusCode::NOT_FOUND,
                    ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                    _ => StatusCode::INTERNAL_SERVER_ERROR,
                }
            }
        }
    }

    pub fn format(self) -> Vec<u8> {
        let status_reason = self.status.canonical_reason().unwrap_or("");
        let result = format!("HTTP/1.0 {} {}\n", self.status.as_str(), status_reason,);
        let mut result = format!("{}Allow: GET\n", result);

        if let Some(content_type) = self.headers.content_type {
            result = format!("{}Content-type: {}\n", result, content_type.value());
        }

        let mut bytes = result.as_bytes().to_vec();

        if let Some(mut body) = self.body {
            bytes.append(&mut "\n".as_bytes().to_vec());
            bytes.append(&mut body);
        }

        bytes
    }
}
