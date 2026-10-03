//! Matching a crafting grid against shaped and shapeless recipes.
//!
//! Matching is pure: it answers which recipe a grid makes and how much of
//! each slot it consumes. Moving items is the inventory's job, done inside
//! the server's transaction so a craft can never create items from nothing.

use std::collections::BTreeMap;

use crate::defs::{ItemStack, RecipeDef};
use crate::registry::Content;

/// A square crafting grid (2x2 player grid, 3x3 table). Each slot holds an
/// item key or nothing; counts do not matter for matching, every recipe
/// slot consumes exactly one item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CraftingGrid {
    size: usize,
    slots: Vec<Option<String>>,
}

impl CraftingGrid {
    pub fn new(size: usize) -> Self {
        assert!((1..=3).contains(&size), "crafting grids are 1x1 to 3x3");
        Self {
            size,
            slots: vec![None; size * size],
        }
    }

    /// Build from rows of item keys, `None` for an empty slot.
    pub fn from_rows(rows: &[&[Option<&str>]]) -> Self {
        let size = rows.len();
        let mut grid = Self::new(size);
        for (y, row) in rows.iter().enumerate() {
            assert_eq!(row.len(), size, "crafting grids are square");
            for (x, slot) in row.iter().enumerate() {
                grid.set(x, y, slot.map(str::to_owned));
            }
        }
        grid
    }

    pub fn size(&self) -> usize {
        self.size
    }

    pub fn get(&self, x: usize, y: usize) -> Option<&str> {
        self.slots[y * self.size + x].as_deref()
    }

    pub fn set(&mut self, x: usize, y: usize, item: Option<String>) {
        self.slots[y * self.size + x] = item;
    }

    /// Bounding box of the occupied slots: (min_x, min_y, width, height).
    fn bounds(&self) -> Option<(usize, usize, usize, usize)> {
        let mut min_x = usize::MAX;
        let mut min_y = usize::MAX;
        let mut max_x = 0;
        let mut max_y = 0;
        for y in 0..self.size {
            for x in 0..self.size {
                if self.get(x, y).is_some() {
                    min_x = min_x.min(x);
                    min_y = min_y.min(y);
                    max_x = max_x.max(x);
                    max_y = max_y.max(y);
                }
            }
        }
        (min_x != usize::MAX).then(|| (min_x, min_y, max_x - min_x + 1, max_y - min_y + 1))
    }
}

/// A successful match: what the grid makes and which slots it consumes one
/// item from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CraftMatch<'a> {
    pub recipe: &'a str,
    pub result: &'a ItemStack,
    /// `(x, y)` of every slot that loses one item.
    pub consumed: Vec<(usize, usize)>,
}

/// First recipe, in pack order, that the grid satisfies.
pub fn match_recipe<'a>(content: &'a Content, grid: &CraftingGrid) -> Option<CraftMatch<'a>> {
    let (min_x, min_y, width, height) = grid.bounds()?;
    content.recipes().iter().find_map(|recipe| match recipe {
        RecipeDef::Shaped {
            key,
            pattern,
            symbols,
            result,
            mirrored,
        } => {
            let pattern_height = pattern.len();
            let pattern_width = pattern.first().map(|r| r.chars().count()).unwrap_or(0);
            if pattern_width != width || pattern_height != height {
                return None;
            }
            let rows: Vec<Vec<char>> = pattern.iter().map(|r| r.chars().collect()).collect();
            let matches = |mirror: bool| {
                (0..height).all(|y| {
                    (0..width).all(|x| {
                        let px = if mirror { width - 1 - x } else { x };
                        let expected = match rows[y][px] {
                            ' ' => None,
                            symbol => symbols.get(&symbol).map(String::as_str),
                        };
                        grid.get(min_x + x, min_y + y) == expected
                    })
                })
            };
            if matches(false) || (*mirrored && matches(true)) {
                let consumed = (0..height)
                    .flat_map(|y| (0..width).map(move |x| (min_x + x, min_y + y)))
                    .filter(|&(x, y)| grid.get(x, y).is_some())
                    .collect();
                Some(CraftMatch {
                    recipe: key,
                    result,
                    consumed,
                })
            } else {
                None
            }
        }
        RecipeDef::Shapeless {
            key,
            ingredients,
            result,
        } => {
            let mut needed: BTreeMap<&str, usize> = BTreeMap::new();
            for item in ingredients {
                *needed.entry(item.as_str()).or_default() += 1;
            }
            let mut present: BTreeMap<&str, usize> = BTreeMap::new();
            let mut consumed = Vec::new();
            for y in 0..grid.size() {
                for x in 0..grid.size() {
                    if let Some(item) = grid.get(x, y) {
                        *present.entry(item).or_default() += 1;
                        consumed.push((x, y));
                    }
                }
            }
            (needed == present).then(|| CraftMatch {
                recipe: key,
                result,
                consumed,
            })
        }
    })
}
