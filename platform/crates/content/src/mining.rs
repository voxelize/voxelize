//! How long breaking a block takes and whether it yields drops.
//!
//! The server owns this calculation: the client shows progress from the same
//! function, but a break request that arrives sooner than
//! [`MiningRule::min_break_millis`] allows is rejected (anti-cheat
//! "impossible mining").

use crate::defs::{BlockDef, ItemDef};

/// Multiplier applied when the held item cannot harvest the block: breaking
/// is possible but slow, and yields nothing.
pub const WRONG_TOOL_PENALTY: f32 = 5.0;
/// Multiplier applied when the held item can harvest the block.
pub const HARVEST_FACTOR: f32 = 1.5;

/// Player-side modifiers to mining speed. All are multipliers on speed, so
/// values above 1.0 mine faster.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MiningModifiers {
    /// Status effects (haste-like or fatigue-like), product of all active.
    pub effects: f32,
    /// Standing on the ground; mining mid-air is slower.
    pub on_ground: bool,
    /// Head under water.
    pub underwater: bool,
}

impl Default for MiningModifiers {
    fn default() -> Self {
        Self {
            effects: 1.0,
            on_ground: true,
            underwater: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MiningRule {
    /// The block cannot be broken outside creative mode.
    Unbreakable,
    Breakable {
        /// Wall-clock milliseconds the break takes.
        millis: u32,
        /// Whether breaking yields the block's drops.
        harvests: bool,
    },
}

impl MiningRule {
    /// The earliest a server accepts a break after it started, allowing for
    /// network jitter. `None` for unbreakable blocks.
    pub fn min_break_millis(&self, tolerance: f32) -> Option<u32> {
        match self {
            MiningRule::Unbreakable => None,
            MiningRule::Breakable { millis, .. } => {
                Some((*millis as f32 * tolerance.clamp(0.0, 1.0)).floor() as u32)
            }
        }
    }
}

/// Whether `held` can harvest `block` (drops are produced).
pub fn can_harvest(block: &BlockDef, held: Option<&ItemDef>) -> bool {
    match &block.tool {
        None => true,
        Some(requirement) if !requirement.required => true,
        Some(requirement) => held
            .and_then(|item| item.tool.as_ref())
            .is_some_and(|tool| tool.kind == requirement.kind && tool.tier >= requirement.min_tier),
    }
}

/// Mining speed of `held` against `block`: the tool's speed when its kind
/// matches the block's preferred tool, 1.0 otherwise.
pub fn tool_speed(block: &BlockDef, held: Option<&ItemDef>) -> f32 {
    let Some(tool) = held.and_then(|item| item.tool.as_ref()) else {
        return 1.0;
    };
    match &block.tool {
        Some(requirement) if requirement.kind == tool.kind => tool.speed,
        _ => 1.0,
    }
}

pub fn mining_rule(block: &BlockDef, held: Option<&ItemDef>, modifiers: MiningModifiers) -> MiningRule {
    if block.hardness < 0.0 {
        return MiningRule::Unbreakable;
    }
    if block.hardness == 0.0 {
        return MiningRule::Breakable {
            millis: 0,
            harvests: can_harvest(block, held),
        };
    }

    let harvests = can_harvest(block, held);
    let mut speed = tool_speed(block, held) * modifiers.effects.max(0.0);
    if !modifiers.on_ground {
        speed /= 5.0;
    }
    if modifiers.underwater {
        speed /= 5.0;
    }
    if speed <= 0.0 {
        return MiningRule::Unbreakable;
    }
    let factor = if harvests { HARVEST_FACTOR } else { WRONG_TOOL_PENALTY };
    let seconds = block.hardness * factor / speed;
    MiningRule::Breakable {
        millis: (seconds * 1000.0).round().min(u32::MAX as f32) as u32,
        harvests,
    }
}
