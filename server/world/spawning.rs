use super::*;

impl World {
    /// Create a basic entity ready to be added more.
    pub fn create_base_entity(&mut self, id: &str, _etype: &str) -> EntityBuilder<'_> {
        self.ecs_mut()
            .create_entity()
            .with(IDComp::new(id))
            .with(EntityFlag::default())
            .with(CurrentChunkComp::default())
    }

    /// Create a basic entity ready to be added more.
    pub fn create_entity(&mut self, id: &str, etype: &str) -> EntityBuilder<'_> {
        self.create_base_entity(id, etype)
            .with(ETypeComp::new(etype, false))
            .with(MetadataComp::new())
            .with(CollisionsComp::new())
    }

    /// Create a basic entity ready to be added more.
    pub fn create_block_entity(&mut self, id: &str, etype: &str) -> EntityBuilder<'_> {
        self.create_base_entity(id, etype)
            .with(ETypeComp::new(etype, true))
    }

    /// Spawn an entity of type at a location.
    pub fn spawn_entity_at(&mut self, etype: &str, position: &Vec3<f32>) -> Option<Entity> {
        if !self.entity_loaders.contains_key(&etype.to_lowercase()) {
            warn!("Tried to spawn unrecognized entity type: {}", etype);
            return None;
        }

        let loader = self
            .entity_loaders
            .get(&etype.to_lowercase())
            .unwrap()
            .to_owned();

        let ent = loader(self, MetadataComp::default()).build();
        self.populate_entity(ent, &nanoid!(), etype, MetadataComp::default());

        let position = self.lift_spawn_clear_of_solids(ent, position);
        set_position(self.ecs_mut(), ent, position.0, position.1, position.2);

        Some(ent)
    }

    pub(super) fn lift_spawn_clear_of_solids(&self, ent: Entity, position: &Vec3<f32>) -> Vec3<f32> {
        // Swept-AABB physics only detects a body entering a block face from
        // outside, so a body placed overlapping solid terrain falls straight
        // through the overlapped layer and rests buried inside it: only its
        // back pokes above the surface, and its center samples the solid
        // voxel's zero light, rendering it near-black. Placement therefore
        // lifts the requested center just enough that the body's box clears
        // every solid volume it would overlap.
        let aabb = {
            let bodies = self.ecs().read_storage::<RigidBodyComp>();
            match bodies.get(ent) {
                Some(body) => body.0.aabb.clone(),
                None => return position.clone(),
            }
        };

        let half_w = aabb.width() / 2.0;
        let half_h = aabb.height() / 2.0;
        let half_d = aabb.depth() / 2.0;
        let mut test = aabb;
        test.set_position(
            position.0 - half_w,
            position.1 - half_h,
            position.2 - half_d,
        );

        let chunks = self.chunks();
        let registry = self.registry();
        // The same seam epsilon the sweep leaves between a resting body and
        // the face it rests on.
        let seam = 1e-4_f32;
        // Each pass lifts past at least one solid volume, so the world
        // height bounds the number of passes for any burial depth.
        let max_passes = self.config().max_height as usize;

        for _ in 0..max_passes {
            let mut highest_solid_top: Option<f32> = None;

            for vx in (test.min_x.floor() as i32)..=(test.max_x.floor() as i32) {
                for vz in (test.min_z.floor() as i32)..=(test.max_z.floor() as i32) {
                    for vy in (test.min_y.floor() as i32)..=(test.max_y.floor() as i32) {
                        let id = chunks.get_voxel(vx, vy, vz);
                        let block = registry.get_block_by_id(id);
                        if block.is_fluid || block.is_empty || block.is_passable {
                            continue;
                        }

                        let rotation = chunks.get_voxel_rotation(vx, vy, vz);
                        for block_aabb in block.get_aabbs(&Vec3(vx, vy, vz), &*chunks, &registry) {
                            let mut solid = rotation.rotate_aabb(&block_aabb, true, true);
                            solid.translate(vx as f32, vy as f32, vz as f32);
                            if solid.intersects(&test)
                                && highest_solid_top.map_or(true, |top| solid.max_y > top)
                            {
                                highest_solid_top = Some(solid.max_y);
                            }
                        }
                    }
                }
            }

            match highest_solid_top {
                None => break,
                Some(top) => {
                    test.translate(0.0, top + seam - test.min_y, 0.0);
                }
            }
        }

        Vec3(position.0, test.min_y + half_h, position.2)
    }

    /// Spawn an entity of type with metadata at a location.
    pub fn spawn_entity_with_metadata(
        &mut self,
        etype: &str,
        position: &Vec3<f32>,
        metadata: MetadataComp,
    ) -> Option<Entity> {
        if !self.entity_loaders.contains_key(&etype.to_lowercase()) {
            warn!("Tried to spawn unrecognized entity type: {}", etype);
            return None;
        }

        let loader = self
            .entity_loaders
            .get(&etype.to_lowercase())
            .unwrap()
            .to_owned();

        let ent = loader(self, metadata.clone()).build();
        self.populate_entity(ent, &nanoid!(), etype, metadata);

        let position = self.lift_spawn_clear_of_solids(ent, position);
        set_position(self.ecs_mut(), ent, position.0, position.1, position.2);

        Some(ent)
    }

    pub fn revive_entity(
        &mut self,
        id: &str,
        etype: &str,
        metadata: MetadataComp,
    ) -> Option<Entity> {
        if etype.starts_with("block::") {
            let voxel_meta = metadata.get::<VoxelComp>("voxel").unwrap_or_default();
            let voxel = voxel_meta.0.clone();
            if self.chunks_mut().block_entities.contains_key(&voxel) {
                warn!("Block entity already exists at voxel: {:?}", voxel);
                self.read_resource::<BackgroundEntitiesSaver>().remove(id);
                return None;
            }
            let entity = self
                .create_block_entity(id, etype)
                .with(
                    metadata
                        .get::<JsonComp>("json")
                        .unwrap_or(JsonComp::new("{}")),
                )
                .with(voxel_meta)
                .with(metadata)
                .build();
            self.chunks_mut().block_entities.insert(voxel, entity);
            return Some(entity);
        }

        if !self.entity_loaders.contains_key(&etype.to_lowercase()) {
            warn!("Tried to revive unrecognized entity type: {}", etype);
            return None;
        }

        let loader = self
            .entity_loaders
            .get(&etype.to_lowercase())
            .unwrap()
            .to_owned();

        // Wrap entity creation in panic handler to catch loader errors
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            loader(self, metadata.to_owned()).build()
        })) {
            Ok(ent) => {
                self.populate_entity(ent, id, etype, metadata.clone());

                if let Some(pos) = metadata.get::<PositionComp>("position") {
                    let pos = self.lift_spawn_clear_of_solids(ent, &pos.0);
                    set_position(self.ecs_mut(), ent, pos.0, pos.1, pos.2);
                }

                Some(ent)
            }
            Err(e) => {
                error!(
                    "Panic while creating entity {} of type {}: {:?}",
                    id, etype, e
                );
                None
            }
        }
    }

    pub fn populate_entity(&mut self, ent: Entity, id: &str, etype: &str, metadata: MetadataComp) {
        self.ecs_mut()
            .write_storage::<IDComp>()
            .insert(ent, IDComp::new(id))
            .expect("Failed to insert ID component");

        let (entity_type, is_block) = if etype.starts_with("block::") {
            (etype, true)
        } else {
            (etype, false)
        };

        self.ecs_mut()
            .write_storage::<ETypeComp>()
            .insert(ent, ETypeComp::new(entity_type, is_block))
            .expect("Failed to insert entity type component");

        self.ecs_mut()
            .write_storage::<EntityFlag>()
            .insert(ent, EntityFlag::default())
            .expect("Failed to insert entity flag");

        self.ecs_mut()
            .write_storage::<CurrentChunkComp>()
            .insert(ent, CurrentChunkComp::default())
            .expect("Failed to insert current chunk component");

        self.ecs_mut()
            .write_storage::<CollisionsComp>()
            .insert(ent, CollisionsComp::new())
            .expect("Failed to insert collisions component");

        self.ecs_mut()
            .write_storage::<MetadataComp>()
            .insert(ent, metadata)
            .expect("Failed to insert metadata component");

        let ent_id = ent.id();

        self.entity_ids_mut().insert(id.to_owned(), ent_id);
    }

    /// Load existing entities.
    pub(super) fn load_entities(&mut self) {
        if self.config().saving {
            // TODO: THIS FEELS HACKY

            let folder = self
                .read_resource::<BackgroundEntitiesSaver>()
                .folder()
                .clone();
            fs::create_dir_all(&folder).ok();
            let paths = fs::read_dir(folder).unwrap();
            let mut loaded_entities = HashMap::new();

            for path in paths {
                let path = path.unwrap().path();

                if let Ok(entity_data) = File::open(&path) {
                    let id = path.file_stem().unwrap().to_str().unwrap().to_owned();
                    let mut data: HashMap<String, Value> =
                        match serde_json::from_reader(entity_data) {
                            Ok(data) => data,
                            Err(e) => {
                                info!(
                                    "Could not load entity file: {:?}. Error: {}, removing...",
                                    path, e
                                );
                                // remove the file
                                fs::remove_file(path).unwrap();
                                continue;
                            }
                        };
                    let etype: String = serde_json::from_value(data.remove("etype").unwrap())
                        .unwrap_or_else(|_| {
                            panic!("EType filed does not exist on file: {:?}", path)
                        });
                    let mut metadata: MetadataComp =
                        serde_json::from_value(data.remove("metadata").unwrap()).unwrap_or_else(
                            |_| panic!("Metadata field does not exist on file: {:?}", path),
                        );

                    if etype.starts_with("block::") {
                        if let Some(Value::String(json_str)) = metadata.map.get("json") {
                            if let Ok(mut parsed) =
                                serde_json::from_str::<serde_json::Map<String, Value>>(json_str)
                            {
                                if parsed.remove("viewers").is_some() {
                                    metadata.map.insert(
                                        "json".to_owned(),
                                        Value::String(
                                            serde_json::to_string(&parsed).unwrap_or_default(),
                                        ),
                                    );
                                }
                            }
                        }
                    }

                    if let Some(ent) = self.revive_entity(&id, &etype, metadata.to_owned()) {
                        loaded_entities
                            .insert(id.to_owned(), (etype, ent, metadata.to_string(), true));
                    } else {
                        // Use error! instead of info! for better visibility
                        error!(
                            "Failed to revive entity {:?} of type {}. Metadata: {:?}. File will be removed.",
                            id, etype, metadata
                        );
                        // remove the file
                        if let Err(e) = fs::remove_file(path) {
                            warn!("Failed to remove file {:?}", e);
                        }
                    }
                }
            }

            if !loaded_entities.is_empty() {
                let name = self.name.to_owned();
                let mut census: HashMap<String, usize> = HashMap::new();
                for (etype, ..) in loaded_entities.values() {
                    *census.entry(etype.to_lowercase()).or_insert(0) += 1;
                }
                let mut census: Vec<_> = census.into_iter().collect();
                census.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
                let census = census
                    .iter()
                    .map(|(etype, count)| format!("{} {}", etype, count))
                    .collect::<Vec<_>>()
                    .join(", ");
                let mut bookkeeping = self.write_resource::<Bookkeeping>();
                info!(
                    "World {:?} loaded {} entities from disk ({}).",
                    name,
                    loaded_entities.len(),
                    census
                );
                bookkeeping.entities = loaded_entities;
            }
        }
    }
}
