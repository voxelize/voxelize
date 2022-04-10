use std::ops::{Index, IndexMut};

use num::Num;

#[derive(Debug, Clone, Default)]
pub struct Ndarray<T>
where
    T: Num + Clone,
{
    pub data: Vec<T>,
    pub shape: Vec<usize>,
    pub stride: Vec<usize>,
}

impl<T> Ndarray<T>
where
    T: Num + Clone,
{
    pub fn new(shape: Vec<usize>, default: T) -> Self {
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
            shape,
            stride,
        }
    }

    pub fn index(&self, coords: &[usize]) -> usize {
        coords
            .iter()
            .zip(self.stride.iter())
            .map(|(a, b)| a * b)
            .sum()
    }

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

pub fn ndarray<T: Num + Clone>(shape: Vec<usize>, default: T) -> Ndarray<T> {
    Ndarray::new(shape, default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ndarray_works() {
        let mut data = ndarray(vec![3, 5, 3], 0);

        assert_eq!(data.shape, vec![3, 5, 3]);
        assert_eq!(data.stride, vec![15, 3, 1]);

        data[&[1, 2, 3]] = 5;
        assert_eq!(data[&[1, 2, 3]], 5);
    }
}
