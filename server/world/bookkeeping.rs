use hashbrown::HashSet;
use specs::Entity;

#[derive(Default)]
pub struct BookkeepingUpdate {
    pub created: HashSet<String>,
    pub deleted: HashSet<String>,
}

#[derive(Default)]
pub struct Bookkeeping {
    entity_ids: HashSet<String>,
}

impl Bookkeeping {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn overwrite_entity_ids(&mut self, entity_ids: &Vec<String>) {
        self.entity_ids = entity_ids.iter().cloned().collect();
    }

    pub fn differentiate_entities(
        &mut self,
        updated_entity_ids: &Vec<String>,
    ) -> BookkeepingUpdate {
        let mut result = BookkeepingUpdate::default();

        let mut new_entities = HashSet::new();
        for entity_id in updated_entity_ids {
            if !self.entity_ids.contains(entity_id) {
                new_entities.insert(entity_id.to_owned());
                result.created.insert(entity_id.to_owned());
            }
        }

        for entity_id in &self.entity_ids {
            if !updated_entity_ids.contains(entity_id) {
                result.deleted.insert(entity_id.to_owned());
            }
        }

        self.entity_ids = new_entities;
        self.entity_ids.extend(updated_entity_ids.iter().cloned());

        result
    }
}
