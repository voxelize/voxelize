use hashbrown::HashMap;

use crate::{Face, UV};

#[derive(Default)]
pub struct TextureAtlas {
    pub groups: HashMap<String, Vec<Face>>,
}

impl TextureAtlas {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_face(&mut self, group: &str, face: Face) {
        if let Some(faces) = self.groups.get_mut(group) {
            faces.push(face);
        } else {
            self.groups.insert(group.to_string(), vec![face]);
        }
    }

    pub fn add_faces(&mut self, group: &str, faces: &[Face]) {
        if let Some(faces) = self.groups.get_mut(group) {
            faces.append(&mut faces.to_vec())
        } else {
            self.groups.insert(group.to_string(), faces.to_vec());
        }
    }

    /// Generate the UV coordinates of the blocks. Call this before the server starts!
    pub fn generate(&mut self) {
        for faces in self.groups.values_mut() {
            let mut total_faces = faces.len();

            faces.iter().for_each(|face| {
                if face.independent {
                    total_faces -= 1;
                }
            });

            if total_faces == 0 {
                continue;
            }

            let mut count_per_side = 1.0;
            let sqrt = (total_faces as f32).sqrt().ceil();
            while count_per_side < sqrt {
                count_per_side *= 2.0;
            }

            let count_per_side = count_per_side as usize;

            let mut row = 0;
            let mut col = 0;

            for face in faces.iter_mut() {
                if face.independent {
                    continue;
                }

                if col >= count_per_side {
                    col = 0;
                    row += 1;
                }

                let start_x = col as f32;
                let start_y = row as f32;

                let offset = 1.0 / (count_per_side as f32 * 4.0);

                let start_u = start_x / count_per_side as f32;
                let end_u = (start_x + 1.0) / count_per_side as f32;
                let start_v = start_y / count_per_side as f32;
                let end_v = (start_y + 1.0) / count_per_side as f32;

                // Texture bleeding fix.
                let start_u = start_u + offset;
                let end_u = end_u - offset;
                let start_v = start_v + offset;
                let end_v = end_v - offset;

                face.range = UV {
                    start_u,
                    end_u,
                    start_v,
                    end_v,
                };

                col += 1;
            }
        }
    }
}
