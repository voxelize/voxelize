//! The landscape test kit (feature `kit`).
//!
//! This phase carries the libm scan; the landform, province and structure
//! suites arrive with the plugin kinds they test.

pub mod no_libm;

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
