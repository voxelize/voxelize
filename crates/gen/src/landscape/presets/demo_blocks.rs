//! The demo block pack: one block per demo name of
//! [`super::roles::RoleBinding::demo`], for examples and tests (the engine
//! registry ships only Air).
//!
//! Each name carries its look as data ([`DemoKind`]), so nothing here
//! branches on a block name. Water and Lava are fluids simulated by the
//! engine's fluid updater built from the binding's own `FluidConfig`, so
//! stamping and simulation share one value; the glowing accent emits
//! light; foliage is see-through.

use voxelize::{Block, BlockFaces};

use super::roles::RoleBinding;

/// How a demo block behaves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DemoKind {
    /// An opaque cube.
    Solid,
    /// See-through foliage.
    Foliage,
    /// A passable hanging strand.
    Strand,
    /// A light source.
    Glow,
    /// A clear solid (ice).
    Clear,
    /// The fluid bound to a fluid role.
    Fluid(&'static str),
}

/// The demo pack in id order: name and behaviour.
pub const DEMO_PACK: &[(&str, DemoKind)] = &[
    ("Stone", DemoKind::Solid),
    ("Granite", DemoKind::Solid),
    ("Limestone", DemoKind::Solid),
    ("Sandstone", DemoKind::Solid),
    ("Clay", DemoKind::Solid),
    ("Mudstone", DemoKind::Solid),
    ("Basalt", DemoKind::Solid),
    ("Scoria", DemoKind::Solid),
    ("Tuff", DemoKind::Solid),
    ("Obsidian", DemoKind::Solid),
    ("Grass Block", DemoKind::Solid),
    ("Dirt", DemoKind::Solid),
    ("Sand", DemoKind::Solid),
    ("Gravel", DemoKind::Solid),
    ("Snow", DemoKind::Solid),
    ("Ice", DemoKind::Clear),
    ("Moss", DemoKind::Solid),
    ("Vines", DemoKind::Strand),
    ("Glow Stone", DemoKind::Glow),
    ("Dripstone", DemoKind::Solid),
    ("Oak Log", DemoKind::Solid),
    ("Oak Leaves", DemoKind::Foliage),
    ("Birch Log", DemoKind::Solid),
    ("Cobblestone", DemoKind::Solid),
    ("Oak Planks", DemoKind::Solid),
    ("Water", DemoKind::Fluid("fluid.water")),
    ("Lava", DemoKind::Fluid("fluid.lava")),
];

/// One block per demo name, with ids from `first_id` up in pack order.
/// Fluids take the `FluidConfig` bound to their role in `binding`.
pub fn demo_blocks(first_id: u32, binding: &RoleBinding) -> Vec<Block> {
    DEMO_PACK
        .iter()
        .enumerate()
        .map(|(i, &(name, kind))| {
            let b = Block::new(name).id(first_id + i as u32);
            match kind {
                DemoKind::Solid => b.build(),
                DemoKind::Foliage => b
                    .is_transparent(true)
                    .is_see_through(true)
                    .light_reduce(true)
                    .transparent_standalone(true)
                    .build(),
                DemoKind::Strand => b
                    .is_passable(true)
                    .is_transparent(true)
                    .is_see_through(true)
                    .faces(&BlockFaces::diagonal_faces().build())
                    .build(),
                DemoKind::Glow => b.torch_light_level(12).emissive(1.5).build(),
                DemoKind::Clear => b
                    .is_transparent(true)
                    .is_see_through(true)
                    .light_reduce(true)
                    .build(),
                DemoKind::Fluid(role) => {
                    let config = binding.fluid_config(role).cloned().unwrap_or_default();
                    b.is_passable(true)
                        .is_transparent(true)
                        .is_see_through(true)
                        .light_reduce(true)
                        .fluid_simulation(config)
                        .build()
                }
            }
        })
        .collect()
}
