use specs::{Component, NullStorage};

/// Marker component: this entity's pose is recorded into the world's
/// position-history ring at the start of each fixed tick and is a candidate for
/// rewound hit queries.
///
/// Eligibility is a *game* decision — attach this from game code to enemies,
/// PvP-enabled players, or whatever the game deems rewindable. The engine only
/// records the poses of marked entities and answers rewound spatial queries; it
/// never decides what is eligible or what a "hit" means. Worlds without
/// lag-compensation enabled never look at this component.
#[derive(Default, Component)]
#[storage(NullStorage)]
pub struct RewindEligibleComp;
