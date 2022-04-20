fn main() {
    prost_build::compile_protos(&["./messages.proto"], &["."]).unwrap();
}
