use specs::{Component, NullStorage};

/// A flag for entities (animals) in the world.
#[derive(Default, Component)]
#[storage(NullStorage)]
pub struct EntityFlag;

/// A flag for clients in the world.
#[derive(Default, Component)]
#[storage(NullStorage)]
pub struct ClientFlag;

/// A flag to prevent an entity from being persisted to disk.
#[derive(Default, Component)]
#[storage(NullStorage)]
pub struct DoNotPersistComp;
