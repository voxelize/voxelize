use hashbrown::HashSet;
use specs::Entity;

pub enum BookkeepingAction {
    CreateEntity(Entity),
    RemoveEntity(Entity),
}

#[derive(Default)]
pub struct Bookkeeping {
    entities: HashSet<Entity>,
}

impl Bookkeeping {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn overwrite_entities(&mut self, entities: &Vec<Entity>) {
        self.entities = entities.iter().cloned().collect();
    }

    pub fn differentiate_entities(
        &mut self,
        updated_entities: &Vec<Entity>,
    ) -> Vec<BookkeepingAction> {
        let mut actions = Vec::new();

        let mut new_entities = HashSet::new();
        for entity in updated_entities {
            if !self.entities.contains(entity) {
                new_entities.insert(*entity);
                actions.push(BookkeepingAction::CreateEntity(*entity));
            }
        }

        let mut removed_entities = HashSet::new();
        for entity in &self.entities {
            if !updated_entities.contains(entity) {
                removed_entities.insert(*entity);
                actions.push(BookkeepingAction::RemoveEntity(*entity));
            }
        }

        self.entities = new_entities;
        self.entities.extend(updated_entities.iter().cloned());

        actions
    }
}
