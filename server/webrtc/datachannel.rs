use hashbrown::{hash_map::Entry, HashMap};

const MAX_FRAGMENT_SIZE: usize = 16000;
const FRAGMENT_HEADER_SIZE: usize = 9;
const MAX_PAYLOAD_SIZE: usize = MAX_FRAGMENT_SIZE - FRAGMENT_HEADER_SIZE;
const MAX_FRAGMENT_COUNT: usize = 4096;
const MAX_PENDING_MESSAGES: usize = 64;
const FRAGMENT_MARKER: u8 = 0xFF;
const LEGACY_FRAGMENT_MARKER: u8 = 0x01;

struct FragmentState {
    parts: Vec<Option<Vec<u8>>>,
    received: usize,
    total: usize,
    total_payload_bytes: usize,
}

impl FragmentState {
    fn new(total: usize) -> Self {
        Self {
            parts: vec![None; total],
            received: 0,
            total,
            total_payload_bytes: 0,
        }
    }
}

pub fn fragment_message(data: &[u8]) -> Vec<Vec<u8>> {
    if data.is_empty() {
        let mut fragment = Vec::with_capacity(FRAGMENT_HEADER_SIZE);
        fragment.push(FRAGMENT_MARKER);
        fragment.extend_from_slice(&(1u32).to_le_bytes());
        fragment.extend_from_slice(&(0u32).to_le_bytes());
        return vec![fragment];
    }
    if data.len() <= MAX_PAYLOAD_SIZE {
        let marker = data[0];
        if marker != FRAGMENT_MARKER && marker != LEGACY_FRAGMENT_MARKER {
            return vec![data.to_vec()];
        }
    }

    let total_fragments = data.len().div_ceil(MAX_PAYLOAD_SIZE);
    let total_fragments_u32 = total_fragments as u32;
    let total_fragments_bytes = total_fragments_u32.to_le_bytes();
    let mut fragment_index_u32 = 0u32;
    let mut fragments = Vec::with_capacity(total_fragments);

    for chunk in data.chunks(MAX_PAYLOAD_SIZE) {
        let mut fragment = Vec::with_capacity(FRAGMENT_HEADER_SIZE + chunk.len());

        fragment.push(FRAGMENT_MARKER);

        fragment.extend_from_slice(&total_fragments_bytes);
        fragment.extend_from_slice(&fragment_index_u32.to_le_bytes());

        fragment.extend_from_slice(chunk);

        fragments.push(fragment);
        fragment_index_u32 = fragment_index_u32.saturating_add(1);
    }

    fragments
}

#[inline]
fn parse_fragment_header(data: &[u8]) -> Option<(usize, usize, &[u8])> {
    if data.len() < FRAGMENT_HEADER_SIZE {
        return None;
    }
    let total = u32::from_le_bytes([data[1], data[2], data[3], data[4]]) as usize;
    let index = u32::from_le_bytes([data[5], data[6], data[7], data[8]]) as usize;
    if total == 0 || total > MAX_FRAGMENT_COUNT || index >= total {
        return None;
    }
    Some((total, index, &data[FRAGMENT_HEADER_SIZE..]))
}

pub struct FragmentAssembler {
    fragments: HashMap<usize, FragmentState>,
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
            next_message_id: 0,
        }
    }

    pub fn process(&mut self, data: &[u8]) -> Option<Vec<u8>> {
        if data.is_empty() {
            return None;
        }
        let marker = data[0];
        let (total, index, payload, is_legacy_marker) = if marker == FRAGMENT_MARKER {
            let (total, index, payload) = parse_fragment_header(data)?;
            (total, index, payload, false)
        } else if marker == LEGACY_FRAGMENT_MARKER {
            let Some((total, index, payload)) = parse_fragment_header(data) else {
                return Some(data.to_vec());
            };
            (total, index, payload, true)
        } else {
            return Some(data.to_vec());
        };
        if total == 1 {
            if index == 0 {
                if is_legacy_marker {
                    return Some(data.to_vec());
                }
                return Some(payload.to_vec());
            }
            return None;
        }

        let message_id = if index == 0 {
            if self.fragments.len() >= MAX_PENDING_MESSAGES {
                self.fragments.clear();
                self.next_message_id = 0;
            }
            if self.next_message_id == usize::MAX {
                self.fragments.clear();
                self.next_message_id = 0;
            }
            let id = self.next_message_id;
            self.next_message_id += 1;
            id
        } else {
            let Some(id) = self.next_message_id.checked_sub(1) else {
                return None;
            };
            id
        };

        let is_complete = {
            let state = match self.fragments.entry(message_id) {
                Entry::Occupied(entry) => entry.into_mut(),
                Entry::Vacant(entry) => {
                    if index != 0 {
                        return None;
                    }
                    entry.insert(FragmentState::new(total))
                }
            };

            if state.total != total || index >= state.total {
                return None;
            }

            let payload_len = payload.len();
            match state.parts[index].as_ref() {
                Some(existing) => {
                    if payload_len > existing.len() {
                        state.total_payload_bytes = state
                            .total_payload_bytes
                            .saturating_add(payload_len - existing.len());
                    } else {
                        state.total_payload_bytes = state
                            .total_payload_bytes
                            .saturating_sub(existing.len() - payload_len);
                    }
                }
                None => {
                    state.received = state.received.saturating_add(1);
                    state.total_payload_bytes =
                        state.total_payload_bytes.saturating_add(payload_len);
                }
            }
            state.parts[index] = Some(payload.to_vec());
            state.received == state.total
        };

        if is_complete {
            let state = self.fragments.remove(&message_id)?;
            let mut complete = Vec::with_capacity(state.total_payload_bytes);
            for fragment in state.parts {
                let Some(fragment) = fragment else {
                    unreachable!("complete fragment count matched branch");
                };
                complete.extend_from_slice(&fragment);
            }

            return Some(complete);
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::{
        fragment_message, FragmentAssembler, FragmentState, FRAGMENT_MARKER, LEGACY_FRAGMENT_MARKER,
        FRAGMENT_HEADER_SIZE, MAX_FRAGMENT_COUNT,
    };

    #[test]
    fn process_accepts_single_fragment_header_without_buffering() {
        let payload = vec![7, 8, 9];
        let mut framed = vec![FRAGMENT_MARKER];
        framed.extend_from_slice(&(1u32).to_le_bytes());
        framed.extend_from_slice(&(0u32).to_le_bytes());
        framed.extend_from_slice(&payload);

        let mut assembler = FragmentAssembler::new();
        assert_eq!(assembler.process(&framed), Some(payload));
    }

    #[test]
    fn fragment_message_returns_raw_payload_for_small_non_marker_messages() {
        let payload = vec![9u8, 8, 7, 6];
        let fragments = fragment_message(&payload);
        assert_eq!(fragments, vec![payload]);
    }

    #[test]
    fn fragment_message_frames_small_payload_when_marker_collides() {
        let payload = vec![FRAGMENT_MARKER, 8, 7, 6];
        let fragments = fragment_message(&payload);
        assert_eq!(fragments.len(), 1);
        let fragment = &fragments[0];
        assert_eq!(fragment[0], FRAGMENT_MARKER);
        assert_eq!(u32::from_le_bytes([fragment[1], fragment[2], fragment[3], fragment[4]]), 1);
        assert_eq!(u32::from_le_bytes([fragment[5], fragment[6], fragment[7], fragment[8]]), 0);
        assert_eq!(&fragment[FRAGMENT_HEADER_SIZE..], payload.as_slice());
    }

    #[test]
    fn process_reassembles_fragmented_messages() {
        let payload = vec![42u8; 20_000];
        let fragments = fragment_message(&payload);
        assert!(fragments.len() > 1);

        let mut assembler = FragmentAssembler::new();
        let mut reconstructed = None;
        for fragment in fragments {
            reconstructed = assembler.process(&fragment);
        }

        assert_eq!(reconstructed, Some(payload));
    }

    #[test]
    fn process_reassembles_with_duplicate_fragment_replacement() {
        let mut assembler = FragmentAssembler::new();

        let mut first_fragment = vec![FRAGMENT_MARKER];
        first_fragment.extend_from_slice(&(2u32).to_le_bytes());
        first_fragment.extend_from_slice(&(0u32).to_le_bytes());
        first_fragment.extend_from_slice(b"AA");
        assert_eq!(assembler.process(&first_fragment), None);

        let mut duplicate_fragment = vec![FRAGMENT_MARKER];
        duplicate_fragment.extend_from_slice(&(2u32).to_le_bytes());
        duplicate_fragment.extend_from_slice(&(0u32).to_le_bytes());
        duplicate_fragment.extend_from_slice(b"BBB");
        assert_eq!(assembler.process(&duplicate_fragment), None);

        let mut second_fragment = vec![FRAGMENT_MARKER];
        second_fragment.extend_from_slice(&(2u32).to_le_bytes());
        second_fragment.extend_from_slice(&(1u32).to_le_bytes());
        second_fragment.extend_from_slice(b"CC");

        assert_eq!(assembler.process(&second_fragment), Some(b"BBBCC".to_vec()));
    }

    #[test]
    fn process_ignores_non_initial_fragment_without_tracking_state() {
        let payload = vec![7u8, 8, 9];
        let mut framed = vec![1];
        framed.extend_from_slice(&(2u32).to_le_bytes());
        framed.extend_from_slice(&(1u32).to_le_bytes());
        framed.extend_from_slice(&payload);

        let mut assembler = FragmentAssembler::new();
        assert_eq!(assembler.process(&framed), None);
    }

    #[test]
    fn process_resets_pending_state_when_too_many_messages_accumulate() {
        let mut assembler = FragmentAssembler::new();
        for marker in 0u8..=64u8 {
            let mut framed = vec![FRAGMENT_MARKER];
            framed.extend_from_slice(&(2u32).to_le_bytes());
            framed.extend_from_slice(&(0u32).to_le_bytes());
            framed.push(marker);
            assert_eq!(assembler.process(&framed), None);
        }

        assert_eq!(assembler.fragments.len(), 1);
        assert_eq!(assembler.next_message_id, 1);
    }

    #[test]
    fn process_resets_pending_state_when_message_id_overflows() {
        let mut assembler = FragmentAssembler::new();
        assembler.fragments.insert(77, FragmentState::new(2));
        assembler.next_message_id = usize::MAX;

        let mut framed = vec![FRAGMENT_MARKER];
        framed.extend_from_slice(&(2u32).to_le_bytes());
        framed.extend_from_slice(&(0u32).to_le_bytes());
        framed.push(1);

        assert_eq!(assembler.process(&framed), None);
        assert_eq!(assembler.fragments.len(), 1);
        assert!(assembler.fragments.contains_key(&0));
        assert_eq!(assembler.next_message_id, 1);
    }

    #[test]
    fn process_treats_legacy_marker_with_invalid_header_as_raw_message() {
        let payload = vec![LEGACY_FRAGMENT_MARKER, 9, 8, 7, 6];
        let mut assembler = FragmentAssembler::new();
        assert_eq!(assembler.process(&payload), Some(payload));
    }

    #[test]
    fn process_rejects_fragment_headers_with_excessive_total() {
        let mut framed = vec![FRAGMENT_MARKER];
        framed.extend_from_slice(&((MAX_FRAGMENT_COUNT as u32) + 1).to_le_bytes());
        framed.extend_from_slice(&(0u32).to_le_bytes());
        framed.extend_from_slice(&[1u8, 2u8, 3u8]);

        let mut assembler = FragmentAssembler::new();
        assert_eq!(assembler.process(&framed), None);
    }

    #[test]
    fn process_treats_legacy_marker_with_excessive_total_as_raw_message() {
        let mut framed = vec![LEGACY_FRAGMENT_MARKER];
        framed.extend_from_slice(&((MAX_FRAGMENT_COUNT as u32) + 1).to_le_bytes());
        framed.extend_from_slice(&(0u32).to_le_bytes());
        framed.extend_from_slice(&[1u8, 2u8, 3u8]);

        let mut assembler = FragmentAssembler::new();
        assert_eq!(assembler.process(&framed), Some(framed));
    }
}
