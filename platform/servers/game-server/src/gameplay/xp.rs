//! Experience: points earned by mining ores, killing creatures and smelting,
//! counted into levels on the classic curve (each level costs more), lost on
//! death, and spent at an anvil to repair worn tools and armor.

/// Total points needed to reach `level`.
pub fn points_for_level(level: u32) -> u32 {
    let l = level as f64;
    let total = if level <= 16 {
        l * l + 6.0 * l
    } else if level <= 31 {
        2.5 * l * l - 40.5 * l + 360.0
    } else {
        4.5 * l * l - 162.5 * l + 2220.0
    };
    total.round() as u32
}

/// The level reached with `points`, and the fraction of the way to the next.
pub fn level_of(points: u32) -> (u32, f32) {
    let mut level = 0;
    while points_for_level(level + 1) <= points {
        level += 1;
    }
    let (lo, hi) = (points_for_level(level), points_for_level(level + 1));
    (level, (points - lo) as f32 / (hi - lo) as f32)
}

/// Levels an anvil repair of an item worn by `worn` out of `max` costs:
/// one per quarter of its durability restored, at least one.
pub fn repair_cost(worn: u32, max: u32) -> u32 {
    if max == 0 || worn == 0 {
        return 0;
    }
    (worn * 4).div_ceil(max).max(1)
}

/// Spend `levels`: the player drops that many levels, keeping their progress
/// fraction. Returns the new total, or `None` when they lack the levels.
pub fn spend_levels(points: u32, levels: u32) -> Option<u32> {
    let (level, progress) = level_of(points);
    let target = level.checked_sub(levels)?;
    let lo = points_for_level(target);
    let hi = points_for_level(target + 1);
    Some(lo + ((hi - lo) as f32 * progress) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_follow_the_classic_curve() {
        assert_eq!(points_for_level(1), 7);
        assert_eq!(points_for_level(16), 352);
        assert_eq!(points_for_level(30), 1395);
        assert_eq!(level_of(0), (0, 0.0));
        assert_eq!(level_of(6).0, 0);
        assert_eq!(level_of(7), (1, 0.0));
        assert_eq!(level_of(1395).0, 30);
        let (l, p) = level_of(10);
        assert_eq!(l, 1);
        assert!((p - 3.0 / 9.0).abs() < 1e-6);
    }

    #[test]
    fn repairs_cost_levels() {
        assert_eq!(repair_cost(0, 100), 0);
        assert_eq!(repair_cost(1, 100), 1);
        assert_eq!(repair_cost(50, 100), 2);
        assert_eq!(repair_cost(100, 100), 4);
        assert_eq!(
            spend_levels(points_for_level(5), 2),
            Some(points_for_level(3))
        );
        assert_eq!(spend_levels(points_for_level(1), 2), None);
    }
}
