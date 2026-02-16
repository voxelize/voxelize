fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut prost_build = prost_build::Config::new();
    prost_build
        .protoc_arg("--experimental_allow_proto3_optional")
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(&["./messages.proto"], &["."])?;
    Ok(())
}
