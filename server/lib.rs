mod libs;
mod networking;

pub use libs::*;
pub use networking::*;

pub fn hello() {
    println!("Hello, world!");
}
