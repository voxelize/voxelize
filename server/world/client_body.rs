use super::*;

const CLIENT_BODY_WIDTH: f32 = 0.8;
const CLIENT_BODY_HEIGHT: f32 = 1.8;
const CLIENT_BODY_DEPTH: f32 = 0.8;
const CLIENT_CROUCH_BODY_HEIGHT_RATIO: f32 = 0.83;
const CLIENT_SWIM_BODY_HEIGHT: f32 = 0.4;
const CLIENT_AABB_HEIGHT_EPSILON: f32 = 0.01;

/// Count of inbound client voxel UPDATEs dropped while `allow_client_voxel_writes` is false.
pub(super) static CLIENT_VOXEL_UPDATE_REJECTED: AtomicU64 = AtomicU64::new(0);

fn apply_client_ghost_state(body: &mut RigidBodyComp, is_ghost: bool) {
    let position = body.0.get_position();
    let aabb = &mut body.0.aabb;

    if is_ghost {
        let avg_x = (aabb.min_x + aabb.max_x) / 2.0;
        let avg_y = (aabb.min_y + aabb.max_y) / 2.0;
        let avg_z = (aabb.min_z + aabb.max_z) / 2.0;
        aabb.min_x = avg_x + 1.0;
        aabb.max_x = avg_x - 1.0;
        aabb.min_y = avg_y + 1.0;
        aabb.max_y = avg_y - 1.0;
        aabb.min_z = avg_z + 1.0;
        aabb.max_z = avg_z - 1.0;
        body.0.gravity_multiplier = 0.0;
    } else if aabb.width() <= 0.0 {
        aabb.min_x = position.0 - CLIENT_BODY_WIDTH / 2.0;
        aabb.min_y = position.1 - CLIENT_BODY_HEIGHT / 2.0;
        aabb.min_z = position.2 - CLIENT_BODY_DEPTH / 2.0;
        aabb.max_x = aabb.min_x + CLIENT_BODY_WIDTH;
        aabb.max_y = aabb.min_y + CLIENT_BODY_HEIGHT;
        aabb.max_z = aabb.min_z + CLIENT_BODY_DEPTH;
    }
}

fn client_body_height(is_swim_pose_active: bool, is_crouching: bool) -> f32 {
    if is_swim_pose_active {
        CLIENT_SWIM_BODY_HEIGHT
    } else if is_crouching {
        CLIENT_BODY_HEIGHT * CLIENT_CROUCH_BODY_HEIGHT_RATIO
    } else {
        CLIENT_BODY_HEIGHT
    }
}

fn set_client_body_height(body: &mut RigidBodyComp, target_height: f32) {
    if body.0.aabb.width() <= 0.0 {
        return;
    }

    let current_height = body.0.aabb.height();
    if (current_height - target_height).abs() <= CLIENT_AABB_HEIGHT_EPSILON {
        return;
    }

    let min_y = body.0.aabb.min_y;
    body.0.aabb.max_y = min_y + target_height;
}

pub fn apply_client_swim_pose_state(
    body: &mut RigidBodyComp,
    is_swim_pose_active: bool,
    is_crouching: bool,
) {
    body.0.is_swim_pose_active = is_swim_pose_active;
    let target_height = client_body_height(is_swim_pose_active, is_crouching);
    set_client_body_height(body, target_height);
}

/// The default client metadata parser, parses PositionComp and DirectionComp, and updates RigidBodyComp.
/// Position updates are clamped to a maximum per-message delta so clients cannot
/// teleport past server reach checks (mine/place/stations).
pub fn default_client_parser(world: &mut World, metadata: &str, client_ent: Entity) {
    let peer_update: PeerUpdate = match serde_json::from_str(metadata) {
        Ok(metadata) => metadata,
        Err(_e) => {
            warn!("Could not parse peer update: {}", metadata);
            return;
        }
    };

    if let Some(position) = peer_update.position {
        // Max plausible movement per peer packet (dash/knockback/lag margin).
        // Far beyond this is treated as a cheat teleport and clamped.
        const MAX_PEER_POS_DELTA: f32 = 24.0;
        let mut clamped = [position.0, position.1, position.2];
        {
            let positions = world.read_component::<PositionComp>();
            if let Some(p) = positions.get(client_ent) {
                let dx = position.0 - p.0 .0;
                let dy = position.1 - p.0 .1;
                let dz = position.2 - p.0 .2;
                let dist = (dx * dx + dy * dy + dz * dz).sqrt();
                if dist > MAX_PEER_POS_DELTA {
                    let scale = MAX_PEER_POS_DELTA / dist;
                    clamped[0] = p.0 .0 + dx * scale;
                    clamped[1] = p.0 .1 + dy * scale;
                    clamped[2] = p.0 .2 + dz * scale;
                    warn!(
                        "Clamped peer position delta {:.1} -> {:.1} for entity {:?}",
                        dist, MAX_PEER_POS_DELTA, client_ent
                    );
                }
            }
        }
        {
            let mut positions = world.write_component::<PositionComp>();
            if let Some(p) = positions.get_mut(client_ent) {
                p.0.set(clamped[0], clamped[1], clamped[2]);
            }
        }

        {
            let mut bodies = world.write_component::<RigidBodyComp>();
            if let Some(b) = bodies.get_mut(client_ent) {
                b.0.set_position(clamped[0], clamped[1], clamped[2]);
            }
        }
    }

    if let Some(direction) = peer_update.direction {
        let mut directions = world.write_component::<DirectionComp>();
        if let Some(d) = directions.get_mut(client_ent) {
            d.0.set(direction.0, direction.1, direction.2);
        }
    }

    if let Some(crouching) = peer_update.is_crouching {
        let mut bodies = world.write_component::<RigidBodyComp>();
        if let Some(b) = bodies.get_mut(client_ent) {
            let is_swim_pose_active = peer_update
                .is_swim_pose_active
                .unwrap_or(b.0.is_swim_pose_active);
            apply_client_swim_pose_state(b, is_swim_pose_active, crouching);
        }
    }

    if peer_update.is_ghost.is_some() || peer_update.is_flying.is_some() {
        let mut bodies = world.write_component::<RigidBodyComp>();
        if let Some(b) = bodies.get_mut(client_ent) {
            let is_ghost = peer_update
                .is_ghost
                .unwrap_or_else(|| b.0.aabb.width() <= 0.0);
            let is_flying = peer_update.is_flying.unwrap_or(false);
            apply_client_ghost_state(b, is_ghost);
            b.0.gravity_multiplier = if is_ghost || is_flying { 0.0 } else { 1.0 };
        }
    }

    if peer_update.is_swimming.is_some() || peer_update.is_swim_pose_active.is_some() {
        let mut bodies = world.write_component::<RigidBodyComp>();
        if let Some(b) = bodies.get_mut(client_ent) {
            let is_swimming = peer_update.is_swimming.unwrap_or(b.0.is_swimming);
            let is_swim_pose_active = peer_update.is_swim_pose_active.unwrap_or(is_swimming);
            b.0.is_swimming = is_swimming;
            let is_crouching = peer_update.is_crouching.unwrap_or(false);
            apply_client_swim_pose_state(b, is_swim_pose_active, is_crouching);
        }
    }

    apply_client_preferences_patch(world, client_ent, &parse_preferences_patch(metadata));
}

pub fn apply_client_preferences_patch(
    world: &mut World,
    client_ent: Entity,
    patch: &ClientPreferencesPatch,
) {
    if patch.is_empty() {
        return;
    }

    let mut storage = world.write_component::<ClientPreferencesComp>();
    if let Some(comp) = storage.get_mut(client_ent) {
        comp.0.apply_patch_mut(*patch);
    }
}
