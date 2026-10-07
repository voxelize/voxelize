//! Items lying in the world: spawned by breaking blocks, dropping from the
//! inventory, death and broken containers; picked up by walking over them.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::inventory::Stack;

/// Seconds before a freshly dropped item can be picked up.
pub const PICKUP_DELAY: f32 = 0.5;
/// Seconds before an item disappears.
pub const DESPAWN_AFTER: f32 = 300.0;
pub const PICKUP_RADIUS: f32 = 1.6;
const GRAVITY: f32 = 20.0;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Drop {
    pub id: u64,
    pub stack: Stack,
    pub position: [f32; 3],
    #[serde(skip)]
    pub velocity: [f32; 3],
    #[serde(skip)]
    pub age: f32,
    /// A player who dropped it cannot pick it straight back up.
    #[serde(skip)]
    pub owner_delay: Option<(String, f32)>,
}

#[derive(Debug, Default)]
pub struct Drops {
    pub items: Vec<Drop>,
    next_id: u64,
    pub changed: bool,
    /// Whether the last save held any items (an empty world is saved once).
    saved_any: bool,
}

/// One item as `drops.json` keeps it: where it lies and how old it is, so
/// it still despawns on time after a restart.
#[derive(Serialize, Deserialize)]
struct SavedDrop {
    stack: Stack,
    position: [f32; 3],
    age: f32,
}

#[derive(Serialize, Deserialize)]
struct DropsFile {
    version: u32,
    items: Vec<SavedDrop>,
}

fn file(world_dir: &Path) -> PathBuf {
    world_dir.join("drops.json")
}

impl Drops {
    /// Items left lying when the server last saved (none when there is no file).
    pub fn load(world_dir: &Path) -> Result<Self, String> {
        let path = file(world_dir);
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        let parsed: DropsFile =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        if parsed.version != 1 {
            return Err(format!(
                "{}: unsupported version {}",
                path.display(),
                parsed.version
            ));
        }
        let mut drops = Self::default();
        for d in parsed.items {
            drops.spawn(d.stack, d.position, [0.0; 3], None);
            if let Some(last) = drops.items.last_mut() {
                last.age = d.age;
            }
        }
        drops.saved_any = !drops.items.is_empty();
        Ok(drops)
    }

    /// Whether a save would change what is on disk.
    pub fn worth_saving(&self) -> bool {
        !self.items.is_empty() || self.saved_any
    }

    /// Write every lying item (atomically: a crash leaves the old file).
    pub fn save(&mut self, world_dir: &Path) -> Result<(), String> {
        let path = file(world_dir);
        let items = self
            .items
            .iter()
            .map(|d| SavedDrop {
                stack: d.stack.clone(),
                position: d.position,
                age: d.age,
            })
            .collect();
        let bytes =
            serde_json::to_vec(&DropsFile { version: 1, items }).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(world_dir).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, bytes)
            .and_then(|_| std::fs::rename(&tmp, &path))
            .map_err(|e| format!("{}: {e}", path.display()))?;
        self.saved_any = !self.items.is_empty();
        Ok(())
    }

    pub fn spawn(
        &mut self,
        stack: Stack,
        position: [f32; 3],
        velocity: [f32; 3],
        owner: Option<&str>,
    ) {
        if stack.count == 0 {
            return;
        }
        self.next_id += 1;
        self.items.push(Drop {
            id: self.next_id,
            stack,
            position,
            velocity,
            age: 0.0,
            owner_delay: owner.map(|o| (o.to_owned(), 2.0)),
        });
        self.changed = true;
    }

    /// Advance physics, merge neighbours and despawn old items.
    /// `solid(x, y, z)` tells whether a voxel blocks falling.
    pub fn step(
        &mut self,
        dt: f32,
        solid: impl Fn(i32, i32, i32) -> bool,
        stackable_limit: impl Fn(u32) -> u32,
    ) {
        for d in &mut self.items {
            d.age += dt;
            if let Some((_, t)) = d.owner_delay.as_mut() {
                *t -= dt;
            }
            if d.owner_delay.as_ref().is_some_and(|(_, t)| *t <= 0.0) {
                d.owner_delay = None;
            }
            let [x, y, z] = d.position;
            let below = solid(
                x.floor() as i32,
                (y - 0.01).floor() as i32,
                z.floor() as i32,
            );
            if below && d.velocity[1] <= 0.0 {
                d.velocity = [0.0, 0.0, 0.0];
                d.position[1] = (y - 0.01).floor() + 1.0;
                continue;
            }
            d.velocity[1] -= GRAVITY * dt;
            let mut next = [
                x + d.velocity[0] * dt,
                y + d.velocity[1] * dt,
                z + d.velocity[2] * dt,
            ];
            // Stop horizontal motion into walls.
            if solid(
                next[0].floor() as i32,
                next[1].floor() as i32,
                z.floor() as i32,
            ) {
                next[0] = x;
                d.velocity[0] = 0.0;
            }
            if solid(
                next[0].floor() as i32,
                next[1].floor() as i32,
                next[2].floor() as i32,
            ) {
                next[2] = z;
                d.velocity[2] = 0.0;
            }
            if next[1] < -64.0 {
                d.age = DESPAWN_AFTER; // fell out of the world
            }
            d.position = next;
            d.velocity[0] *= 0.9;
            d.velocity[2] *= 0.9;
            self.changed = true;
        }
        let before = self.items.len();
        self.items.retain(|d| d.age < DESPAWN_AFTER);

        // Merge resting stacks of the same item that touch.
        let mut i = 0;
        while i < self.items.len() {
            let mut j = i + 1;
            while j < self.items.len() {
                let (a, b) = (&self.items[i], &self.items[j]);
                let close = (0..3).all(|k| (a.position[k] - b.position[k]).abs() < 0.8);
                let same = a.stack.item == b.stack.item
                    && a.stack.durability.is_none()
                    && b.stack.durability.is_none();
                let limit = stackable_limit(a.stack.item);
                if close && same && a.stack.count + b.stack.count <= limit {
                    let extra = self.items.remove(j).stack.count;
                    self.items[i].stack.count += extra;
                    self.changed = true;
                } else {
                    j += 1;
                }
            }
            i += 1;
        }
        if self.items.len() != before {
            self.changed = true;
        }
    }

    /// Items `player` at `feet` may pick up now.
    pub fn in_reach(&self, player: &str, feet: [f32; 3]) -> Vec<u64> {
        self.items
            .iter()
            .filter(|d| d.age >= PICKUP_DELAY)
            .filter(|d| d.owner_delay.as_ref().is_none_or(|(o, _)| o != player))
            .filter(|d| {
                let dx = d.position[0] - feet[0];
                let dz = d.position[2] - feet[2];
                let dy = d.position[1] - feet[1];
                dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS && (-0.5..=2.0).contains(&dy)
            })
            .map(|d| d.id)
            .collect()
    }

    pub fn get_mut(&mut self, id: u64) -> Option<&mut Drop> {
        self.items.iter_mut().find(|d| d.id == id)
    }

    pub fn remove(&mut self, id: u64) {
        self.items.retain(|d| d.id != id);
        self.changed = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(item: u32, count: u32) -> Stack {
        Stack {
            item,
            count,
            durability: None,
        }
    }

    fn ground(_: i32, y: i32, _: i32) -> bool {
        y < 64
    }

    #[test]
    fn items_fall_to_the_ground_and_rest() {
        let mut d = Drops::default();
        d.spawn(st(1, 1), [0.5, 70.0, 0.5], [0.0, 0.0, 0.0], None);
        for _ in 0..200 {
            d.step(0.05, ground, |_| 64);
        }
        assert!(
            (d.items[0].position[1] - 64.0).abs() < 0.01,
            "{:?}",
            d.items[0].position
        );
    }

    #[test]
    fn pickup_waits_for_the_delay_and_the_dropper() {
        let mut d = Drops::default();
        d.spawn(st(1, 1), [0.5, 64.0, 0.5], [0.0; 3], Some("alice"));
        assert!(
            d.in_reach("bob", [0.5, 64.0, 0.5]).is_empty(),
            "pickup delay"
        );
        d.step(0.6, ground, |_| 64);
        assert_eq!(d.in_reach("bob", [0.5, 64.0, 0.5]).len(), 1);
        assert!(
            d.in_reach("alice", [0.5, 64.0, 0.5]).is_empty(),
            "dropper waits longer"
        );
        assert!(d.in_reach("bob", [5.5, 64.0, 0.5]).is_empty(), "too far");
    }

    #[test]
    fn neighbouring_stacks_merge_and_old_items_despawn() {
        let mut d = Drops::default();
        d.spawn(st(3, 10), [0.5, 64.0, 0.5], [0.0; 3], None);
        d.spawn(st(3, 5), [0.7, 64.0, 0.6], [0.0; 3], None);
        d.spawn(st(4, 1), [0.7, 64.0, 0.6], [0.0; 3], None);
        d.step(0.05, ground, |_| 64);
        assert_eq!(d.items.len(), 2);
        assert_eq!(d.items[0].stack.count, 15);
        d.step(DESPAWN_AFTER, ground, |_| 64);
        assert!(d.items.is_empty());
    }

    #[test]
    fn lying_items_survive_a_restart_and_still_despawn_on_time() {
        let dir = std::env::temp_dir().join(format!("drops-save-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut drops = Drops::default();
        assert!(!drops.worth_saving(), "nothing to save yet");
        drops.spawn(
            Stack {
                item: 7,
                count: 3,
                durability: None,
            },
            [1.5, 64.0, 2.5],
            [0.0; 3],
            Some("pl_1"),
        );
        drops.items[0].age = 120.0;
        drops.save(&dir).unwrap();
        let loaded = Drops::load(&dir).unwrap();
        assert_eq!(loaded.items.len(), 1);
        assert_eq!(loaded.items[0].stack.count, 3);
        assert_eq!(loaded.items[0].position, [1.5, 64.0, 2.5]);
        assert_eq!(loaded.items[0].age, 120.0, "the clock keeps running");
        assert!(loaded.items[0].owner_delay.is_none());
        // Once picked up, the empty world is saved once more.
        let mut loaded = loaded;
        loaded.items.clear();
        assert!(loaded.worth_saving());
        loaded.save(&dir).unwrap();
        assert!(!loaded.worth_saving());
        assert!(Drops::load(&dir).unwrap().items.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
