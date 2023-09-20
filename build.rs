fn main() {
    let mut prost_build = prost_build::Config::new();
    prost_build
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(&["./messages.proto"], &["."])
        .unwrap();
}
