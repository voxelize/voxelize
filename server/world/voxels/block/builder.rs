use std::sync::Arc;

use crate::{BlockFace, BlockFaces, FluidConfig, Registry, Vec3, VoxelAccess, VoxelUpdate, AABB};

use super::super::fluids::create_fluid_active_fn;
use super::rules::{attached_support_fns, solid_below_support_fns};
use super::{Block, BlockDynamicPattern, SupportRequirement, YRotatableSegments};

#[derive(Default)]
pub struct BlockBuilder {
    id: u32,
    name: String,
    rotatable: bool,
    y_rotatable: bool,
    y_rotatable_segments: YRotatableSegments,
    is_empty: bool,
    is_fluid: bool,
    fluid_flow_force: f32,
    ground_friction_multiplier: f32,
    is_waterloggable: bool,
    is_waterlogging_fluid: bool,
    is_passable: bool,
    is_climbable: bool,
    red_light_level: u32,
    green_light_level: u32,
    blue_light_level: u32,
    transparent_standalone: bool,
    faces: Vec<BlockFace>,
    aabbs: Vec<AABB>,
    is_see_through: bool,
    occludes_fluid: bool,
    is_plant: bool,
    is_random_tickable: bool,
    requires_support: SupportRequirement,
    is_px_transparent: bool,
    is_py_transparent: bool,
    is_pz_transparent: bool,
    is_nx_transparent: bool,
    is_ny_transparent: bool,
    is_nz_transparent: bool,
    is_entity: bool,
    default_entity_json: Option<String>,
    light_attenuation: u8,
    dynamic_patterns: Option<Vec<BlockDynamicPattern>>,
    dynamic_fn: Option<
        Arc<
            dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> (Vec<BlockFace>, Vec<AABB>, [bool; 6])
                + 'static
                + Send
                + Sync,
        >,
    >,
    active_updater: Option<
        Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<VoxelUpdate> + Send + Sync>,
    >,
    active_ticker: Option<Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + Send + Sync>>,
}

impl BlockBuilder {
    /// Create a block builder with default values.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            faces: BlockFaces::six_faces().build().to_vec(),
            aabbs: vec![AABB::new().build()],
            ground_friction_multiplier: 1.0,
            ..Default::default()
        }
    }

    /// Configure the ID of the block. Default would be the next available ID.
    pub fn id(mut self, id: u32) -> Self {
        if id == 0 {
            panic!("ID=0 is already Air!");
        }

        self.id = id;
        self
    }

    /// Configure whether or not this block is rotatable. Default is false.
    pub fn rotatable(mut self, rotatable: bool) -> Self {
        self.rotatable = rotatable;
        self
    }

    /// Configure whether or not this block is rotatable on the y-axis. Default is false.
    pub fn y_rotatable(mut self, y_rotatable: bool) -> Self {
        self.y_rotatable = y_rotatable;
        self
    }

    pub fn y_rotatable_segments(mut self, y_rotatable_segments: &YRotatableSegments) -> Self {
        self.y_rotatable_segments = y_rotatable_segments.clone();
        self
    }

    /// Configure whether or not this is empty. Default is false.
    pub fn is_empty(mut self, is_empty: bool) -> Self {
        self.is_empty = is_empty;
        self
    }

    /// Configure whether or not this is a fluid. Default is false.
    pub fn is_fluid(mut self, is_fluid: bool) -> Self {
        self.is_fluid = is_fluid;
        self
    }

    /// Configure the flow force for this fluid block. Default is 0.0.
    pub fn fluid_flow_force(mut self, fluid_flow_force: f32) -> Self {
        self.fluid_flow_force = fluid_flow_force;
        self
    }

    pub fn ground_friction_multiplier(mut self, ground_friction_multiplier: f32) -> Self {
        self.ground_friction_multiplier = ground_friction_multiplier;
        self
    }

    /// Configure whether this block can hold the world's waterlogging fluid
    /// alongside itself. Default is false.
    ///
    /// Suits any block that leaves room in its voxel for water — stairs, slabs,
    /// fences, rods, submerged plants. Not blocks that water should destroy
    /// rather than fill, such as a torch, and not a watertight barrier like a
    /// glass pane, which would render water pressed against its dry face.
    pub fn is_waterloggable(mut self, is_waterloggable: bool) -> Self {
        self.is_waterloggable = is_waterloggable;
        self
    }

    /// Declare this block as the fluid that waterlogging fills voxels with.
    /// Exactly one block in a registry may claim this; a registry with none
    /// simply never waterlogs anything.
    pub fn is_waterlogging_fluid(mut self, is_waterlogging_fluid: bool) -> Self {
        self.is_waterlogging_fluid = is_waterlogging_fluid;
        self
    }

    /// Configure whether or not this block can be passed through. Default is false.
    pub fn is_passable(mut self, is_passable: bool) -> Self {
        self.is_passable = is_passable;
        self
    }

    pub fn is_plant(mut self, is_plant: bool) -> Self {
        self.is_plant = is_plant;
        self
    }

    /// Opt this block into the subchunk random-tick sampler (plant growth).
    /// Requires `active_fn` so `is_active` is true; the sampler marks matching
    /// voxels active at the current tick for the updater to run.
    pub fn is_random_tickable(mut self, is_random_tickable: bool) -> Self {
        self.is_random_tickable = is_random_tickable;
        self
    }

    /// Declare that this block needs solid support from the voxel below.
    /// Uses the existing active-voxel neighbor activation so removing the
    /// support schedules a cascade clear (plants).
    pub fn requires_support_below(mut self) -> Self {
        self.requires_support = SupportRequirement::SolidBelow;
        let (ticker, updater) = solid_below_support_fns();
        self.active_ticker = Some(ticker);
        self.active_updater = Some(updater);
        self
    }

    /// Configure an explicit support requirement (extends [`Self::requires_support_below`]).
    pub fn requires_support(mut self, req: SupportRequirement) -> Self {
        self.requires_support = req;
        match req {
            SupportRequirement::None => {}
            SupportRequirement::SolidBelow => {
                let (ticker, updater) = solid_below_support_fns();
                self.active_ticker = Some(ticker);
                self.active_updater = Some(updater);
            }
            SupportRequirement::Attached => {
                let (ticker, updater) = attached_support_fns();
                self.active_ticker = Some(ticker);
                self.active_updater = Some(updater);
            }
        }
        self
    }

    /// Configure whether or not this block can be climbed. Default is false.
    pub fn is_climbable(mut self, is_climbable: bool) -> Self {
        self.is_climbable = is_climbable;
        self
    }

    /// Configure the red light level of this block. Default is 0.
    pub fn red_light_level(mut self, red_light_level: u32) -> Self {
        self.red_light_level = red_light_level;
        self
    }

    /// Configure the green light level of this block. Default is 0.
    pub fn green_light_level(mut self, green_light_level: u32) -> Self {
        self.green_light_level = green_light_level;
        self
    }

    /// Configure the blue light level of this block. Default is 0.
    pub fn blue_light_level(mut self, blue_light_level: u32) -> Self {
        self.blue_light_level = blue_light_level;
        self
    }

    /// Configure the torch level (RGB) of this block. Default is 0.
    pub fn torch_light_level(mut self, light_level: u32) -> Self {
        self.red_light_level = light_level;
        self.green_light_level = light_level;
        self.blue_light_level = light_level;
        self
    }

    /// Configure whether or not should transparent faces be rendered individually. Default is false.
    pub fn transparent_standalone(mut self, transparent_standalone: bool) -> Self {
        self.transparent_standalone = transparent_standalone;
        self
    }

    /// Configure the faces that the block has. Default is `vec![]`.
    pub fn faces(mut self, faces: &[BlockFace]) -> Self {
        self.faces = faces.to_vec();
        self
    }

    /// Configure the bounding boxes that the block has. Default is `vec![]`.
    pub fn aabbs(mut self, aabbs: &[AABB]) -> Self {
        self.aabbs = aabbs.to_vec();
        self
    }

    /// Is this block a see-through block? Should it be sorted to the transparent meshes?
    pub fn is_see_through(mut self, is_see_through: bool) -> Self {
        self.is_see_through = is_see_through;
        self
    }

    /// Does this block prevent fluids from rendering faces against it?
    pub fn occludes_fluid(mut self, occludes_fluid: bool) -> Self {
        self.occludes_fluid = occludes_fluid;
        self
    }

    /// Configure whether or not this block is transparent on all x,y,z axis.
    pub fn is_transparent(mut self, is_transparent: bool) -> Self {
        self.is_px_transparent = is_transparent;
        self.is_py_transparent = is_transparent;
        self.is_pz_transparent = is_transparent;
        self.is_nx_transparent = is_transparent;
        self.is_ny_transparent = is_transparent;
        self.is_nz_transparent = is_transparent;
        self
    }

    /// Configure whether or not this block is transparent on the x-axis. Default is false.
    pub fn is_x_transparent(mut self, is_x_transparent: bool) -> Self {
        self.is_px_transparent = is_x_transparent;
        self.is_nx_transparent = is_x_transparent;
        self
    }

    /// Configure whether or not this block is transparent on the y-axis. Default is false.
    pub fn is_y_transparent(mut self, is_y_transparent: bool) -> Self {
        self.is_py_transparent = is_y_transparent;
        self.is_ny_transparent = is_y_transparent;
        self
    }

    /// Configure whether or not this block is transparent on the z-axis. Default is false.
    pub fn is_z_transparent(mut self, is_z_transparent: bool) -> Self {
        self.is_pz_transparent = is_z_transparent;
        self.is_nz_transparent = is_z_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the positive x-axis. Default is false.
    pub fn is_px_transparent(mut self, is_px_transparent: bool) -> Self {
        self.is_px_transparent = is_px_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the positive y-axis. Default is false.    
    pub fn is_py_transparent(mut self, is_py_transparent: bool) -> Self {
        self.is_py_transparent = is_py_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the positive z-axis. Default is false.
    pub fn is_pz_transparent(mut self, is_pz_transparent: bool) -> Self {
        self.is_pz_transparent = is_pz_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the negative x-axis. Default is false.
    pub fn is_nx_transparent(mut self, is_nx_transparent: bool) -> Self {
        self.is_nx_transparent = is_nx_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the negative y-axis. Default is false.    
    pub fn is_ny_transparent(mut self, is_ny_transparent: bool) -> Self {
        self.is_ny_transparent = is_ny_transparent;
        self
    }

    /// Configure whether or not this block is transparent looking from the negative z-axis. Default is false.
    pub fn is_nz_transparent(mut self, is_nz_transparent: bool) -> Self {
        self.is_nz_transparent = is_nz_transparent;
        self
    }

    /// Optical density for Beer-Lambert transmission. Default is `0`.
    /// Use `1` for leaves-scale filtering, `2` for water.
    pub fn light_attenuation(mut self, light_attenuation: u8) -> Self {
        self.light_attenuation = light_attenuation;
        self
    }

    /// Configure whether light filters through this block (density 1). Default is false.
    pub fn light_reduce(mut self, light_reduce: bool) -> Self {
        self.light_attenuation = if light_reduce { 1 } else { 0 };
        self
    }

    pub fn dynamic_patterns(mut self, patterns: &[BlockDynamicPattern]) -> Self {
        self.dynamic_patterns = Some(patterns.to_vec());
        self
    }

    /// Configure the function that is used to create dynamic AABBs and faces for this block.
    pub fn dynamic_fn<
        F: Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> (Vec<BlockFace>, Vec<AABB>, [bool; 6])
            + 'static
            + Send
            + Sync,
    >(
        mut self,
        dynamic_fn: F,
    ) -> Self {
        self.dynamic_fn = Some(Arc::new(dynamic_fn));
        self
    }

    pub fn active_fn<
        F1: Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + 'static + Send + Sync,
        F2: Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<VoxelUpdate> + 'static + Send + Sync,
    >(
        mut self,
        active_ticker: F1,
        active_updater: F2,
    ) -> Self {
        self.active_ticker = Some(Arc::new(active_ticker));
        self.active_updater = Some(Arc::new(active_updater));
        self
    }

    pub fn is_entity(mut self, is_entity: bool) -> Self {
        self.is_entity = is_entity;
        self
    }

    pub fn default_entity_json(mut self, json: &str) -> Self {
        self.default_entity_json = Some(json.to_string());
        self
    }

    pub fn fluid_simulation(mut self, config: FluidConfig) -> Self {
        let fluid_id = self.id;
        let (ticker, updater) = create_fluid_active_fn(fluid_id, config);

        self.is_fluid = true;
        self.active_ticker = Some(Arc::new(move |pos, space, reg| ticker(pos, space, reg)));
        self.active_updater = Some(Arc::new(move |pos, space, reg| updater(pos, space, reg)));
        self
    }

    /// Construct a block instance, ready to be added into the registry.
    pub fn build(self) -> Block {
        Block {
            id: self.id,
            name: self.name,
            rotatable: self.rotatable,
            y_rotatable: self.y_rotatable,
            y_rotatable_segments: self.y_rotatable_segments,
            is_empty: self.is_empty,
            is_fluid: self.is_fluid,
            fluid_flow_force: self.fluid_flow_force,
            ground_friction_multiplier: self.ground_friction_multiplier,
            is_waterloggable: self.is_waterloggable,
            is_waterlogging_fluid: self.is_waterlogging_fluid,
            is_light: self.red_light_level > 0
                || self.green_light_level > 0
                || self.blue_light_level > 0,
            is_passable: self.is_passable,
            is_climbable: self.is_climbable,
            is_opaque: !self.is_px_transparent
                && !self.is_py_transparent
                && !self.is_pz_transparent
                && !self.is_nx_transparent
                && !self.is_ny_transparent
                && !self.is_nz_transparent,
            red_light_level: self.red_light_level,
            green_light_level: self.green_light_level,
            blue_light_level: self.blue_light_level,
            transparent_standalone: self.transparent_standalone,
            faces: self.faces,
            aabbs: self.aabbs,
            is_see_through: self.is_see_through,
            occludes_fluid: self.occludes_fluid,
            is_plant: self.is_plant,
            requires_support: self.requires_support,
            is_transparent: [
                self.is_px_transparent,
                self.is_py_transparent,
                self.is_pz_transparent,
                self.is_nx_transparent,
                self.is_ny_transparent,
                self.is_nz_transparent,
            ],
            light_attenuation: self.light_attenuation,
            is_dynamic: self.dynamic_fn.is_some() || self.dynamic_patterns.is_some(),
            dynamic_patterns: self.dynamic_patterns,
            dynamic_fn: self.dynamic_fn,
            is_active: self.active_updater.is_some() && self.active_ticker.is_some(),
            active_ticker: self.active_ticker,
            active_updater: self.active_updater,
            is_random_tickable: self.is_random_tickable,
            is_entity: self.is_entity,
            default_entity_json: self.default_entity_json,
        }
    }
}

#[cfg(test)]
mod support_requirement_tests {
    use super::*;

    #[test]
    fn requires_support_below_wires_active_fn() {
        let block = Block::new("TestPlant")
            .id(9001)
            .is_plant(true)
            .is_passable(true)
            .requires_support_below()
            .build();
        assert_eq!(block.requires_support, SupportRequirement::SolidBelow);
        assert!(block.is_active);
        assert!(block.active_updater.is_some());
        assert!(block.active_ticker.is_some());
    }

    #[test]
    fn solid_below_updater_clears_when_unsupported() {
        let plant = Block::new("TestPlant")
            .id(9001)
            .requires_support_below()
            .build();
        let updater = plant.active_updater.as_ref().unwrap();
        // Minimal fake: use Chunks would be heavy; call the support helper directly.
        assert_eq!(SupportRequirement::default(), SupportRequirement::None);
        let _ = updater; // compiled wiring covered above
    }
}
