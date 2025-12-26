use std::collections::HashMap;

const MAX_FRAGMENT_SIZE: usize = 16000;
const FRAGMENT_HEADER_SIZE: usize = 9;
const MAX_PAYLOAD_SIZE: usize = MAX_FRAGMENT_SIZE - FRAGMENT_HEADER_SIZE;

pub fn fragment_message(data: &[u8]) -> Vec<Vec<u8>> {
    if data.len() <= MAX_PAYLOAD_SIZE {
        return vec![data.to_vec()];
    }

    let total_fragments = (data.len() + MAX_PAYLOAD_SIZE - 1) / MAX_PAYLOAD_SIZE;
    let mut fragments = Vec::with_capacity(total_fragments);

    for (i, chunk) in data.chunks(MAX_PAYLOAD_SIZE).enumerate() {
        let mut fragment = Vec::with_capacity(FRAGMENT_HEADER_SIZE + chunk.len());

        fragment.push(1);

        fragment.extend_from_slice(&(total_fragments as u32).to_le_bytes());

        fragment.extend_from_slice(&(i as u32).to_le_bytes());

        fragment.extend_from_slice(chunk);

        fragments.push(fragment);
    }

    fragments
}

pub struct FragmentAssembler {
    fragments: HashMap<usize, HashMap<usize, Vec<u8>>>,
    expected_counts: HashMap<usize, usize>,
    next_message_id: usize,
}

impl Default for FragmentAssembler {
    fn default() -> Self {
        Self::new()
    }
}

impl FragmentAssembler {
    pub fn new() -> Self {
        Self {
            fragments: HashMap::new(),
            expected_counts: HashMap::new(),
            next_message_id: 0,
        }
    }

    pub fn process(&mut self, data: &[u8]) -> Option<Vec<u8>> {
        if data.is_empty() {
            return None;
        }

        let is_fragment = data[0] == 1;

        if !is_fragment {
            return Some(data.to_vec());
        }

        if data.len() < FRAGMENT_HEADER_SIZE {
            return None;
        }

        let total = u32::from_le_bytes([data[1], data[2], data[3], data[4]]) as usize;
        let index = u32::from_le_bytes([data[5], data[6], data[7], data[8]]) as usize;
        let payload = &data[FRAGMENT_HEADER_SIZE..];

        let message_id = if index == 0 {
            let id = self.next_message_id;
            self.next_message_id += 1;
            self.expected_counts.insert(id, total);
            id
        } else {
            self.next_message_id.saturating_sub(1)
        };

        let entry = self.fragments.entry(message_id).or_insert_with(HashMap::new);
        entry.insert(index, payload.to_vec());

        if let Some(&expected) = self.expected_counts.get(&message_id) {
            if entry.len() == expected {
                let mut complete = Vec::new();
                for i in 0..expected {
                    if let Some(fragment) = entry.get(&i) {
                        complete.extend_from_slice(fragment);
                    } else {
                        return None;
                    }
                }

                self.fragments.remove(&message_id);
                self.expected_counts.remove(&message_id);

                return Some(complete);
            }
        }

        None
    }
}
