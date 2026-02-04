mod component;
mod def;
mod registry;
mod slot;

pub use component::{ItemComponent, ItemComponentName};
pub use def::{ItemDef, ItemDefBuilder};
pub use registry::ItemRegistry;
pub use slot::{HeldObject, SlotContent};
