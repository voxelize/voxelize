//! Survival vitals: health, hunger, saturation, air, and the damage sources
//! that act on them every tick (fall, drowning, lava, starvation).
//!
//! [`tick`] is pure: it takes what the player's body is touching and how far
//! it moved, and returns what happened. The engine system in `mod.rs` feeds
//! it from the world and applies the outcome.

use platform_content::EffectKind;
use serde::{Deserialize, Serialize};

pub const MAX_HEALTH: f32 = 20.0;
pub const MAX_FOOD: f32 = 20.0;
pub const MAX_AIR: f32 = 15.0; // seconds of breath
/// Falls up to this many blocks are free.
pub const SAFE_FALL: f32 = 3.0;
/// Seconds a body keeps burning after leaving fire or lava.
pub const BURN_AFTER_FIRE: f32 = 8.0;
pub const BURN_AFTER_LAVA: f32 = 15.0;

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
    /// Hit by a player of a guild at war with the victim's.
    Player,
    /// Burning (standing in fire, or on fire after fire or lava).
    Fire,
    Poison,
    Explosion,
    Lightning,
    /// Shot by an arrow.
    Arrow,
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
    /// Seconds left on fire.
    #[serde(default)]
    pub burning: f32,
    /// Status effects running (potions, poison).
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(skip)]
    pub effect_regen_timer: f32,
    #[serde(skip)]
    pub poison_timer: f32,
}

/// A status effect on a body: its kind, level (0 = I) and seconds left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Effect {
    pub kind: EffectKind,
    pub level: u8,
    pub seconds: f32,
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
            burning: 0.0,
            effects: Vec::new(),
            effect_regen_timer: 0.0,
            poison_timer: 0.0,
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

    /// The level of an effect running on this body.
    pub fn effect(&self, kind: EffectKind) -> Option<u8> {
        self.effects
            .iter()
            .find(|e| e.kind == kind)
            .map(|e| e.level)
    }

    /// Start an effect: instant healing heals now; otherwise it replaces a
    /// weaker one of the kind (or lengthens one of the same level).
    pub fn apply_effect(&mut self, kind: EffectKind, level: u8, seconds: f32) {
        if kind == EffectKind::Healing {
            self.health = (self.health + 4.0 * f32::from(level + 1)).min(MAX_HEALTH);
            return;
        }
        match self.effects.iter_mut().find(|e| e.kind == kind) {
            Some(e) if e.level > level => {}
            Some(e) if e.level == level => e.seconds = e.seconds.max(seconds),
            Some(e) => {
                *e = Effect {
                    kind,
                    level,
                    seconds,
                }
            }
            None => self.effects.push(Effect {
                kind,
                level,
                seconds,
            }),
        }
    }

    /// Damage after the resistance effect (20 % less per level).
    pub fn resisted(&self, amount: f32) -> f32 {
        match self.effect(EffectKind::Resistance) {
            Some(l) => amount * (1.0 - 0.2 * f32::from(l + 1)).max(0.0),
            None => amount,
        }
    }

    /// Melee damage after strength (+3 per level) and weakness (-4 per level).
    pub fn melee(&self, base: f32) -> f32 {
        let strength = self
            .effect(EffectKind::Strength)
            .map_or(0.0, |l| 3.0 * f32::from(l + 1));
        let weakness = self
            .effect(EffectKind::Weakness)
            .map_or(0.0, |l| 4.0 * f32::from(l + 1));
        (base + strength - weakness).max(0.5)
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
    /// Standing in a fire block.
    pub in_fire: bool,
    /// Rain falls on this body (it puts the burning out).
    pub rained_on: bool,
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

    v.burning = (v.burning - dt).max(0.0);
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

    // Effects run down.
    for e in v.effects.iter_mut() {
        e.seconds -= dt;
    }
    v.effects.retain(|e| e.seconds > 0.0);
    let fire_immune = v.effect(EffectKind::FireResistance).is_some();

    // Fire: fire and lava set the body alight; water puts it out.
    if s.in_lava {
        v.burning = v.burning.max(BURN_AFTER_LAVA);
    } else if s.in_fire {
        v.burning = v.burning.max(BURN_AFTER_FIRE);
    }
    if s.feet_in_water || s.head_in_water || s.rained_on || fire_immune {
        v.burning = 0.0;
    }

    // Breath.
    if s.head_in_water && v.effect(EffectKind::WaterBreathing).is_none() {
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
        // Lava hurts on its own; otherwise being alight does (more in the flames).
        if v.burning > 0.0 && !s.in_lava {
            out.damage
                .push((DamageKind::Fire, if s.in_fire { 2.0 } else { 1.0 }));
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
    if let Some(l) = v.effect(EffectKind::Hunger) {
        v.exhaust(dt * 0.1 * f32::from(l + 1));
    }

    // Regeneration and poison, faster at higher levels; poison never kills.
    if let Some(l) = v.effect(EffectKind::Regeneration) {
        v.effect_regen_timer += dt;
        let every = 2.5 / f32::from(1u8 << l.min(4));
        while v.effect_regen_timer >= every {
            v.effect_regen_timer -= every;
            v.health = (v.health + 1.0).min(MAX_HEALTH);
        }
    } else {
        v.effect_regen_timer = 0.0;
    }
    if let Some(l) = v.effect(EffectKind::Poison) {
        v.poison_timer += dt;
        let every = 1.25 / f32::from(1u8 << l.min(4));
        while v.poison_timer >= every {
            v.poison_timer -= every;
            if v.health > 1.0 {
                out.damage.push((DamageKind::Poison, 1.0));
            }
        }
    } else {
        v.poison_timer = 0.0;
    }

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

    if fire_immune {
        out.damage
            .retain(|(k, _)| !matches!(k, DamageKind::Fire | DamageKind::Lava));
    }
    for &(kind, amount) in &out.damage {
        // Poison stops at one heart; resistance softens everything but the void.
        let amount = if kind == DamageKind::Void {
            amount
        } else {
            v.resisted(amount)
        };
        if kind == DamageKind::Poison {
            v.health = (v.health - amount).max(1.0_f32.min(v.health));
        } else {
            v.damage(amount);
        }
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
            in_fire: false,
            rained_on: false,
            moved: 0.0,
        }
    }

    #[test]
    fn effects_heal_poison_protect_and_run_out() {
        let mut v = Vitals::default();
        v.health = 10.0;
        v.food = 10.0; // no natural regeneration
        v.apply_effect(EffectKind::Regeneration, 0, 10.0);
        tick(&mut v, at(64.0, true), 5.0);
        assert_eq!(v.health, 12.0, "one point per 2.5 s");
        v.apply_effect(EffectKind::Healing, 0, 0.0);
        assert_eq!(v.health, 16.0);

        let mut p = Vitals::default();
        p.health = 3.0;
        p.food = 10.0;
        p.apply_effect(EffectKind::Poison, 0, 30.0);
        for _ in 0..40 {
            tick(&mut p, at(64.0, true), 0.5);
        }
        assert_eq!(p.health, 1.0, "poison stops at one heart");

        let mut f = Vitals::default();
        f.apply_effect(EffectKind::FireResistance, 0, 3.0);
        let mut s = at(64.0, true);
        s.in_lava = true;
        let out = tick(&mut f, s, 1.0);
        assert!(
            out.damage.is_empty() && f.health == MAX_HEALTH,
            "no harm in lava"
        );
        tick(&mut f, at(64.0, true), 3.0);
        assert!(f.effects.is_empty(), "it ran out");

        let mut r = Vitals::default();
        r.apply_effect(EffectKind::Resistance, 1, 60.0);
        assert!((r.resisted(10.0) - 6.0).abs() < 1e-5);
        r.apply_effect(EffectKind::Strength, 0, 60.0);
        assert_eq!(r.melee(1.0), 4.0);
        r.apply_effect(EffectKind::Resistance, 0, 999.0);
        assert_eq!(
            r.effect(EffectKind::Resistance),
            Some(1),
            "a weaker potion does not replace a stronger one"
        );
    }

    #[test]
    fn fire_sets_bodies_alight_until_water() {
        let mut v = Vitals::default();
        let mut s = at(64.0, true);
        s.in_fire = true;
        let out = tick(&mut v, s, 1.0);
        assert_eq!(out.damage, vec![(DamageKind::Fire, 2.0)]);
        assert!(v.burning > 7.0);
        s.in_fire = false;
        let out = tick(&mut v, s, 1.0);
        assert_eq!(
            out.damage,
            vec![(DamageKind::Fire, 1.0)],
            "still alight after stepping out"
        );
        s.feet_in_water = true;
        tick(&mut v, s, 0.1);
        assert_eq!(v.burning, 0.0, "water puts it out");
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
