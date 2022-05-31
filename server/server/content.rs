pub enum ContentType {
    CSS,
    GIF,
    HTML,
    JPEG,
    PNG,
    SVG,
    TEXT,
    XML,
}

impl ContentType {
    pub fn from_file_ext(ext: &str) -> ContentType {
        match ext {
            "css" => ContentType::CSS,
            "gif" => ContentType::GIF,
            "htm" => ContentType::HTML,
            "html" => ContentType::HTML,
            "jpeg" => ContentType::JPEG,
            "jpg" => ContentType::JPEG,
            "png" => ContentType::PNG,
            "svg" => ContentType::SVG,
            "txt" => ContentType::TEXT,
            "xml" => ContentType::XML,
            _ => ContentType::TEXT,
        }
    }

    pub fn value(&self) -> &str {
        match *self {
            ContentType::CSS => "text/css",
            ContentType::GIF => "image/gif",
            ContentType::HTML => "text/html",
            ContentType::JPEG => "image/jpeg",
            ContentType::PNG => "image/png",
            ContentType::SVG => "image/svg+xml",
            ContentType::TEXT => "text/plain",
            ContentType::XML => "application/xml",
        }
    }
}
