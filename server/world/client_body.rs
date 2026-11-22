use super::*;

const CLIENT_BODY_WIDTH: f32 = 0.8;
const CLIENT_BODY_HEIGHT: f32 = 1.8;
const CLIENT_BODY_DEPTH: f32 = 0.8;
const CLIENT_CROUCH_BODY_HEIGHT_RATIO: f32 = 0.83;
const CLIENT_SWIM_BODY_HEIGHT: f32 = 0.4;
const CLIENT_AABB_HEIGHT_EPSILON: f32 = 0.01;

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

/// Max plausible movement per peer packet (dash/knockback/lag margin). Far
/// beyond this is treated as a cheat teleport and clamped.
pub const MAX_PEER_POS_DELTA: f32 = 24.0;

/// One client whose last position packet was clamped.
struct StrandedPeer {
    /// Where the client said it stands.
    claim: [f32; 3],
    /// Where the clamp, or the walk after it, left the server's copy.
    left_at: [f32; 3],
    /// When the clamped packet arrived. The walk waits
    /// [`STRANDED_PEER_QUIET`] from here.
    claimed_at: Instant,
}

/// How long a clamped claim must stand, with no newer packet, before the
/// server walks the copy to it.
///
/// A client that is still sending needs no help: every packet moves its
/// copy. And a claim is often simply out of date for a moment: the server
/// placed the player (a respawn, a sanctioned teleport) and a packet sent
/// before the client heard of it still names the old spot. Walking at once
/// would drag the copy back there, and forward again when the client
/// catches up. Only a client gone quiet while it disagrees is stranded.
pub const STRANDED_PEER_QUIET: Duration = Duration::from_millis(400);

/// The clients the server holds short of where they say they are.
///
/// A clamped packet moves the server's copy only [`MAX_PEER_POS_DELTA`]
/// toward the claim, and a client sends its pose only when it changes. One
/// that jumped far and then stood still (woke at a spawn, landed after a
/// long fall through a hitch, then sat down to fish) sent nothing more, so
/// its copy stayed partway for good: the server placed it there for reach,
/// interest and AI, and every other player saw it there, or not at all.
/// Once such a client has been quiet for [`STRANDED_PEER_QUIET`] the world
/// walks its copy toward the claim, one packet's distance a tick, until it
/// arrives ([`World::advance_stranded_peers`]).
#[derive(Default)]
pub struct StrandedPeerClaims(HashMap<Entity, StrandedPeer>);

impl StrandedPeerClaims {
    /// How many clients are still being walked to their claim.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl World {
    /// Walk every stranded client copy one step toward where its client
    /// says it is. Runs at the start of a tick, after that tick's inbound
    /// packets. A copy something else has placed since (a spawn, a
    /// sanctioned teleport) is left where that put it.
    pub(super) fn advance_stranded_peers(&mut self) {
        self.advance_stranded_peers_at(Instant::now());
    }

    fn advance_stranded_peers_at(&mut self, now: Instant) {
        let Some(mut stranded) = self.ecs.try_fetch_mut::<StrandedPeerClaims>() else {
            return;
        };
        if stranded.0.is_empty() {
            return;
        }
        let entities = self.ecs.entities();
        let mut positions = self.ecs.write_storage::<PositionComp>();
        let mut bodies = self.ecs.write_storage::<RigidBodyComp>();
        stranded.0.retain(|&ent, peer| {
            if !entities.is_alive(ent) {
                return false;
            }
            let Some(position) = positions.get_mut(ent) else {
                return false;
            };
            let at = [position.0 .0, position.0 .1, position.0 .2];
            if at != peer.left_at {
                return false;
            }
            if now.saturating_duration_since(peer.claimed_at) < STRANDED_PEER_QUIET {
                return true;
            }
            let delta = [
                peer.claim[0] - at[0],
                peer.claim[1] - at[1],
                peer.claim[2] - at[2],
            ];
            let dist = (delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]).sqrt();
            let is_arriving = dist <= MAX_PEER_POS_DELTA;
            let next = if is_arriving {
                peer.claim
            } else {
                let scale = MAX_PEER_POS_DELTA / dist;
                [
                    at[0] + delta[0] * scale,
                    at[1] + delta[1] * scale,
                    at[2] + delta[2] * scale,
                ]
            };
            position.0.set(next[0], next[1], next[2]);
            if let Some(body) = bodies.get_mut(ent) {
                body.0.set_position(next[0], next[1], next[2]);
            }
            peer.left_at = next;
            !is_arriving
        });
    }
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
        let claim = [position.0, position.1, position.2];
        let mut clamped = claim;
        let mut is_clamped = false;
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
                    is_clamped = true;
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

        // The newest packet is the client's whole claim: a clamped one is
        // walked the rest of the way, any other one arrived.
        if let Some(mut stranded) = world.ecs().try_fetch_mut::<StrandedPeerClaims>() {
            if is_clamped && claim.iter().all(|value| value.is_finite()) {
                stranded.0.insert(
                    client_ent,
                    StrandedPeer {
                        claim,
                        left_at: clamped,
                        claimed_at: Instant::now(),
                    },
                );
            } else {
                stranded.0.remove(&client_ent);
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

#[cfg(test)]
mod stranded_peer_tests {
    use specs::{Builder, WorldExt};

    use super::*;

    fn world_with_client(at: [f32; 3]) -> (World, Entity) {
        let config = WorldConfig::new()
            .saving(false)
            .min_chunk([-1, -1])
            .max_chunk([1, 1])
            .build();
        let mut world = World::new("stranded-peer", &config);
        let body = RigidBody::new(&AABB::new().scale_x(0.8).scale_y(1.8).scale_z(0.8).build()).build();
        let ent = world
            .ecs_mut()
            .create_entity()
            .with(PositionComp::new(at[0], at[1], at[2]))
            .with(DirectionComp::default())
            .with(RigidBodyComp::new(&body))
            .build();
        (world, ent)
    }

    fn pos_of(world: &World, ent: Entity) -> [f32; 3] {
        let positions = world.read_component::<PositionComp>();
        let p = &positions.get(ent).unwrap().0;
        [p.0, p.1, p.2]
    }

    fn stranded(world: &World) -> usize {
        world.ecs().read_resource::<StrandedPeerClaims>().len()
    }

    /// A tick long after the last packet: the client has gone quiet.
    fn quiet_tick(world: &mut World) {
        world.advance_stranded_peers_at(Instant::now() + STRANDED_PEER_QUIET * 2);
    }

    /// The report this guards: a player woke 100 blocks from where they
    /// fell and stood still; one packet, clamped, was all the server heard.
    #[test]
    fn a_clamped_jump_reaches_its_claim_without_another_packet() {
        let (mut world, ent) = world_with_client([0.0, 20.0, 0.0]);

        default_client_parser(&mut world, r#"{"position":[100.0,20.0,0.0]}"#, ent);
        assert_eq!(pos_of(&world, ent), [MAX_PEER_POS_DELTA, 20.0, 0.0]);

        let mut ticks = 0;
        while stranded(&world) > 0 {
            let before = pos_of(&world, ent)[0];
            quiet_tick(&mut world);
            let moved = pos_of(&world, ent)[0] - before;
            assert!(
                moved <= MAX_PEER_POS_DELTA + 1e-3,
                "a tick moves a body no farther than a packet may: {moved}"
            );
            ticks += 1;
            assert!(ticks < 16, "the walk must end");
        }
        assert_eq!(pos_of(&world, ent), [100.0, 20.0, 0.0]);
        let bodies = world.read_component::<RigidBodyComp>();
        let body = bodies.get(ent).unwrap().0.get_position();
        assert_eq!([body.0, body.1, body.2], [100.0, 20.0, 0.0]);
    }

    /// A packet sent before the client heard of a respawn names the old
    /// spot for a moment; the copy must not be dragged back to it.
    #[test]
    fn a_claim_is_not_walked_while_the_client_may_still_be_catching_up() {
        let (mut world, ent) = world_with_client([0.0, 20.0, 0.0]);
        default_client_parser(&mut world, r#"{"position":[100.0,20.0,0.0]}"#, ent);

        for _ in 0..10 {
            world.advance_stranded_peers_at(Instant::now());
        }
        assert_eq!(pos_of(&world, ent), [MAX_PEER_POS_DELTA, 20.0, 0.0]);
        assert_eq!(stranded(&world), 1, "the claim waits for the client to go quiet");
    }

    #[test]
    fn a_placement_by_the_server_ends_the_walk() {
        let (mut world, ent) = world_with_client([0.0, 20.0, 0.0]);
        default_client_parser(&mut world, r#"{"position":[500.0,20.0,0.0]}"#, ent);
        quiet_tick(&mut world);
        quiet_tick(&mut world);
        assert_eq!(pos_of(&world, ent), [MAX_PEER_POS_DELTA * 3.0, 20.0, 0.0]);
        assert_eq!(stranded(&world), 1);

        // A spawn or a sanctioned teleport writes the pose itself.
        world
            .write_component::<PositionComp>()
            .get_mut(ent)
            .unwrap()
            .0
            .set(7.0, 30.0, 7.0);
        quiet_tick(&mut world);
        assert_eq!(pos_of(&world, ent), [7.0, 30.0, 7.0]);
        assert_eq!(stranded(&world), 0);
    }

    #[test]
    fn the_next_packet_replaces_the_claim() {
        let (mut world, ent) = world_with_client([0.0, 20.0, 0.0]);
        default_client_parser(&mut world, r#"{"position":[500.0,20.0,0.0]}"#, ent);
        assert_eq!(stranded(&world), 1);

        // Back within reach of the copy: the client is where the server
        // has it, and nothing is left to walk.
        default_client_parser(&mut world, r#"{"position":[30.0,20.0,0.0]}"#, ent);
        assert_eq!(pos_of(&world, ent), [30.0, 20.0, 0.0]);
        assert_eq!(stranded(&world), 0);
        quiet_tick(&mut world);
        assert_eq!(pos_of(&world, ent), [30.0, 20.0, 0.0]);
    }

    #[test]
    fn a_client_that_left_is_forgotten() {
        let (mut world, ent) = world_with_client([0.0, 20.0, 0.0]);
        default_client_parser(&mut world, r#"{"position":[500.0,20.0,0.0]}"#, ent);
        world.ecs_mut().delete_entity(ent).unwrap();
        world.ecs_mut().maintain();
        quiet_tick(&mut world);
        assert_eq!(stranded(&world), 0);
    }
}
