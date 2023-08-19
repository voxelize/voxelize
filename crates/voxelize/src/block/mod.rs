mod access;
mod faces;
mod id;
mod registry;
mod rotation;
mod update;
mod utils;
mod uv;

pub use access::*;
pub use faces::*;
pub use id::*;
pub use registry::*;
pub use rotation::*;
pub use update::*;
pub use utils::*;
pub use uv::*;

pub trait BlockIdentity {
    fn id(&self) -> BlockId;

    fn name(&self) -> &str;
}
