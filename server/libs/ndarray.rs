use std::ops::{Index, IndexMut};

use num::Num;

/// N-dimensional array stored in a 1D array.
#[derive(Debug, Clone, Default)]
pub struct Ndarray<T>
where
    T: Num + Clone,
{
    /// Internal data of a n-dimensional array, represented in 1-dimension.
    pub data: Vec<T>,

    /// Shape of the n-dimensional array.
    pub shape: Vec<usize>,

    /// Stride of the n-dimensional array, generated from the shape.
    pub stride: Vec<usize>,
}

impl<T> Ndarray<T>
where
    T: Num + Clone,
{
    /// Create a new n-dimensional array.
    pub fn new(shape: &[usize], default: T) -> Self {
        let d = shape.len();

        let mut size = 1;
        for &x in shape {
            size *= x;
        }

        let data = vec![default; size];

        let mut stride = vec![0; d];

        let mut s = 1;
        for i in (0..d).rev() {
            stride[i] = s;
            s *= shape[i];
        }

        Self {
            data,
            shape: shape.to_vec(),
            stride,
        }
    }

    /// Obtain the index of the n-dimensional array
    pub fn index(&self, coords: &[usize]) -> usize {
        assert_eq!(
            coords.len(),
            self.stride.len(),
            "ndarray index dimension mismatch: got {}, expected {}",
            coords.len(),
            self.stride.len()
        );
        let mut index = 0;
        for dim in 0..coords.len() {
            index += coords[dim] * self.stride[dim];
        }
        index
    }

    /// Check to see if index is within the n-dimensional array's bounds
    pub fn contains(&self, coords: &[usize]) -> bool {
        if coords.len() != self.shape.len() {
            return false;
        }
        for dim in 0..coords.len() {
            if coords[dim] >= self.shape[dim] {
                return false;
            }
        }
        true
    }
}

impl<T: Num + Clone> Index<&[usize]> for Ndarray<T> {
    type Output = T;

    fn index(&self, index: &[usize]) -> &Self::Output {
        &self.data.get(self.index(index)).unwrap()
    }
}

impl<T: Num + Clone> IndexMut<&[usize]> for Ndarray<T> {
    fn index_mut(&mut self, index: &[usize]) -> &mut Self::Output {
        let index = self.index(index);
        self.data.get_mut(index).unwrap()
    }
}

/// Create a new n-dimensional array.
pub fn ndarray<T: Num + Clone>(shape: &[usize], default: T) -> Ndarray<T> {
    Ndarray::new(shape, default)
}

#[cfg(test)]
mod tests {
    use super::ndarray;

    #[test]
    fn contains_rejects_dimension_mismatches() {
        let arr = ndarray(&[2, 2], 0u32);
        assert!(!arr.contains(&[0]));
        assert!(!arr.contains(&[0, 0, 0]));
    }

    #[test]
    #[should_panic(expected = "ndarray index dimension mismatch")]
    fn index_panics_on_dimension_mismatch() {
        let arr = ndarray(&[2, 2], 0u32);
        let _ = arr.index(&[0]);
    }
}
