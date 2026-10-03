//! Loading and validating a content pack.
//!
//! A pack is a directory with one subdirectory per content kind. Every
//! `*.json` file in a kind's directory is read in file-name order and
//! concatenated, so content can be split by theme without touching code.
//! Validation collects every problem instead of stopping at the first, so a
//! content author sees the whole list in one run.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Deserialize;

use crate::defs::*;

/// Everything a processing file may declare.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProcessingFile {
    #[serde(default)]
    stations: Vec<StationDef>,
    #[serde(default)]
    fuels: Vec<FuelDef>,
    #[serde(default)]
    recipes: Vec<ProcessingRecipeDef>,
}

/// Raw, unvalidated content as read from disk or built in code.
#[derive(Debug, Clone, Default)]
pub struct ContentSource {
    pub blocks: Vec<BlockDef>,
    pub items: Vec<ItemDef>,
    pub recipes: Vec<RecipeDef>,
    pub stations: Vec<StationDef>,
    pub fuels: Vec<FuelDef>,
    pub processing: Vec<ProcessingRecipeDef>,
    pub biomes: Vec<BiomeDef>,
    pub ores: Vec<OreDef>,
    pub mobs: Vec<MobDef>,
}

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("cannot read {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("cannot parse {path}: {source}")]
    Parse {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("content pack is invalid:\n{0}")]
    Invalid(ValidationErrors),
}

/// Every problem found in a pack.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ValidationErrors(pub Vec<String>);

impl fmt::Display for ValidationErrors {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for problem in &self.0 {
            writeln!(f, "  - {problem}")?;
        }
        Ok(())
    }
}

impl ValidationErrors {
    fn push(&mut self, problem: impl Into<String>) {
        self.0.push(problem.into());
    }
}

/// Parse every `*.json` file of a kind directory, in file-name order.
fn read_files<T: DeserializeOwned>(root: &Path, kind: &str) -> Result<Vec<T>, LoadError> {
    let dir = root.join(kind);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|source| LoadError::Io {
            path: dir.clone(),
            source,
        })?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();

    let mut out = Vec::new();
    for path in files {
        let text = fs::read_to_string(&path).map_err(|source| LoadError::Io {
            path: path.clone(),
            source,
        })?;
        out.push(serde_json::from_str(&text).map_err(|source| LoadError::Parse { path, source })?);
    }
    Ok(out)
}

/// Read a kind whose files each hold a JSON array, concatenated.
fn read_kind<T: DeserializeOwned>(root: &Path, kind: &str) -> Result<Vec<T>, LoadError> {
    Ok(read_files::<Vec<T>>(root, kind)?
        .into_iter()
        .flatten()
        .collect())
}

impl ContentSource {
    /// Read a pack directory. Parsing errors stop the load; semantic problems
    /// are reported by [`Content::build`].
    pub fn read_dir(root: impl AsRef<Path>) -> Result<Self, LoadError> {
        let root = root.as_ref();
        let mut source = ContentSource {
            blocks: read_kind(root, "blocks")?,
            items: read_kind(root, "items")?,
            recipes: read_kind(root, "recipes")?,
            biomes: read_kind(root, "biomes")?,
            ores: read_kind(root, "ores")?,
            mobs: read_kind(root, "mobs")?,
            ..Default::default()
        };
        for file in read_files::<ProcessingFile>(root, "processing")? {
            source.stations.extend(file.stations);
            source.fuels.extend(file.fuels);
            source.processing.extend(file.recipes);
        }
        Ok(source)
    }
}

/// A validated content pack with lookup indices. Every cross reference in it
/// is known to resolve.
#[derive(Debug, Clone)]
pub struct Content {
    source: ContentSource,
    blocks_by_key: HashMap<String, usize>,
    blocks_by_id: HashMap<u32, usize>,
    items_by_key: HashMap<String, usize>,
    items_by_id: HashMap<u32, usize>,
    recipes_by_key: HashMap<String, usize>,
    fuels_by_item: HashMap<String, u32>,
}

/// Machine keys are lowercase snake case so they are stable in URLs, saves
/// and database rows.
pub fn is_valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        && !key.starts_with('_')
}

fn index_unique<T>(
    items: &[T],
    kind: &str,
    key_of: impl Fn(&T) -> &str,
    errors: &mut ValidationErrors,
) -> HashMap<String, usize> {
    let mut map = HashMap::new();
    for (index, item) in items.iter().enumerate() {
        let key = key_of(item);
        if !is_valid_key(key) {
            errors.push(format!("{kind} key {key:?} is not lowercase snake_case"));
        }
        if map.insert(key.to_owned(), index).is_some() {
            errors.push(format!("duplicate {kind} key {key:?}"));
        }
    }
    map
}

fn index_ids<T>(
    items: &[T],
    kind: &str,
    id_of: impl Fn(&T) -> u32,
    key_of: impl Fn(&T) -> &str,
    errors: &mut ValidationErrors,
) -> HashMap<u32, usize> {
    let mut map: HashMap<u32, usize> = HashMap::new();
    for (index, item) in items.iter().enumerate() {
        let id = id_of(item);
        if id == 0 {
            errors.push(format!(
                "{kind} {:?} uses id 0, which is reserved",
                key_of(item)
            ));
            continue;
        }
        if let Some(previous) = map.insert(id, index) {
            errors.push(format!(
                "{kind} id {id} is used by both {:?} and {:?}",
                key_of(&items[previous]),
                key_of(item)
            ));
        }
    }
    map
}

impl Content {
    /// Validate a source and build its indices, or return every problem.
    pub fn build(source: ContentSource) -> Result<Self, ValidationErrors> {
        let mut errors = ValidationErrors::default();

        let blocks_by_key = index_unique(&source.blocks, "block", |b| &b.key, &mut errors);
        let blocks_by_id = index_ids(&source.blocks, "block", |b| b.id, |b| &b.key, &mut errors);
        let items_by_key = index_unique(&source.items, "item", |i| &i.key, &mut errors);
        let items_by_id = index_ids(&source.items, "item", |i| i.id, |i| &i.key, &mut errors);
        let recipes_by_key = index_unique(&source.recipes, "recipe", |r| r.key(), &mut errors);
        index_unique(
            &source.processing,
            "processing recipe",
            |r| &r.key,
            &mut errors,
        );
        let stations = index_unique(&source.stations, "station", |s| &s.key, &mut errors);
        index_unique(&source.biomes, "biome", |b| &b.key, &mut errors);
        index_unique(&source.ores, "ore", |o| &o.key, &mut errors);
        let biome_keys = index_unique(&source.biomes, "biome-ref", |b| &b.key, &mut ValidationErrors::default());
        index_unique(&source.mobs, "mob", |m| &m.key, &mut errors);

        let has_block = |key: &str| blocks_by_key.contains_key(key);
        let has_item = |key: &str| items_by_key.contains_key(key);

        for block in &source.blocks {
            let who = format!("block {:?}", block.key);
            if block.name.trim().is_empty() {
                errors.push(format!("{who} has an empty name"));
            }
            if !block.hardness.is_finite() || !block.resistance.is_finite() {
                errors.push(format!("{who} has a non-finite hardness or resistance"));
            }
            if block.resistance < 0.0 {
                errors.push(format!("{who} has negative resistance"));
            }
            if block.light_emission > 15 {
                errors.push(format!("{who} emits light {} > 15", block.light_emission));
            }
            if block.fluid.is_some() && block.collision {
                errors.push(format!("{who} is a fluid and must not have collision"));
            }
            if block.behaviors.contains(&BlockBehavior::Grows) && block.stages < 2 {
                errors.push(format!("{who} grows but declares fewer than 2 stages"));
            }
            if block.stages > 16 {
                errors.push(format!(
                    "{who} declares {} stages; voxels store at most 16",
                    block.stages
                ));
            }
            for key in &block.support {
                if !has_block(key) {
                    errors.push(format!("{who} needs unknown support block {key:?}"));
                }
            }
            if let Some(tree) = &block.grows_into {
                for key in [&tree.log, &tree.leaves] {
                    if !has_block(key) {
                        errors.push(format!("{who} grows into unknown block {key:?}"));
                    }
                }
                if !block.behaviors.contains(&BlockBehavior::Grows) {
                    errors.push(format!("{who} declares growsInto but does not grow"));
                }
            }
            for drop in block.drops.iter().chain(&block.grown_drops) {
                if !has_item(&drop.item) {
                    errors.push(format!("{who} drops unknown item {:?}", drop.item));
                }
                if drop.min > drop.max {
                    errors.push(format!("{who} drop {:?} has min > max", drop.item));
                }
                if !(drop.chance > 0.0 && drop.chance <= 1.0) {
                    errors.push(format!(
                        "{who} drop {:?} chance must be in (0, 1]",
                        drop.item
                    ));
                }
            }
        }

        for item in &source.items {
            let who = format!("item {:?}", item.key);
            if item.stack_size == 0 || item.stack_size > 999 {
                errors.push(format!("{who} stack size must be 1..=999"));
            }
            if item.durability.is_some() && item.stack_size != 1 {
                errors.push(format!("{who} has durability and must stack to 1"));
            }
            if let Some(block) = &item.places_block {
                if !has_block(block) {
                    errors.push(format!("{who} places unknown block {block:?}"));
                }
            }
            match (&item.tool, item.item_type) {
                (Some(tool), _) if !(tool.speed.is_finite() && tool.speed > 0.0) => {
                    errors.push(format!("{who} tool speed must be positive"));
                }
                (None, ItemType::Tool) => {
                    errors.push(format!("{who} is a tool without tool stats"))
                }
                _ => {}
            }
            if item.item_type == ItemType::Food && item.food.is_none() {
                errors.push(format!("{who} is food without a food value"));
            }
        }

        for recipe in &source.recipes {
            let who = format!("recipe {:?}", recipe.key());
            match recipe {
                RecipeDef::Shaped {
                    pattern, symbols, ..
                } => {
                    if pattern.is_empty() || pattern.len() > 3 {
                        errors.push(format!("{who} pattern must have 1..=3 rows"));
                    }
                    let width = pattern.first().map(|r| r.chars().count()).unwrap_or(0);
                    if width == 0 || width > 3 {
                        errors.push(format!("{who} pattern must have 1..=3 columns"));
                    }
                    let mut used = HashSet::new();
                    for row in pattern {
                        if row.chars().count() != width {
                            errors.push(format!("{who} pattern rows differ in width"));
                        }
                        for symbol in row.chars().filter(|c| *c != ' ') {
                            used.insert(symbol);
                            if !symbols.contains_key(&symbol) {
                                errors.push(format!("{who} uses undefined symbol {symbol:?}"));
                            }
                        }
                    }
                    if used.is_empty() {
                        errors.push(format!("{who} pattern is empty"));
                    }
                    for (symbol, item) in symbols {
                        if !used.contains(symbol) {
                            errors.push(format!("{who} defines unused symbol {symbol:?}"));
                        }
                        if !has_item(item) {
                            errors.push(format!("{who} needs unknown item {item:?}"));
                        }
                    }
                }
                RecipeDef::Shapeless { ingredients, .. } => {
                    if ingredients.is_empty() || ingredients.len() > 9 {
                        errors.push(format!("{who} needs 1..=9 ingredients"));
                    }
                    for item in ingredients {
                        if !has_item(item) {
                            errors.push(format!("{who} needs unknown item {item:?}"));
                        }
                    }
                }
            }
            check_stack(
                &who,
                recipe.result(),
                &source.items,
                &items_by_key,
                &mut errors,
            );
        }

        for station in &source.stations {
            if !has_block(&station.block) {
                errors.push(format!(
                    "station {:?} is hosted by unknown block {:?}",
                    station.key, station.block
                ));
            }
        }
        let mut fuels_by_item = HashMap::new();
        for fuel in &source.fuels {
            if !has_item(&fuel.item) {
                errors.push(format!("fuel names unknown item {:?}", fuel.item));
            }
            if fuel.ticks == 0 {
                errors.push(format!("fuel {:?} burns for 0 ticks", fuel.item));
            }
            if fuels_by_item
                .insert(fuel.item.clone(), fuel.ticks)
                .is_some()
            {
                errors.push(format!("fuel {:?} is declared twice", fuel.item));
            }
        }
        for recipe in &source.processing {
            let who = format!("processing recipe {:?}", recipe.key);
            if !stations.contains_key(&recipe.station) {
                errors.push(format!(
                    "{who} runs on unknown station {:?}",
                    recipe.station
                ));
            }
            if recipe.ticks == 0 {
                errors.push(format!("{who} takes 0 ticks"));
            }
            check_stack(
                &who,
                &recipe.input,
                &source.items,
                &items_by_key,
                &mut errors,
            );
            check_stack(
                &who,
                &recipe.output,
                &source.items,
                &items_by_key,
                &mut errors,
            );
        }

        for biome in &source.biomes {
            let who = format!("biome {:?}", biome.key);
            for (axis, value) in [
                ("temperature", biome.temperature),
                ("humidity", biome.humidity),
                ("continentalness", biome.continentalness),
                ("erosion", biome.erosion),
            ] {
                if !(-1.0..=1.0).contains(&value) {
                    errors.push(format!("{who} {axis} {value} is outside [-1, 1]"));
                }
            }
            for block in [
                Some(&biome.surface),
                Some(&biome.subsurface),
                biome.underwater_surface.as_ref(),
            ]
            .into_iter()
            .flatten()
            {
                if !has_block(block) {
                    errors.push(format!("{who} uses unknown block {block:?}"));
                }
            }
            if let Some(tree) = &biome.vegetation.trees {
                for block in [&tree.log, &tree.leaves] {
                    if !has_block(block) {
                        errors.push(format!("{who} tree uses unknown block {block:?}"));
                    }
                }
                if !(0.0..=1.0).contains(&tree.density) {
                    errors.push(format!("{who} tree density must be in [0, 1]"));
                }
                if tree.min_height < 3 || tree.min_height > tree.max_height || tree.max_height > 24
                {
                    errors.push(format!(
                        "{who} tree heights must satisfy 3 <= min <= max <= 24"
                    ));
                }
            }
            for cover in &biome.vegetation.ground_cover {
                if !has_block(&cover.block) {
                    errors.push(format!(
                        "{who} ground cover uses unknown block {:?}",
                        cover.block
                    ));
                }
                if let Some(on) = &cover.on {
                    if !has_block(on) {
                        errors.push(format!("{who} ground cover grows on unknown block {on:?}"));
                    }
                }
                if !(0.0..=1.0).contains(&cover.density) {
                    errors.push(format!("{who} ground cover density must be in [0, 1]"));
                }
            }
            if biome.terrain.roughness < 0.0 {
                errors.push(format!("{who} roughness must not be negative"));
            }
        }

        for ore in &source.ores {
            let who = format!("ore {:?}", ore.key);
            if !has_block(&ore.block) {
                errors.push(format!("{who} places unknown block {:?}", ore.block));
            }
            if !has_block(&ore.replaces) {
                errors.push(format!("{who} replaces unknown block {:?}", ore.replaces));
            }
            if ore.min_y >= ore.max_y {
                errors.push(format!("{who} minY must be below maxY"));
            }
            if ore.vein_size == 0 {
                errors.push(format!("{who} vein size must be positive"));
            }
        }

        for mob in &source.mobs {
            let who = format!("mob {:?}", mob.key);
            if !(mob.health > 0.0) || !(mob.speed > 0.0) {
                errors.push(format!("{who} needs positive health and speed"));
            }
            if mob.size.iter().any(|v| !(*v > 0.0 && *v <= 4.0)) {
                errors.push(format!("{who} size must be within (0, 4] blocks"));
            }
            if mob.kind != MobKind::Passive && mob.damage <= 0.0 {
                errors.push(format!("{who} can attack but deals no damage"));
            }
            if mob.spawn.group_min == 0 || mob.spawn.group_min > mob.spawn.group_max {
                errors.push(format!("{who} spawn group must satisfy 1 <= min <= max"));
            }
            for key in &mob.spawn.on {
                if !has_block(key) {
                    errors.push(format!("{who} spawns on unknown block {key:?}"));
                }
            }
            for key in &mob.spawn.biomes {
                if !biome_keys.contains_key(key) {
                    errors.push(format!("{who} spawns in unknown biome {key:?}"));
                }
            }
            for drop in &mob.drops {
                if !has_item(&drop.item) {
                    errors.push(format!("{who} drops unknown item {:?}", drop.item));
                }
            }
            if let Some(item) = &mob.breed_item {
                if !has_item(item) {
                    errors.push(format!("{who} breeds with unknown item {item:?}"));
                }
            }
            if mob.model.is_empty() {
                errors.push(format!("{who} has no model"));
            }
        }

        if !errors.0.is_empty() {
            return Err(errors);
        }

        Ok(Content {
            source,
            blocks_by_key,
            blocks_by_id,
            items_by_key,
            items_by_id,
            recipes_by_key,
            fuels_by_item,
        })
    }

    /// Read and validate a pack directory.
    pub fn load(root: impl AsRef<Path>) -> Result<Self, LoadError> {
        Self::build(ContentSource::read_dir(root)?).map_err(LoadError::Invalid)
    }

    pub fn blocks(&self) -> &[BlockDef] {
        &self.source.blocks
    }

    pub fn items(&self) -> &[ItemDef] {
        &self.source.items
    }

    pub fn recipes(&self) -> &[RecipeDef] {
        &self.source.recipes
    }

    pub fn stations(&self) -> &[StationDef] {
        &self.source.stations
    }

    pub fn processing(&self) -> &[ProcessingRecipeDef] {
        &self.source.processing
    }

    pub fn biomes(&self) -> &[BiomeDef] {
        &self.source.biomes
    }

    pub fn ores(&self) -> &[OreDef] {
        &self.source.ores
    }

    pub fn mobs(&self) -> &[MobDef] {
        &self.source.mobs
    }

    pub fn mob(&self, key: &str) -> Option<&MobDef> {
        self.source.mobs.iter().find(|m| m.key == key)
    }

    pub fn block(&self, key: &str) -> Option<&BlockDef> {
        self.blocks_by_key.get(key).map(|&i| &self.source.blocks[i])
    }

    pub fn block_by_id(&self, id: u32) -> Option<&BlockDef> {
        self.blocks_by_id.get(&id).map(|&i| &self.source.blocks[i])
    }

    pub fn item(&self, key: &str) -> Option<&ItemDef> {
        self.items_by_key.get(key).map(|&i| &self.source.items[i])
    }

    pub fn item_by_id(&self, id: u32) -> Option<&ItemDef> {
        self.items_by_id.get(&id).map(|&i| &self.source.items[i])
    }

    pub fn recipe(&self, key: &str) -> Option<&RecipeDef> {
        self.recipes_by_key
            .get(key)
            .map(|&i| &self.source.recipes[i])
    }

    /// Burn ticks one unit of `item` provides, if it is a fuel.
    pub fn fuel_ticks(&self, item: &str) -> Option<u32> {
        self.fuels_by_item.get(item).copied()
    }

    /// Processing recipe a station runs for a given input item.
    pub fn processing_for(&self, station: &str, input: &str) -> Option<&ProcessingRecipeDef> {
        self.source
            .processing
            .iter()
            .find(|r| r.station == station && r.input.item == input)
    }

    /// A stable digest-friendly summary used in logs and the `/platform/info`
    /// route: counts per content kind.
    pub fn summary(&self) -> BTreeMap<&'static str, usize> {
        BTreeMap::from([
            ("blocks", self.source.blocks.len()),
            ("items", self.source.items.len()),
            ("recipes", self.source.recipes.len()),
            ("stations", self.source.stations.len()),
            ("processing", self.source.processing.len()),
            ("biomes", self.source.biomes.len()),
            ("ores", self.source.ores.len()),
            ("mobs", self.source.mobs.len()),
        ])
    }
}

fn check_stack(
    who: &str,
    stack: &ItemStack,
    items: &[ItemDef],
    index: &HashMap<String, usize>,
    errors: &mut ValidationErrors,
) {
    match index.get(&stack.item) {
        None => errors.push(format!("{who} references unknown item {:?}", stack.item)),
        Some(&i) => {
            if stack.count == 0 || stack.count > items[i].stack_size {
                errors.push(format!(
                    "{who} stack of {:?} must be 1..={}",
                    stack.item, items[i].stack_size
                ));
            }
        }
    }
}
