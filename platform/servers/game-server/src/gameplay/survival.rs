//! Survival vitals: health, hunger, saturation, air, and the damage sources
//! that act on them every tick (fall, drowning, lava, starvation).
//!
//! [`tick`] is pure: it takes what the player's body is touching and how far
//! it moved, and returns what happened. The engine system in `mod.rs` feeds
//! it from the world and applies the outcome.

use serde::{Deserialize, Serialize};

pub const MAX_HEALTH: f32 = 20.0;
pub const MAX_FOOD: f32 = 20.0;
pub const MAX_AIR: f32 = 15.0; // seconds of breath
/// Falls up to this many blocks are free.
pub const SAFE_FALL: f32 = 3.0;
/// Health lost per second below the bottom of the world.
pub const VOID_DAMAGE: f32 = 8.0;
/// Creative players fly, so the void takes them only this far down.
pub const CREATIVE_VOID_Y: f32 = -64.0;

/// Reported positions are the eye; feet are this far below.
pub const EYE_HEIGHT: f32 = 1.425;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DamageKind {
    Fall,
    Drowning,
    Lava,
    Starvation,
    /// Hit by a creature.
    Mob,
    /// Fell out of the world (below its lowest block).
    Void,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Vitals {
    pub health: f32,
    pub food: f32,
    pub saturation: f32,
    pub air: f32,
    /// Accumulated effort; every 4.0 costs saturation, then food.
    pub exhaustion: f32,
    #[serde(skip)]
    pub fall_start: Option<f32>,
    #[serde(skip)]
    pub last_feet_y: Option<f32>,
    #[serde(skip)]
    pub regen_timer: f32,
    #[serde(skip)]
    pub hazard_timer: f32,
    /// Seconds during which falls are ignored: after joining or respawning
    /// the reported position jumps, which is not a fall.
    #[serde(skip)]
    pub grace: f32,
}

impl Default for Vitals {
    fn default() -> Self {
        Self {
            health: MAX_HEALTH,
            food: MAX_FOOD,
            saturation: 5.0,
            air: MAX_AIR,
            exhaustion: 0.0,
            fall_start: None,
            last_feet_y: None,
            regen_timer: 0.0,
            hazard_timer: 0.0,
            grace: 0.0,
        }
    }
}

impl Vitals {
    pub fn is_dead(&self) -> bool {
        self.health <= 0.0
    }

    /// Repair values loaded from disk.
    pub fn normalize(&mut self) {
        let clamp = |v: f32, max: f32| {
            if v.is_finite() {
                v.clamp(0.0, max)
            } else {
                max
            }
        };
        self.health = clamp(self.health, MAX_HEALTH);
        self.food = clamp(self.food, MAX_FOOD);
        self.saturation = clamp(self.saturation, self.food);
        self.air = clamp(self.air, MAX_AIR);
        self.exhaustion = clamp(self.exhaustion, 4.0);
    }

    pub fn respawn(&mut self) {
        *self = Vitals::default();
        self.grace = 3.0;
    }

    /// Forget fall tracking for a while (join, teleport, respawn).
    pub fn start_grace(&mut self, seconds: f32) {
        self.grace = seconds;
        self.fall_start = None;
        self.last_feet_y = None;
    }

    /// Eat food worth `points`. Returns false when already full.
    pub fn eat(&mut self, points: u32) -> bool {
        if self.food >= MAX_FOOD {
            return false;
        }
        self.food = (self.food + points as f32).min(MAX_FOOD);
        self.saturation = (self.saturation + points as f32 * 0.6).min(self.food);
        true
    }

    pub fn damage(&mut self, amount: f32) {
        self.health = (self.health - amount).max(0.0);
    }

    fn exhaust(&mut self, amount: f32) {
        self.exhaustion += amount;
        while self.exhaustion >= 4.0 {
            self.exhaustion -= 4.0;
            if self.saturation > 0.0 {
                self.saturation = (self.saturation - 1.0).max(0.0);
            } else {
                self.food = (self.food - 1.0).max(0.0);
            }
        }
    }
}

/// What the player's body touches this tick.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Surroundings {
    /// Feet height (reported eye height minus [`EYE_HEIGHT`]).
    pub feet_y: f32,
    /// A solid block directly under the feet.
    pub on_ground: bool,
    pub head_in_water: bool,
    pub feet_in_water: bool,
    pub in_lava: bool,
    /// Below the bottom of the world: falling forever.
    pub in_void: bool,
    /// Horizontal distance moved since the last tick.
    pub moved: f32,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct TickOutcome {
    pub damage: Vec<(DamageKind, f32)>,
    pub died: bool,
    /// Whether any vital changed enough for the client to be told.
    pub changed: bool,
}

/// Advance a creative player's vitals: nothing hurts them but the deep
/// void.
pub fn creative_tick(v: &mut Vitals, feet_y: f32, dt: f32) -> TickOutcome {
    let mut out = TickOutcome::default();
    if v.is_dead() || feet_y >= CREATIVE_VOID_Y {
        v.hazard_timer = 0.0;
        return out;
    }
    v.hazard_timer += dt;
    while v.hazard_timer >= 1.0 {
        v.hazard_timer -= 1.0;
        out.damage.push((DamageKind::Void, VOID_DAMAGE));
    }
    for &(_, amount) in &out.damage {
        v.damage(amount);
    }
    out.changed = !out.damage.is_empty();
    out.died = v.is_dead();
    out
}

/// Advance vitals by `dt` seconds.
pub fn tick(v: &mut Vitals, s: Surroundings, dt: f32) -> TickOutcome {
    let mut out = TickOutcome::default();
    if v.is_dead() {
        return out;
    }
    let before = (v.health, v.food.floor(), v.air.ceil());

    if v.grace > 0.0 {
        v.grace -= dt;
        v.fall_start = None;
        v.last_feet_y = Some(s.feet_y);
    }

    // Falling: remember the highest point since last on the ground.
    if let (Some(last), true) = (v.last_feet_y, v.grace <= 0.0) {
        if s.feet_y < last - 0.01 && !s.on_ground {
            v.fall_start = Some(v.fall_start.map_or(last, |start| start.max(last)));
        }
    }
    if s.feet_in_water || s.in_lava {
        v.fall_start = None;
    } else if s.on_ground {
        if let Some(start) = v.fall_start.take() {
            let distance = start - s.feet_y;
            if distance > SAFE_FALL {
                let amount = (distance - SAFE_FALL).floor();
                if amount > 0.0 {
                    out.damage.push((DamageKind::Fall, amount));
                }
            }
        }
    }
    v.last_feet_y = Some(s.feet_y);

    // Breath.
    if s.head_in_water {
        v.air = (v.air - dt).max(0.0);
    } else {
        v.air = (v.air + dt * 5.0).min(MAX_AIR);
    }

    // Per-second hazards.
    v.hazard_timer += dt;
    while v.hazard_timer >= 1.0 {
        v.hazard_timer -= 1.0;
        if s.in_lava {
            out.damage.push((DamageKind::Lava, 4.0));
        }
        if s.in_void {
            out.damage.push((DamageKind::Void, VOID_DAMAGE));
        }
        if v.air <= 0.0 {
            out.damage.push((DamageKind::Drowning, 2.0));
        }
        if v.food <= 0.0 && v.health > 1.0 {
            out.damage.push((DamageKind::Starvation, 1.0));
        }
    }

    // Hunger: walking costs effort, so does simply being alive.
    v.exhaust(s.moved * 0.01 + dt * 0.005);

    // Natural regeneration while well fed.
    if v.food >= 18.0 && v.health < MAX_HEALTH {
        v.regen_timer += dt;
        if v.regen_timer >= 4.0 {
            v.regen_timer -= 4.0;
            v.health = (v.health + 1.0).min(MAX_HEALTH);
            v.exhaust(6.0);
        }
    } else {
        v.regen_timer = 0.0;
    }

    for &(_, amount) in &out.damage {
        v.damage(amount);
    }
    out.died = v.is_dead();
    out.changed = before != (v.health, v.food.floor(), v.air.ceil()) || out.died;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(y: f32, on_ground: bool) -> Surroundings {
        Surroundings {
            feet_y: y,
            on_ground,
            head_in_water: false,
            feet_in_water: false,
            in_lava: false,
            in_void: false,
            moved: 0.0,
        }
    }

    #[test]
    fn creative_players_die_only_in_the_deep_void() {
        let mut v = Vitals::default();
        for _ in 0..100 {
            assert!(
                !creative_tick(&mut v, -40.0, 0.1).changed,
                "shallow void: fly back"
            );
        }
        assert_eq!(v.health, MAX_HEALTH);
        let mut died = false;
        for _ in 0..40 {
            let out = creative_tick(&mut v, -80.0, 0.1);
            if out.died {
                assert_eq!(out.damage, vec![(DamageKind::Void, VOID_DAMAGE)]);
                died = true;
                break;
            }
        }
        assert!(died, "the deep void kills creative players too");
    }

    #[test]
    fn the_void_kills_within_seconds() {
        let mut v = Vitals::default();
        let mut s = at(-20.0, false);
        s.in_void = true;
        let mut died = false;
        for _ in 0..(4.0 / 0.05) as usize {
            let out = tick(&mut v, s, 0.05);
            if out.died {
                assert_eq!(out.damage.last().map(|d| d.0), Some(DamageKind::Void));
                died = true;
                break;
            }
        }
        assert!(died, "dead within 4 seconds of falling out");
    }

    fn fall(v: &mut Vitals, from: f32, to: f32) -> TickOutcome {
        tick(v, at(from, true), 0.016);
        let mut y = from;
        while y > to {
            y = (y - 0.5).max(to);
            if y > to {
                tick(v, at(y, false), 0.016);
            }
        }
        tick(v, at(to, true), 0.016)
    }

    #[test]
    fn short_falls_are_free_long_falls_hurt() {
        let mut v = Vitals::default();
        assert!(fall(&mut v, 70.0, 67.0).damage.is_empty());
        let out = fall(&mut v, 70.0, 60.0);
        assert_eq!(out.damage, vec![(DamageKind::Fall, 7.0)]);
        assert_eq!(v.health, 13.0);
    }

    #[test]
    fn a_fatal_fall_kills() {
        let mut v = Vitals::default();
        let out = fall(&mut v, 120.0, 60.0);
        assert!(out.died);
        assert!(v.is_dead());
        // The dead take no further damage until they respawn.
        assert!(tick(&mut v, at(60.0, true), 1.0).damage.is_empty());
        v.respawn();
        assert_eq!(v.health, MAX_HEALTH);
        // A respawn teleport from high up is not a fall.
        tick(&mut v, at(200.0, false), 0.016);
        assert!(tick(&mut v, at(64.0, true), 0.016).damage.is_empty());
    }

    #[test]
    fn landing_in_water_breaks_the_fall() {
        let mut v = Vitals::default();
        tick(&mut v, at(90.0, true), 0.016);
        tick(&mut v, at(70.0, false), 0.016);
        let mut wet = at(65.0, true);
        wet.feet_in_water = true;
        assert!(tick(&mut v, wet, 0.016).damage.is_empty());
        assert!(tick(&mut v, at(64.0, true), 0.016).damage.is_empty());
    }

    #[test]
    fn breath_runs_out_under_water_then_drowning_hurts() {
        let mut v = Vitals::default();
        let mut under = at(50.0, true);
        under.head_in_water = true;
        under.feet_in_water = true;
        // 15 s of breath: 14 safe seconds, drowning from the 15th.
        for _ in 0..14 {
            assert!(tick(&mut v, under, 1.0).damage.is_empty());
        }
        let out = tick(&mut v, under, 1.0);
        assert_eq!(out.damage, vec![(DamageKind::Drowning, 2.0)]);
        // Surfacing refills breath.
        tick(&mut v, at(50.0, true), 1.0);
        assert!(v.air > 0.0);
    }

    #[test]
    fn lava_burns_every_second() {
        let mut v = Vitals::default();
        let mut hot = at(10.0, true);
        hot.in_lava = true;
        let out = tick(&mut v, hot, 1.0);
        assert_eq!(out.damage, vec![(DamageKind::Lava, 4.0)]);
        assert_eq!(v.health, 16.0);
    }

    #[test]
    fn walking_makes_you_hungry_and_starving_stops_at_one_heart() {
        let mut v = Vitals::default();
        let mut walk = at(64.0, true);
        walk.moved = 4.0;
        for _ in 0..20_000 {
            tick(&mut v, walk, 0.05);
        }
        assert_eq!(v.food, 0.0);
        assert!(v.health >= 1.0);
        assert!(v.health < MAX_HEALTH);
    }

    #[test]
    fn eating_restores_food_and_a_full_player_cannot_eat() {
        let mut v = Vitals::default();
        assert!(!v.eat(5));
        v.food = 10.0;
        assert!(v.eat(5));
        assert_eq!(v.food, 15.0);
    }

    #[test]
    fn regeneration_when_well_fed() {
        let mut v = Vitals::default();
        v.health = 10.0;
        for _ in 0..5 {
            tick(&mut v, at(64.0, true), 4.0);
        }
        assert!(v.health > 10.0);
    }

    #[test]
    fn corrupt_values_are_repaired() {
        let mut v = Vitals {
            health: f32::NAN,
            food: 99.0,
            ..Default::default()
        };
        v.normalize();
        assert_eq!(v.health, MAX_HEALTH);
        assert_eq!(v.food, MAX_FOOD);
    }
}
