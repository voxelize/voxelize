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
        for x in shape.iter() {
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
        let mut index = 0;
        for (coord, stride) in coords.iter().zip(self.stride.iter()) {
            index += coord * stride;
        }
        index
    }

    /// Check to see if index is within the n-dimensional array's bounds
    pub fn contains(&self, coords: &[usize]) -> bool {
        for (coord, bound) in coords.iter().zip(self.shape.iter()) {
            if coord >= bound {
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
