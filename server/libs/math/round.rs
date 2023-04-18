use crate::TEN;

/// Round a float to a certain number of decimal places.
pub fn round(n: f32, digits: i32) -> f32 {
    let scale = TEN.powi(digits);
    (n * scale).round() / scale
}
