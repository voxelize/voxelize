//! Field programs: named shared fields, compiled once into stage programs
//! with hash-consing across every field, dead-node elimination, register
//! reuse, and range, bandwidth and Lipschitz analyses.
//!
//! - [`nodes`]: the authored expression ([`FieldExpr`]);
//! - [`ir`]: hash-consed register programs;
//! - [`compile`]: names to stage programs, analyses, taste guards;
//! - [`eval`]: kernels, splines, the bicubic and the register machine;
//! - [`grid`]: windows of columns over strided lattices.
//!
//! v1's `FieldProgram` is untouched; this compiler reuses v1's noise
//! kernels only.

pub mod compile;
pub mod eval;
pub mod grid;
pub mod ir;
pub mod nodes;

pub use compile::{
    compile_fields, Analysis, CompiledFields, FieldInfo, FieldsConfig, SaltClaims, SPINE,
};
pub use grid::{Area, FieldGrid, MacroTiles};
pub use nodes::{fx, CellMode, CellularM, FieldExpr, NoiseM, TermRole, WarpM};
