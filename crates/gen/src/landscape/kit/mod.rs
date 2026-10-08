//! The landscape test kit (feature `kit`).
//!
//! - [`no_libm`] and [`assert_no_libm!`]: the bit-stability scan;
//! - [`determinism`] and [`determinism_suite!`]: order and thread
//!   shuffles, caches at capacity one, grid equals point, two processes,
//!   and the run writer's height-map contract.
//!
//! - [`landform`] and [`landform_suite!`]: the landform suite, and the
//!   test landforms [`TestMesa`] (Cells) and [`TestSwell`] (Field) with
//!   the `kit.proving` preset that enables them.
//!
//! The province and structure suites arrive with the volume pass and the
//! structure system.

pub mod determinism;
pub mod landform;
pub mod no_libm;

pub use determinism::determinism_suite;
pub use landform::{
    landform_suite, mesa_node, nearest_instance, paint_zone, proving_landscape,
    register_test_kinds, swell_node, test_kinds, LandformCase, MesaCell, MesaPlan, SwellPlan,
    TestMesa, TestMesaParams, TestSwell, TestSwellParams,
};

/// Fails the calling test if any `.rs` file under `dir` (relative to the
/// calling crate's manifest directory) calls the platform maths library:
/// the same check `voxelize-gen` runs over its own `landscape` module.
///
/// ```ignore
/// #[test]
/// fn worldgen_is_bit_stable() {
///     voxelize_gen::landscape::kit::assert_no_libm!("src/worldgen");
/// }
/// ```
#[doc(hidden)]
#[macro_export]
macro_rules! __landscape_assert_no_libm {
    ($dir:expr) => {{
        let root = ::std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join($dir);
        let hits = $crate::landscape::kit::no_libm::scan_dir(&root);
        assert!(
            hits.is_empty(),
            "{}",
            $crate::landscape::kit::no_libm::report(&hits)
        );
    }};
}

pub use crate::__landscape_assert_no_libm as assert_no_libm;
