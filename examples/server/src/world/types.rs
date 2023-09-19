use voxelize_protocol::Packet;

pub type PacketQueue = Vec<(String, Vec<Packet>)>;
