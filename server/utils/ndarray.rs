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
    ///
    /// # Example
    ///
    /// ```
    /// // Create a 3x3x3 array filled with 0
    /// let array = Ndarray::new([3, 3, 3], 0);
    /// ```
    pub fn new(shape: &[usize], default: T) -> Self {
        let d = shape.len();

        let mut size = 1;
        shape.iter().for_each(|x| size *= x);

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
        coords
            .iter()
            .zip(self.stride.iter())
            .map(|(a, b)| a * b)
            .sum()
    }

    /// Check to see if index is within the n-dimensional array's bounds
    pub fn contains(&self, coords: &[usize]) -> bool {
        !coords.iter().zip(self.shape.iter()).any(|(&a, &b)| a >= b)
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

pub fn ndarray<T: Num + Clone>(shape: &[usize], default: T) -> Ndarray<T> {
    Ndarray::new(shape, default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ndarray_works() {
        let mut data = ndarray(&[3, 5, 3], 0);

        assert_eq!(data.shape, vec![3, 5, 3]);
        assert_eq!(data.stride, vec![15, 3, 1]);

        data[&[1, 2, 3]] = 5;
        assert_eq!(data[&[1, 2, 3]], 5);
    }
}
