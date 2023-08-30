mod access;
mod id;
mod registry;
mod rotation;
mod update;
mod utils;

pub use access::*;
pub use id::*;
pub use registry::*;
pub use rotation::*;
pub use update::*;
pub use utils::*;

pub trait BlockIdentity: Sync + Send + Clone + 'static {
    fn id(&self) -> BlockId;

    fn name(&self) -> &str;
}
