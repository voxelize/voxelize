use crate::TEN;

/// Test if two numbers are equal within a given tolerance, which by default is `1e-5`.
pub fn approx_equals(a: f32, b: f32) -> bool {
    (a - b).abs() < TEN.powi(-5)
}
