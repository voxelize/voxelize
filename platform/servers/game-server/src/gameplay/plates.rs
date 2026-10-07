//! Pressure plates: pressed while a player or creature stands in their cell.

use std::collections::HashSet;

use platform_content::{BlockBehavior, Content};
use voxelize::{BlockUtils, Chunks, PositionComp, Vec3, VoxelAccess};

use super::survival::EYE_HEIGHT;
use super::Gameplay;

/// The cell a body whose feet are at `feet` stands in.
fn cell(feet: [f32; 3]) -> [i32; 3] {
    [
        feet[0].floor() as i32,
        (feet[1] + 0.1).floor() as i32,
        feet[2].floor() as i32,
    ]
}

fn plate_ids(content: &Content) -> HashSet<u32> {
    content
        .blocks()
        .iter()
        .filter(|b| b.behaviors.contains(&BlockBehavior::Plate))
        .map(|b| b.id)
        .collect()
}

/// Writes that press plates newly stood on and release plates left, given
/// the plates pressed last tick and the cells bodies occupy now. Returns
/// the writes and the plates pressed now.
pub fn plate_writes(
    plates: &HashSet<u32>,
    pressed: &HashSet<[i32; 3]>,
    occupied: impl IntoIterator<Item = [i32; 3]>,
    raw_at: impl Fn([i32; 3]) -> u32,
) -> (Vec<([i32; 3], u32)>, HashSet<[i32; 3]>) {
    let now: HashSet<[i32; 3]> = occupied
        .into_iter()
        .filter(|c| plates.contains(&BlockUtils::extract_id(raw_at(*c))))
        .collect();
    let mut writes = Vec::new();
    for c in now.iter().chain(pressed.iter()) {
        let raw = raw_at(*c);
        if !plates.contains(&BlockUtils::extract_id(raw)) {
            continue;
        }
        let want = u32::from(now.contains(c));
        if BlockUtils::extract_stage(raw) != want && !writes.iter().any(|(w, _)| w == c) {
            writes.push((*c, BlockUtils::insert_stage(raw, want)));
        }
    }
    (writes, now)
}

#[derive(Default)]
pub struct PlateSystem {
    plates: Option<HashSet<u32>>,
    pressed: HashSet<[i32; 3]>,
}

impl<'a> specs::System<'a> for PlateSystem {
    type SystemData = (
        specs::WriteExpect<'a, Chunks>,
        specs::ReadExpect<'a, voxelize::Clients>,
        specs::ReadStorage<'a, PositionComp>,
        specs::ReadExpect<'a, Gameplay>,
    );

    fn run(&mut self, (mut chunks, clients, positions, g): Self::SystemData) {
        let plates = self
            .plates
            .get_or_insert_with(|| plate_ids(g.rules.content()));
        if plates.is_empty() {
            return;
        }
        let players = clients.values().filter_map(|c| {
            let p = positions.get(c.entity)?;
            Some(cell([p.0 .0, p.0 .1 - EYE_HEIGHT, p.0 .2]))
        });
        let mobs = g.mobs.list.iter().map(|m| cell(m.position));
        let occupied: Vec<[i32; 3]> = players.chain(mobs).collect();
        let (writes, now) = plate_writes(plates, &self.pressed, occupied, |[x, y, z]| {
            chunks.get_raw_voxel(x, y, z)
        });
        for ([x, y, z], raw) in writes {
            chunks.update_voxel(&Vec3(x, y, z), raw);
        }
        self.pressed = now;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn plates_press_under_bodies_and_release_when_left() {
        let content = Content::load(platform_content::default_pack_dir()).unwrap();
        let plates = plate_ids(&content);
        let plate = content.block("pressure_plate").unwrap().id;
        let mut world: HashMap<[i32; 3], u32> = HashMap::new();
        world.insert([0, 64, 0], plate);
        world.insert([3, 64, 0], content.block("stone").unwrap().id);
        let raw = |w: &HashMap<[i32; 3], u32>| {
            let w = w.clone();
            move |c: [i32; 3]| *w.get(&c).unwrap_or(&0)
        };

        let feet = cell([0.5, 64.0, 0.5]);
        let (writes, pressed) =
            plate_writes(&plates, &HashSet::new(), [feet, [3, 64, 0]], raw(&world));
        assert_eq!(
            writes,
            vec![([0, 64, 0], BlockUtils::insert_stage(plate, 1))]
        );
        assert_eq!(pressed.len(), 1, "stone is no plate");
        world.insert([0, 64, 0], writes[0].1);

        // Still standing: nothing to write.
        let (writes, pressed) = plate_writes(&plates, &pressed, [feet], raw(&world));
        assert!(writes.is_empty());

        // Stepped off: released.
        let (writes, pressed) = plate_writes(&plates, &pressed, [], raw(&world));
        assert_eq!(writes, vec![([0, 64, 0], plate)]);
        assert!(pressed.is_empty());
    }
}
