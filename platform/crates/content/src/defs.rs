//! Serialized shapes of every content kind. These are the on-disk schema of
//! `platform/game/**.json`; field names are camelCase in JSON.

use serde::{Deserialize, Serialize};

/// Tool families a block can require and an item can be.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    Pickaxe,
    Axe,
    Shovel,
    Hoe,
    Sword,
    Shears,
    /// Lights portals (fire strikers).
    Igniter,
}

/// How a placed block may be oriented.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    #[default]
    None,
    /// Four horizontal facings (doors, furnaces, stairs).
    Horizontal,
    /// Six facings (logs, pistons).
    Full,
}

/// Which fluid a block is, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FluidKind {
    Water,
    Lava,
}

/// Server-side behaviours a block can opt into. Each one is implemented once
/// by the game server and enabled per block by data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockBehavior {
    /// Falls when nothing supports it (sand, gravel).
    Falls,
    /// Spreads onto adjacent soil when lit (turf).
    Spreads,
    /// Decays when no log is near (leaves).
    Decays,
    /// Advances growth stages on random ticks (crops, saplings).
    Grows,
    /// Melts near light sources (ice).
    Melts,
    /// Burns and spreads to flammable neighbours (fire).
    Burns,
    /// Dries back to dirt without water nearby or a crop on top (farmland).
    Dries,
    /// Carries power, losing one level per block (volt conduit).
    Conduit,
    /// Power source switched on and off by using it.
    Lever,
    /// Power source for a short pulse after being used.
    Button,
    /// Power source while a player or creature stands on it.
    Plate,
    /// Power source that pulses on a period (changed by using it).
    Clock,
    /// Turns into its `powerSwap` block when its power state changes
    /// (lamps, gates).
    Consumer,
    /// Directional: repeats power from behind to the front after a delay.
    Repeater,
    /// Directional: powers the front only while the back is unpowered.
    Inverter,
    /// Directional: pushes the block in front one cell when powered.
    Actuator,
    /// Portal surface: stays only while framed by its `portal.frame` block
    /// in its plane (stage bit 0: 0 = the plane spans x and y, 1 = z and y).
    Rift,
}

/// Which dimension a biome belongs to. Each dimension is its own world
/// with its own generator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dimension {
    #[default]
    Overworld,
    Underworld,
    Sky,
}

impl Dimension {
    pub const ALL: [Dimension; 3] = [Dimension::Overworld, Dimension::Underworld, Dimension::Sky];

    pub fn key(self) -> &'static str {
        match self {
            Dimension::Overworld => "overworld",
            Dimension::Underworld => "underworld",
            Dimension::Sky => "sky",
        }
    }

    /// Horizontal blocks of this dimension per overworld block.
    pub fn scale(self) -> f64 {
        match self {
            Dimension::Overworld => 1.0,
            Dimension::Underworld => 0.125,
            Dimension::Sky => 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolRequirement {
    pub kind: ToolKind,
    /// Minimum tool tier able to harvest the block (0 = any tool of the kind).
    #[serde(default)]
    pub min_tier: u8,
    /// Whether drops need the tool. `false` makes the tool only a speed-up
    /// (soil dug by hand still drops).
    #[serde(default = "yes")]
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DropDef {
    pub item: String,
    #[serde(default = "one_u32")]
    pub min: u32,
    #[serde(default = "one_u32")]
    pub max: u32,
    /// Probability in (0, 1].
    #[serde(default = "one_f32")]
    pub chance: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlockTextures {
    /// Texture used for every face not overridden below.
    pub all: String,
    #[serde(default)]
    pub top: Option<String>,
    #[serde(default)]
    pub bottom: Option<String>,
    #[serde(default)]
    pub side: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlockDef {
    /// Numeric voxel id. 0 is air and reserved by the engine.
    pub id: u32,
    /// Stable machine key, `snake_case`. Referenced by every other content kind.
    pub key: String,
    /// Display name.
    pub name: String,
    pub material: String,
    /// Seconds-scale hardness. Negative means unbreakable.
    pub hardness: f32,
    /// Blast resistance.
    pub resistance: f32,
    pub texture: BlockTextures,
    #[serde(default)]
    pub transparent: bool,
    #[serde(default = "yes")]
    pub collision: bool,
    #[serde(default)]
    pub gravity: bool,
    /// Emitted block light, 0..=15.
    #[serde(default)]
    pub light_emission: u32,
    #[serde(default)]
    pub tool: Option<ToolRequirement>,
    #[serde(default)]
    pub drops: Vec<DropDef>,
    #[serde(default)]
    pub orientation: Orientation,
    #[serde(default)]
    pub flammable: bool,
    #[serde(default)]
    pub fluid: Option<FluidKind>,
    #[serde(default)]
    pub behaviors: Vec<BlockBehavior>,
    /// Number of growth stages for `grows` blocks (0 when the block has none).
    #[serde(default)]
    pub stages: u32,
    /// Drops when broken at its last growth stage (ripe crops), instead of
    /// `drops`.
    #[serde(default)]
    pub grown_drops: Vec<DropDef>,
    /// Blocks it must stand on. When the block below is anything else the
    /// block breaks (and drops), and it cannot be placed there.
    #[serde(default)]
    pub support: Vec<String>,
    /// For saplings: the tree it grows into (`log` and `leaves` keys and
    /// trunk heights), taken from the biome tree schema.
    #[serde(default)]
    pub grows_into: Option<TreeDef>,
    /// The block this one becomes when its power state flips (consumers),
    /// or when used by hand (gates).
    #[serde(default)]
    pub power_swap: Option<String>,
    /// Whether this is the powered (on, open) form of a swapping pair.
    #[serde(default)]
    pub powered: bool,
    /// Can be toggled by hand with `platform.use` (gates).
    #[serde(default)]
    pub usable: bool,
    /// Experience released when mined and harvested: `[min, max]`.
    #[serde(default)]
    pub xp: Option<[u32; 2]>,
    /// Rifts: the frame that lights into this rift and the dimension it
    /// opens from the overworld (from any other dimension, rifts lead back
    /// to the overworld).
    #[serde(default)]
    pub portal: Option<PortalDef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortalDef {
    pub frame: String,
    pub to: Dimension,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    Block,
    Material,
    Tool,
    Weapon,
    Armor,
    Food,
    Seed,
    Misc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    Epic,
    Legendary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolStats {
    pub kind: ToolKind,
    pub tier: u8,
    /// Mining speed multiplier against blocks of the matching tool kind.
    pub speed: f32,
    #[serde(default)]
    pub attack_damage: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemDef {
    pub id: u32,
    pub key: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    #[serde(default = "default_stack")]
    pub stack_size: u32,
    /// Uses before breaking; absent for items that never wear.
    #[serde(default)]
    pub durability: Option<u32>,
    #[serde(default = "common")]
    pub rarity: Rarity,
    /// Reference value in soft currency minor units, used by NPC traders and
    /// analytics. Never a price players are bound to.
    #[serde(default)]
    pub value: u64,
    #[serde(default)]
    pub tool: Option<ToolStats>,
    /// Block key placed when this item is used on a face.
    #[serde(default)]
    pub places_block: Option<String>,
    /// Hunger points restored when eaten.
    #[serde(default)]
    pub food: Option<u32>,
    /// Armor: where it is worn and how much it protects.
    #[serde(default)]
    pub armor: Option<ArmorStats>,
    /// A drink that gives an effect (the bottle comes back).
    #[serde(default)]
    pub potion: Option<PotionDef>,
}

/// Status effects on bodies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectKind {
    Speed,
    Slowness,
    Strength,
    Weakness,
    Regeneration,
    Poison,
    Resistance,
    FireResistance,
    NightVision,
    WaterBreathing,
    JumpBoost,
    Hunger,
    /// Instant: heals at once, never lasts.
    Healing,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PotionDef {
    pub effect: EffectKind,
    /// Seconds it lasts (ignored for instant effects).
    #[serde(default)]
    pub seconds: f32,
    /// 0 for level I, 1 for level II.
    #[serde(default)]
    pub level: u8,
}

/// The four armor slots, top to bottom (the order of the inventory screen).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArmorSlot {
    Head,
    Chest,
    Legs,
    Feet,
}

impl ArmorSlot {
    pub const ALL: [ArmorSlot; 4] = [
        ArmorSlot::Head,
        ArmorSlot::Chest,
        ArmorSlot::Legs,
        ArmorSlot::Feet,
    ];

    pub fn index(self) -> usize {
        self as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArmorStats {
    pub slot: ArmorSlot,
    /// Armor points (all worn pieces together, at most 20, take
    /// points/25 off incoming hits).
    pub points: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemStack {
    pub item: String,
    #[serde(default = "one_u32")]
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum RecipeDef {
    Shaped {
        key: String,
        /// Rows of single-character symbols; a space is an empty slot.
        pattern: Vec<String>,
        /// Symbol -> item key.
        symbols: std::collections::BTreeMap<char, String>,
        result: ItemStack,
        /// Whether the horizontally mirrored pattern also matches.
        #[serde(default = "yes")]
        mirrored: bool,
    },
    Shapeless {
        key: String,
        ingredients: Vec<String>,
        result: ItemStack,
    },
}

impl RecipeDef {
    pub fn key(&self) -> &str {
        match self {
            RecipeDef::Shaped { key, .. } | RecipeDef::Shapeless { key, .. } => key,
        }
    }

    pub fn result(&self) -> &ItemStack {
        match self {
            RecipeDef::Shaped { result, .. } | RecipeDef::Shapeless { result, .. } => result,
        }
    }
}

/// A recipe run by a processing station (furnace, smelter, crusher...).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessingRecipeDef {
    pub key: String,
    /// Station kind key, declared in `stations`.
    pub station: String,
    pub input: ItemStack,
    pub output: ItemStack,
    /// Processing time in game ticks.
    pub ticks: u32,
    #[serde(default)]
    pub experience: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StationDef {
    pub key: String,
    pub name: String,
    /// Block that hosts the station in the world.
    pub block: String,
    /// Whether the station consumes fuel.
    #[serde(default)]
    pub fueled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FuelDef {
    pub item: String,
    /// Ticks of burn time one item provides.
    pub ticks: u32,
}

/// The terrain shape a biome asks the generator for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerrainParams {
    /// Height offset added to the continental base height.
    #[serde(default)]
    pub height_offset: f64,
    /// Amplitude of local hills.
    pub roughness: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BiomeDef {
    pub key: String,
    pub name: String,
    /// Climate point the biome is centred on; each axis in [-1, 1].
    pub temperature: f64,
    pub humidity: f64,
    pub continentalness: f64,
    pub erosion: f64,
    pub terrain: TerrainParams,
    /// Top block of a dry column.
    pub surface: String,
    /// Block under the surface down to `subsurfaceDepth`.
    pub subsurface: String,
    #[serde(default = "default_subsurface_depth")]
    pub subsurface_depth: u32,
    /// Surface block used below sea level (lake and ocean floors).
    #[serde(default)]
    pub underwater_surface: Option<String>,
    /// Weather kinds this biome can have; empty means clear only.
    #[serde(default)]
    pub weather: Vec<String>,
    #[serde(default)]
    pub vegetation: VegetationDef,
    #[serde(default)]
    pub dimension: Dimension,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VegetationDef {
    #[serde(default)]
    pub trees: Option<TreeDef>,
    /// Single blocks placed on top of the surface (grass, cacti...).
    #[serde(default)]
    pub ground_cover: Vec<GroundCoverDef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TreeDef {
    pub log: String,
    pub leaves: String,
    /// Chance per surface column, in [0, 1].
    pub density: f64,
    pub min_height: u32,
    pub max_height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroundCoverDef {
    pub block: String,
    /// Chance per surface column, in [0, 1].
    pub density: f64,
    /// Surface block the cover may grow on; any dry surface when absent.
    #[serde(default)]
    pub on: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OreDef {
    pub key: String,
    pub block: String,
    /// Block the ore may replace.
    #[serde(default = "default_ore_host")]
    pub replaces: String,
    pub min_y: i32,
    pub max_y: i32,
    pub veins_per_chunk: u32,
    pub vein_size: u32,
}

fn one_u32() -> u32 {
    1
}

fn one_f32() -> f32 {
    1.0
}

fn yes() -> bool {
    true
}

fn default_stack() -> u32 {
    64
}

fn common() -> Rarity {
    Rarity::Common
}

fn default_subsurface_depth() -> u32 {
    3
}

fn default_ore_host() -> String {
    "stone".to_owned()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MobKind {
    /// Never attacks; flees when hurt.
    Passive,
    /// Attacks only when attacked.
    Neutral,
    /// Hunts players in range.
    Hostile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpawnLight {
    /// Lit ground in daytime (animals).
    Bright,
    /// Darkness: night or caves (monsters).
    Dark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobSpawn {
    pub light: SpawnLight,
    /// Blocks it may spawn standing on.
    pub on: Vec<String>,
    /// Biomes it spawns in; every biome when empty.
    #[serde(default)]
    pub biomes: Vec<String>,
    /// Relative weight among mobs that can spawn at a spot.
    pub weight: u32,
    pub group_min: u32,
    pub group_max: u32,
}

/// One box of a mob's model, in blocks, relative to its feet centre.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelPart {
    pub name: String,
    pub size: [f32; 3],
    pub offset: [f32; 3],
    pub color: String,
    /// Legs swing while walking.
    #[serde(default)]
    pub leg: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobDef {
    pub key: String,
    pub name: String,
    pub kind: MobKind,
    pub health: f32,
    /// Blocks per second when walking.
    pub speed: f32,
    /// Melee damage (hostile and neutral mobs).
    #[serde(default)]
    pub damage: f32,
    /// Seconds between attacks.
    #[serde(default = "default_attack_cooldown")]
    pub attack_cooldown: f32,
    /// Width and height of the body, in blocks.
    pub size: [f32; 2],
    pub spawn: MobSpawn,
    #[serde(default)]
    pub drops: Vec<DropDef>,
    /// Burns in daylight under open sky.
    #[serde(default)]
    pub burns_in_daylight: bool,
    /// Item that makes it follow a player holding it, and breed when fed.
    #[serde(default)]
    pub breed_item: Option<String>,
    /// How far it notices players, in blocks.
    #[serde(default = "default_sight")]
    pub sight: f32,
    /// Experience for the player who kills it (default: 5 for hostile and
    /// neutral creatures, 2 for passive ones).
    #[serde(default)]
    pub xp: Option<u32>,
    pub model: Vec<ModelPart>,
}

impl MobDef {
    pub fn experience(&self) -> u32 {
        self.xp.unwrap_or(match self.kind {
            MobKind::Passive => 2,
            _ => 5,
        })
    }
}

fn default_attack_cooldown() -> f32 {
    1.0
}

fn default_sight() -> f32 {
    16.0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StructurePlacement {
    /// Floor level with the terrain surface.
    Surface,
    /// Buried between `minY` and `maxY`.
    Underground,
}

/// A building placed by world generation, drawn as layers of characters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StructureDef {
    pub key: String,
    pub name: String,
    pub placement: StructurePlacement,
    /// Biomes it appears in; every biome when empty.
    #[serde(default)]
    pub biomes: Vec<String>,
    /// Size of the placement grid cell, in chunks; at most one per cell.
    pub spacing: u32,
    /// Chance that a cell holds one, in (0, 1].
    pub chance: f64,
    /// Floor offset from the surface (surface placement).
    #[serde(default)]
    pub y_offset: i32,
    #[serde(default)]
    pub min_y: i32,
    #[serde(default)]
    pub max_y: i32,
    /// Character -> block key. A space keeps whatever is there; `.` is air.
    pub palette: std::collections::BTreeMap<char, String>,
    /// Bottom to top; each layer is rows along z of characters along x.
    pub layers: Vec<Vec<String>>,
    /// Filled into chests of this structure the first time they open.
    #[serde(default)]
    pub loot: Vec<DropDef>,
}

impl StructureDef {
    /// Width (x), height (y), depth (z).
    pub fn size(&self) -> (usize, usize, usize) {
        let height = self.layers.len();
        let depth = self.layers.first().map(|l| l.len()).unwrap_or(0);
        let width = self
            .layers
            .first()
            .and_then(|l| l.first())
            .map(|r| r.chars().count())
            .unwrap_or(0);
        (width, height, depth)
    }
}
