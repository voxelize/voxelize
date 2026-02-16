use std::sync::Arc;

use bytes::Bytes;
use crossbeam_channel::{Receiver, Sender};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{common::ClientFilter, encode_message, server::Message, EntityOperation, MessageType};
const SYNC_ENCODE_BATCH_LIMIT: usize = 9;
const MESSAGE_TYPE_PEER: i32 = MessageType::Peer as i32;
const MESSAGE_TYPE_ENTITY: i32 = MessageType::Entity as i32;
const MESSAGE_TYPE_EVENT: i32 = MessageType::Event as i32;
const MESSAGE_TYPE_CHAT: i32 = MessageType::Chat as i32;
const MESSAGE_TYPE_JOIN: i32 = MessageType::Join as i32;
const MESSAGE_TYPE_LEAVE: i32 = MessageType::Leave as i32;
const MESSAGE_TYPE_LOAD: i32 = MessageType::Load as i32;
const MESSAGE_TYPE_UNLOAD: i32 = MessageType::Unload as i32;
const ENTITY_OPERATION_UPDATE: i32 = EntityOperation::Update as i32;

#[inline]
fn reserve_for_append<T>(buffer: &mut Vec<T>, additional: usize) {
    let remaining_capacity = buffer.capacity() - buffer.len();
    if remaining_capacity < additional {
        buffer.reserve(additional - remaining_capacity);
    }
}

#[inline]
fn take_vec_with_capacity<T>(buffer: &mut Vec<T>) -> Vec<T> {
    let capacity = buffer.capacity();
    std::mem::replace(buffer, Vec::with_capacity(capacity))
}

#[derive(Clone)]
pub struct EncodedMessage {
    pub data: Bytes,
    pub is_rtc_eligible: bool,
    pub is_transport_eligible: bool,
}

pub struct MessageQueues {
    critical: Vec<(Message, ClientFilter)>,
    normal: Vec<(Message, ClientFilter)>,
    bulk: Vec<(Message, ClientFilter)>,
}

impl MessageQueues {
    pub fn new() -> Self {
        Self {
            critical: Vec::new(),
            normal: Vec::new(),
            bulk: Vec::new(),
        }
    }

    pub fn queue_stats(&self) -> (usize, usize, usize) {
        (self.critical.len(), self.normal.len(), self.bulk.len())
    }

    pub fn push(&mut self, item: (Message, ClientFilter)) {
        let (message, filter) = item;
        match message.r#type {
            MESSAGE_TYPE_PEER
            | MESSAGE_TYPE_ENTITY
            | MESSAGE_TYPE_EVENT
            | MESSAGE_TYPE_CHAT
            | MESSAGE_TYPE_JOIN
            | MESSAGE_TYPE_LEAVE => self.critical.push((message, filter)),
            MESSAGE_TYPE_LOAD | MESSAGE_TYPE_UNLOAD => self.bulk.push((message, filter)),
            _ => self.normal.push((message, filter)),
        }
    }

    pub fn drain_prioritized(&mut self) -> Vec<(Message, ClientFilter)> {
        if self.critical.is_empty() && self.normal.is_empty() && self.bulk.is_empty() {
            return Vec::new();
        }
        if self.normal.is_empty() {
            if self.bulk.is_empty() {
                return take_vec_with_capacity(&mut self.critical);
            }
            if self.critical.is_empty() {
                return take_vec_with_capacity(&mut self.bulk);
            }
            let mut result = take_vec_with_capacity(&mut self.critical);
            reserve_for_append(&mut result, self.bulk.len());
            result.append(&mut self.bulk);
            return result;
        }
        if self.bulk.is_empty() {
            if self.critical.is_empty() {
                return take_vec_with_capacity(&mut self.normal);
            }
            let mut result = take_vec_with_capacity(&mut self.critical);
            reserve_for_append(&mut result, self.normal.len());
            result.append(&mut self.normal);
            return result;
        }
        if self.critical.is_empty() {
            let mut result = take_vec_with_capacity(&mut self.normal);
            reserve_for_append(&mut result, self.bulk.len());
            result.append(&mut self.bulk);
            return result;
        }
        let mut result = take_vec_with_capacity(&mut self.critical);
        reserve_for_append(&mut result, self.normal.len().saturating_add(self.bulk.len()));
        result.append(&mut self.normal);
        result.append(&mut self.bulk);
        result
    }
}

pub struct EncodedMessageQueue {
    pub pending: Vec<(Message, ClientFilter)>,
    pub processed: Vec<(EncodedMessage, ClientFilter)>,
    sender: Arc<Sender<Vec<(EncodedMessage, ClientFilter)>>>,
    receiver: Arc<Receiver<Vec<(EncodedMessage, ClientFilter)>>>,
}

impl EncodedMessageQueue {
    pub fn new() -> Self {
        let (sender, receiver) = crossbeam_channel::unbounded();
        Self {
            pending: vec![],
            processed: vec![],
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
        }
    }

    pub fn queue_stats(&self) -> (usize, usize) {
        (self.pending.len(), self.processed.len())
    }

    pub fn append(&mut self, mut list: Vec<(Message, ClientFilter)>) {
        if list.is_empty() {
            return;
        }
        if self.pending.is_empty() {
            if self.pending.capacity() >= list.len() {
                self.pending.append(&mut list);
                return;
            }
            self.pending = list;
            return;
        }
        reserve_for_append(&mut self.pending, list.len());
        self.pending.append(&mut list);
    }

    pub fn process(&mut self) {
        if self.pending.is_empty() {
            return;
        }
        let pending_len = self.pending.len();
        if pending_len == 1 {
            reserve_for_append(&mut self.processed, 1);
            let (message, filter) = {
                let Some(single_pending) = self.pending.pop() else {
                    unreachable!("single pending message length matched branch");
                };
                single_pending
            };
            self.processed
                .push(Self::encode_pending_message(message, filter));
            return;
        }
        if pending_len == 2 {
            reserve_for_append(&mut self.processed, 2);
            let (second_message, second_filter) = {
                let Some(second_pending) = self.pending.pop() else {
                    unreachable!("double pending message length matched branch");
                };
                second_pending
            };
            let (first_message, first_filter) = {
                let Some(first_pending) = self.pending.pop() else {
                    unreachable!("double pending message length matched branch");
                };
                first_pending
            };
            self.processed
                .push(Self::encode_pending_message(first_message, first_filter));
            self.processed
                .push(Self::encode_pending_message(second_message, second_filter));
            return;
        }
        if pending_len == 3 {
            reserve_for_append(&mut self.processed, 3);
            let (third_message, third_filter) = {
                let Some(third_pending) = self.pending.pop() else {
                    unreachable!("triple pending message length matched branch");
                };
                third_pending
            };
            let (second_message, second_filter) = {
                let Some(second_pending) = self.pending.pop() else {
                    unreachable!("triple pending message length matched branch");
                };
                second_pending
            };
            let (first_message, first_filter) = {
                let Some(first_pending) = self.pending.pop() else {
                    unreachable!("triple pending message length matched branch");
                };
                first_pending
            };
            self.processed
                .push(Self::encode_pending_message(first_message, first_filter));
            self.processed
                .push(Self::encode_pending_message(second_message, second_filter));
            self.processed
                .push(Self::encode_pending_message(third_message, third_filter));
            return;
        }
        if pending_len == 4 {
            reserve_for_append(&mut self.processed, 4);
            let (fourth_message, fourth_filter) = {
                let Some(fourth_pending) = self.pending.pop() else {
                    unreachable!("quadruple pending message length matched branch");
                };
                fourth_pending
            };
            let (third_message, third_filter) = {
                let Some(third_pending) = self.pending.pop() else {
                    unreachable!("quadruple pending message length matched branch");
                };
                third_pending
            };
            let (second_message, second_filter) = {
                let Some(second_pending) = self.pending.pop() else {
                    unreachable!("quadruple pending message length matched branch");
                };
                second_pending
            };
            let (first_message, first_filter) = {
                let Some(first_pending) = self.pending.pop() else {
                    unreachable!("quadruple pending message length matched branch");
                };
                first_pending
            };
            self.processed
                .push(Self::encode_pending_message(first_message, first_filter));
            self.processed
                .push(Self::encode_pending_message(second_message, second_filter));
            self.processed
                .push(Self::encode_pending_message(third_message, third_filter));
            self.processed
                .push(Self::encode_pending_message(fourth_message, fourth_filter));
            return;
        }
        if pending_len == 5 {
            reserve_for_append(&mut self.processed, 5);
            let (fifth_message, fifth_filter) = {
                let Some(fifth_pending) = self.pending.pop() else {
                    unreachable!("quintuple pending message length matched branch");
                };
                fifth_pending
            };
            let (fourth_message, fourth_filter) = {
                let Some(fourth_pending) = self.pending.pop() else {
                    unreachable!("quintuple pending message length matched branch");
                };
                fourth_pending
            };
            let (third_message, third_filter) = {
                let Some(third_pending) = self.pending.pop() else {
                    unreachable!("quintuple pending message length matched branch");
                };
                third_pending
            };
            let (second_message, second_filter) = {
                let Some(second_pending) = self.pending.pop() else {
                    unreachable!("quintuple pending message length matched branch");
                };
                second_pending
            };
            let (first_message, first_filter) = {
                let Some(first_pending) = self.pending.pop() else {
                    unreachable!("quintuple pending message length matched branch");
                };
                first_pending
            };
            self.processed
                .push(Self::encode_pending_message(first_message, first_filter));
            self.processed
                .push(Self::encode_pending_message(second_message, second_filter));
            self.processed
                .push(Self::encode_pending_message(third_message, third_filter));
            self.processed
                .push(Self::encode_pending_message(fourth_message, fourth_filter));
            self.processed
                .push(Self::encode_pending_message(fifth_message, fifth_filter));
            return;
        }
        if pending_len == 6 {
            reserve_for_append(&mut self.processed, 6);
            let (sixth_message, sixth_filter) = {
                let Some(sixth_pending) = self.pending.pop() else {
                    unreachable!("sextuple pending message length matched branch");
                };
                sixth_pending
            };
            let (fifth_message, fifth_filter) = {
                let Some(fifth_pending) = self.pending.pop() else {
                    unreachable!("sextuple pending message length matched branch");
                };
                fifth_pending
            };
            let (fourth_message, fourth_filter) = {
                let Some(fourth_pending) = self.pending.pop() else {
                    unreachable!("sextuple pending message length matched branch");
                };
                fourth_pending
            };
            let (third_message, third_filter) = {
                let Some(third_pending) = self.pending.pop() else {
                    unreachable!("sextuple pending message length matched branch");
                };
                third_pending
            };
            let (second_message, second_filter) = {
                let Some(second_pending) = self.pending.pop() else {
                    unreachable!("sextuple pending message length matched branch");
                };
                second_pending
            };
            let (first_message, first_filter) = {
                let Some(first_pending) = self.pending.pop() else {
                    unreachable!("sextuple pending message length matched branch");
                };
                first_pending
            };
            self.processed
                .push(Self::encode_pending_message(first_message, first_filter));
            self.processed
                .push(Self::encode_pending_message(second_message, second_filter));
            self.processed
                .push(Self::encode_pending_message(third_message, third_filter));
            self.processed
                .push(Self::encode_pending_message(fourth_message, fourth_filter));
            self.processed
                .push(Self::encode_pending_message(fifth_message, fifth_filter));
            self.processed
                .push(Self::encode_pending_message(sixth_message, sixth_filter));
            return;
        }
        if pending_len == 7 {
            reserve_for_append(&mut self.processed, 7);
            let (seventh_message, seventh_filter) = {
                let Some(seventh_pending) = self.pending.pop() else {
                    unreachable!("septuple pending message length matched branch");
                };
                seventh_pending
            };
            let (sixth_message, sixth_filter) = {
                let Some(sixth_pending) = self.pending.pop() else {
                    unreachable!("septuple pending message length matched branch");
                };
                sixth_pending
            };
            let (fifth_message, fifth_filter) = {
                let Some(fifth_pending) = self.pending.pop() else {
                    unreachable!("septuple pending message length matched branch");
                };
                fifth_pending
            };
            let (fourth_message, fourth_filter) = {
                let Some(fourth_pending) = self.pending.pop() else {
                    unreachable!("septuple pending message length matched branch");
                };
                fourth_pending
            };
            let (third_message, third_filter) = {
                let Some(third_pending) = self.pending.pop() else {
                    unreachable!("septuple pending message length matched branch");
                };
                third_pending
            };
            let (second_message, second_filter) = {
                let Some(second_pending) = self.pending.pop() else {
                    unreachable!("septuple pending message length matched branch");
                };
                second_pending
            };
            let (first_message, first_filter) = {
                let Some(first_pending) = self.pending.pop() else {
                    unreachable!("septuple pending message length matched branch");
                };
                first_pending
            };
            self.processed
                .push(Self::encode_pending_message(first_message, first_filter));
            self.processed
                .push(Self::encode_pending_message(second_message, second_filter));
            self.processed
                .push(Self::encode_pending_message(third_message, third_filter));
            self.processed
                .push(Self::encode_pending_message(fourth_message, fourth_filter));
            self.processed
                .push(Self::encode_pending_message(fifth_message, fifth_filter));
            self.processed
                .push(Self::encode_pending_message(sixth_message, sixth_filter));
            self.processed
                .push(Self::encode_pending_message(seventh_message, seventh_filter));
            return;
        }
        if pending_len == 8 {
            reserve_for_append(&mut self.processed, 8);
            let (eighth_message, eighth_filter) = {
                let Some(eighth_pending) = self.pending.pop() else {
                    unreachable!("octuple pending message length matched branch");
                };
                eighth_pending
            };
            let (seventh_message, seventh_filter) = {
                let Some(seventh_pending) = self.pending.pop() else {
                    unreachable!("octuple pending message length matched branch");
                };
                seventh_pending
            };
            let (sixth_message, sixth_filter) = {
                let Some(sixth_pending) = self.pending.pop() else {
                    unreachable!("octuple pending message length matched branch");
                };
                sixth_pending
            };
            let (fifth_message, fifth_filter) = {
                let Some(fifth_pending) = self.pending.pop() else {
                    unreachable!("octuple pending message length matched branch");
                };
                fifth_pending
            };
            let (fourth_message, fourth_filter) = {
                let Some(fourth_pending) = self.pending.pop() else {
                    unreachable!("octuple pending message length matched branch");
                };
                fourth_pending
            };
            let (third_message, third_filter) = {
                let Some(third_pending) = self.pending.pop() else {
                    unreachable!("octuple pending message length matched branch");
                };
                third_pending
            };
            let (second_message, second_filter) = {
                let Some(second_pending) = self.pending.pop() else {
                    unreachable!("octuple pending message length matched branch");
                };
                second_pending
            };
            let (first_message, first_filter) = {
                let Some(first_pending) = self.pending.pop() else {
                    unreachable!("octuple pending message length matched branch");
                };
                first_pending
            };
            self.processed
                .push(Self::encode_pending_message(first_message, first_filter));
            self.processed
                .push(Self::encode_pending_message(second_message, second_filter));
            self.processed
                .push(Self::encode_pending_message(third_message, third_filter));
            self.processed
                .push(Self::encode_pending_message(fourth_message, fourth_filter));
            self.processed
                .push(Self::encode_pending_message(fifth_message, fifth_filter));
            self.processed
                .push(Self::encode_pending_message(sixth_message, sixth_filter));
            self.processed
                .push(Self::encode_pending_message(seventh_message, seventh_filter));
            self.processed
                .push(Self::encode_pending_message(eighth_message, eighth_filter));
            return;
        }
        if pending_len == 9 {
            reserve_for_append(&mut self.processed, 9);
            let (ninth_message, ninth_filter) = {
                let Some(ninth_pending) = self.pending.pop() else {
                    unreachable!("nonuple pending message length matched branch");
                };
                ninth_pending
            };
            let (eighth_message, eighth_filter) = {
                let Some(eighth_pending) = self.pending.pop() else {
                    unreachable!("nonuple pending message length matched branch");
                };
                eighth_pending
            };
            let (seventh_message, seventh_filter) = {
                let Some(seventh_pending) = self.pending.pop() else {
                    unreachable!("nonuple pending message length matched branch");
                };
                seventh_pending
            };
            let (sixth_message, sixth_filter) = {
                let Some(sixth_pending) = self.pending.pop() else {
                    unreachable!("nonuple pending message length matched branch");
                };
                sixth_pending
            };
            let (fifth_message, fifth_filter) = {
                let Some(fifth_pending) = self.pending.pop() else {
                    unreachable!("nonuple pending message length matched branch");
                };
                fifth_pending
            };
            let (fourth_message, fourth_filter) = {
                let Some(fourth_pending) = self.pending.pop() else {
                    unreachable!("nonuple pending message length matched branch");
                };
                fourth_pending
            };
            let (third_message, third_filter) = {
                let Some(third_pending) = self.pending.pop() else {
                    unreachable!("nonuple pending message length matched branch");
                };
                third_pending
            };
            let (second_message, second_filter) = {
                let Some(second_pending) = self.pending.pop() else {
                    unreachable!("nonuple pending message length matched branch");
                };
                second_pending
            };
            let (first_message, first_filter) = {
                let Some(first_pending) = self.pending.pop() else {
                    unreachable!("nonuple pending message length matched branch");
                };
                first_pending
            };
            self.processed
                .push(Self::encode_pending_message(first_message, first_filter));
            self.processed
                .push(Self::encode_pending_message(second_message, second_filter));
            self.processed
                .push(Self::encode_pending_message(third_message, third_filter));
            self.processed
                .push(Self::encode_pending_message(fourth_message, fourth_filter));
            self.processed
                .push(Self::encode_pending_message(fifth_message, fifth_filter));
            self.processed
                .push(Self::encode_pending_message(sixth_message, sixth_filter));
            self.processed
                .push(Self::encode_pending_message(seventh_message, seventh_filter));
            self.processed
                .push(Self::encode_pending_message(eighth_message, eighth_filter));
            self.processed
                .push(Self::encode_pending_message(ninth_message, ninth_filter));
            return;
        }
        if pending_len <= SYNC_ENCODE_BATCH_LIMIT {
            reserve_for_append(&mut self.processed, pending_len);
            let pending = take_vec_with_capacity(&mut self.pending);
            for (message, filter) in pending {
                self.processed
                    .push(Self::encode_pending_message(message, filter));
            }
            return;
        }
        let all_pending = take_vec_with_capacity(&mut self.pending);

        let sender = Arc::clone(&self.sender);
        rayon::spawn_fifo(move || {
            let encoded: Vec<(EncodedMessage, ClientFilter)> = all_pending
                .into_par_iter()
                .map(|(message, filter)| Self::encode_pending_message(message, filter))
                .collect();
            let _ = sender.send(encoded);
        });
    }

    #[inline]
    fn encode_pending_message(
        message: Message,
        filter: ClientFilter,
    ) -> (EncodedMessage, ClientFilter) {
        let (is_rtc_eligible, is_transport_eligible) = Self::compute_delivery_eligibility(&message);
        (
            EncodedMessage {
                data: Bytes::from(encode_message(&message)),
                is_rtc_eligible,
                is_transport_eligible,
            },
            filter,
        )
    }

    pub fn receive(&mut self) -> Vec<(EncodedMessage, ClientFilter)> {
        if self.processed.is_empty() {
            let mut first_batch = match self.receiver.try_recv() {
                Ok(messages) => messages,
                Err(_) => return Vec::new(),
            };
            while let Ok(mut messages) = self.receiver.try_recv() {
                reserve_for_append(&mut first_batch, messages.len());
                first_batch.append(&mut messages);
            }
            return first_batch;
        }
        let mut result = take_vec_with_capacity(&mut self.processed);
        if let Ok(mut first_batch) = self.receiver.try_recv() {
            reserve_for_append(&mut result, first_batch.len());
            result.append(&mut first_batch);
            while let Ok(mut messages) = self.receiver.try_recv() {
                reserve_for_append(&mut result, messages.len());
                result.append(&mut messages);
            }
        }
        result
    }

    #[inline]
    fn compute_delivery_eligibility(message: &Message) -> (bool, bool) {
        let message_type = message.r#type;
        let is_transport_eligible =
            message_type == MESSAGE_TYPE_ENTITY || message_type == MESSAGE_TYPE_PEER;
        if message_type != MESSAGE_TYPE_ENTITY {
            return (message_type == MESSAGE_TYPE_PEER, is_transport_eligible);
        }
        let entities = &message.entities;
        let is_rtc_eligible = match entities.as_slice() {
            [] => false,
            [entity] => entity.operation == ENTITY_OPERATION_UPDATE,
            [first, second] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
            }
            [first, second, third] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
                    && third.operation == ENTITY_OPERATION_UPDATE
            }
            [first, second, third, fourth] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
                    && third.operation == ENTITY_OPERATION_UPDATE
                    && fourth.operation == ENTITY_OPERATION_UPDATE
            }
            [first, second, third, fourth, fifth] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
                    && third.operation == ENTITY_OPERATION_UPDATE
                    && fourth.operation == ENTITY_OPERATION_UPDATE
                    && fifth.operation == ENTITY_OPERATION_UPDATE
            }
            [first, second, third, fourth, fifth, sixth] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
                    && third.operation == ENTITY_OPERATION_UPDATE
                    && fourth.operation == ENTITY_OPERATION_UPDATE
                    && fifth.operation == ENTITY_OPERATION_UPDATE
                    && sixth.operation == ENTITY_OPERATION_UPDATE
            }
            [first, second, third, fourth, fifth, sixth, seventh] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
                    && third.operation == ENTITY_OPERATION_UPDATE
                    && fourth.operation == ENTITY_OPERATION_UPDATE
                    && fifth.operation == ENTITY_OPERATION_UPDATE
                    && sixth.operation == ENTITY_OPERATION_UPDATE
                    && seventh.operation == ENTITY_OPERATION_UPDATE
            }
            [first, second, third, fourth, fifth, sixth, seventh, eighth] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
                    && third.operation == ENTITY_OPERATION_UPDATE
                    && fourth.operation == ENTITY_OPERATION_UPDATE
                    && fifth.operation == ENTITY_OPERATION_UPDATE
                    && sixth.operation == ENTITY_OPERATION_UPDATE
                    && seventh.operation == ENTITY_OPERATION_UPDATE
                    && eighth.operation == ENTITY_OPERATION_UPDATE
            }
            [first, second, third, fourth, fifth, sixth, seventh, eighth, ninth] => {
                first.operation == ENTITY_OPERATION_UPDATE
                    && second.operation == ENTITY_OPERATION_UPDATE
                    && third.operation == ENTITY_OPERATION_UPDATE
                    && fourth.operation == ENTITY_OPERATION_UPDATE
                    && fifth.operation == ENTITY_OPERATION_UPDATE
                    && sixth.operation == ENTITY_OPERATION_UPDATE
                    && seventh.operation == ENTITY_OPERATION_UPDATE
                    && eighth.operation == ENTITY_OPERATION_UPDATE
                    && ninth.operation == ENTITY_OPERATION_UPDATE
            }
            [first, second, rest @ ..] => {
                if first.operation != ENTITY_OPERATION_UPDATE
                    || second.operation != ENTITY_OPERATION_UPDATE
                {
                    return (false, is_transport_eligible);
                }
                for entity in rest {
                    if entity.operation != ENTITY_OPERATION_UPDATE {
                        return (false, is_transport_eligible);
                    }
                }
                true
            }
        };

        (is_rtc_eligible, is_transport_eligible)
    }

    #[cfg(test)]
    fn compute_rtc_eligibility(message: &Message) -> bool {
        Self::compute_delivery_eligibility(message).0
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::{EncodedMessage, EncodedMessageQueue, MessageQueues};
    use crate::{ClientFilter, EntityOperation, EntityProtocol, Message, MessageType};

    fn encoded_marker(marker: u8) -> EncodedMessage {
        EncodedMessage {
            data: Bytes::from(vec![marker]),
            is_rtc_eligible: true,
            is_transport_eligible: true,
        }
    }

    #[test]
    fn message_queues_drain_prioritized_orders_by_priority_group() {
        let mut queue = MessageQueues::new();
        queue.push((
            Message::new(&MessageType::Load).build(),
            ClientFilter::Direct("load".to_string()),
        ));
        queue.push((
            Message::new(&MessageType::Update).build(),
            ClientFilter::Direct("update".to_string()),
        ));
        queue.push((
            Message::new(&MessageType::Peer).build(),
            ClientFilter::Direct("peer".to_string()),
        ));

        let drained = queue.drain_prioritized();
        assert_eq!(drained.len(), 3);
        assert_eq!(MessageType::try_from(drained[0].0.r#type), Ok(MessageType::Peer));
        assert_eq!(
            MessageType::try_from(drained[1].0.r#type),
            Ok(MessageType::Update)
        );
        assert_eq!(MessageType::try_from(drained[2].0.r#type), Ok(MessageType::Load));
    }

    #[test]
    fn message_queues_drain_prioritized_orders_critical_then_bulk_without_normal() {
        let mut queue = MessageQueues::new();
        queue.push((
            Message::new(&MessageType::Peer).build(),
            ClientFilter::Direct("peer".to_string()),
        ));
        queue.push((
            Message::new(&MessageType::Load).build(),
            ClientFilter::Direct("load".to_string()),
        ));
        queue.push((
            Message::new(&MessageType::Unload).build(),
            ClientFilter::Direct("unload".to_string()),
        ));

        let drained = queue.drain_prioritized();
        assert_eq!(drained.len(), 3);
        assert_eq!(MessageType::try_from(drained[0].0.r#type), Ok(MessageType::Peer));
        assert_eq!(MessageType::try_from(drained[1].0.r#type), Ok(MessageType::Load));
        assert_eq!(MessageType::try_from(drained[2].0.r#type), Ok(MessageType::Unload));
    }

    #[test]
    fn compute_rtc_eligibility_for_entities_requires_only_updates() {
        let update_entity = EntityProtocol {
            operation: EntityOperation::Update,
            id: "id".to_string(),
            r#type: "kind".to_string(),
            metadata: None,
        };
        let delete_entity = EntityProtocol {
            operation: EntityOperation::Delete,
            id: "id".to_string(),
            r#type: "kind".to_string(),
            metadata: None,
        };

        let update_message = Message::new(&MessageType::Entity)
            .entities(&[update_entity.clone()])
            .build();
        let double_update_message = Message::new(&MessageType::Entity)
            .entities(&[update_entity.clone(), update_entity.clone()])
            .build();
        let triple_update_message = Message::new(&MessageType::Entity)
            .entities(&[
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
            ])
            .build();
        let quadruple_update_message = Message::new(&MessageType::Entity)
            .entities(&[
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
            ])
            .build();
        let quintuple_update_message = Message::new(&MessageType::Entity)
            .entities(&[
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
            ])
            .build();
        let sextuple_update_message = Message::new(&MessageType::Entity)
            .entities(&[
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
            ])
            .build();
        let septuple_update_message = Message::new(&MessageType::Entity)
            .entities(&[
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
            ])
            .build();
        let octuple_update_message = Message::new(&MessageType::Entity)
            .entities(&[
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
            ])
            .build();
        let nonuple_update_message = Message::new(&MessageType::Entity)
            .entities(&[
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
                update_entity.clone(),
            ])
            .build();
        let mixed_message = Message::new(&MessageType::Entity)
            .entities(&[update_entity, delete_entity])
            .build();
        let mixed_quadruple_message = Message::new(&MessageType::Entity)
            .entities(&[
                EntityProtocol {
                    operation: EntityOperation::Update,
                    id: "id-1".to_string(),
                    r#type: "kind".to_string(),
                    metadata: None,
                },
                EntityProtocol {
                    operation: EntityOperation::Update,
                    id: "id-2".to_string(),
                    r#type: "kind".to_string(),
                    metadata: None,
                },
                EntityProtocol {
                    operation: EntityOperation::Delete,
                    id: "id-3".to_string(),
                    r#type: "kind".to_string(),
                    metadata: None,
                },
                EntityProtocol {
                    operation: EntityOperation::Update,
                    id: "id-4".to_string(),
                    r#type: "kind".to_string(),
                    metadata: None,
                },
            ])
            .build();
        let empty_message = Message::new(&MessageType::Entity).build();

        assert!(EncodedMessageQueue::compute_rtc_eligibility(&update_message));
        assert!(EncodedMessageQueue::compute_rtc_eligibility(
            &double_update_message
        ));
        assert!(EncodedMessageQueue::compute_rtc_eligibility(
            &triple_update_message
        ));
        assert!(EncodedMessageQueue::compute_rtc_eligibility(
            &quadruple_update_message
        ));
        assert!(EncodedMessageQueue::compute_rtc_eligibility(
            &quintuple_update_message
        ));
        assert!(EncodedMessageQueue::compute_rtc_eligibility(
            &sextuple_update_message
        ));
        assert!(EncodedMessageQueue::compute_rtc_eligibility(
            &septuple_update_message
        ));
        assert!(EncodedMessageQueue::compute_rtc_eligibility(
            &octuple_update_message
        ));
        assert!(EncodedMessageQueue::compute_rtc_eligibility(
            &nonuple_update_message
        ));
        assert!(!EncodedMessageQueue::compute_rtc_eligibility(&mixed_message));
        assert!(!EncodedMessageQueue::compute_rtc_eligibility(
            &mixed_quadruple_message
        ));
        assert!(!EncodedMessageQueue::compute_rtc_eligibility(&empty_message));
    }

    #[test]
    fn process_encodes_nine_messages_synchronously() {
        let mut queue = EncodedMessageQueue::new();
        let mut pending = Vec::with_capacity(9);
        for index in 0..9 {
            pending.push((
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct(format!("client-{index}")),
            ));
        }
        queue.append(pending);

        queue.process();

        assert!(queue.pending.is_empty());
        assert_eq!(queue.processed.len(), 9);
        for index in 0..9 {
            let expected_id = format!("client-{index}");
            assert!(matches!(
                queue.processed.get(index).map(|(_, filter)| filter),
                Some(ClientFilter::Direct(id)) if id == &expected_id
            ));
        }
    }

    #[test]
    fn process_encodes_two_messages_synchronously_in_order() {
        let mut queue = EncodedMessageQueue::new();
        queue.append(vec![
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("first".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("second".to_string()),
            ),
        ]);

        queue.process();

        assert!(queue.pending.is_empty());
        assert_eq!(queue.processed.len(), 2);
        assert!(matches!(
            queue.processed.first().map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "first"
        ));
        assert!(matches!(
            queue.processed.get(1).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "second"
        ));
    }

    #[test]
    fn process_encodes_three_messages_synchronously_in_order() {
        let mut queue = EncodedMessageQueue::new();
        queue.append(vec![
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("first".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("second".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("third".to_string()),
            ),
        ]);

        queue.process();

        assert!(queue.pending.is_empty());
        assert_eq!(queue.processed.len(), 3);
        assert!(matches!(
            queue.processed.first().map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "first"
        ));
        assert!(matches!(
            queue.processed.get(1).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "second"
        ));
        assert!(matches!(
            queue.processed.get(2).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "third"
        ));
    }

    #[test]
    fn process_encodes_four_messages_synchronously_in_order() {
        let mut queue = EncodedMessageQueue::new();
        queue.append(vec![
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("first".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("second".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("third".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("fourth".to_string()),
            ),
        ]);

        queue.process();

        assert!(queue.pending.is_empty());
        assert_eq!(queue.processed.len(), 4);
        assert!(matches!(
            queue.processed.first().map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "first"
        ));
        assert!(matches!(
            queue.processed.get(1).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "second"
        ));
        assert!(matches!(
            queue.processed.get(2).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "third"
        ));
        assert!(matches!(
            queue.processed.get(3).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "fourth"
        ));
    }

    #[test]
    fn process_encodes_five_messages_synchronously_in_order() {
        let mut queue = EncodedMessageQueue::new();
        queue.append(vec![
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("first".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("second".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("third".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("fourth".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("fifth".to_string()),
            ),
        ]);

        queue.process();

        assert!(queue.pending.is_empty());
        assert_eq!(queue.processed.len(), 5);
        assert!(matches!(
            queue.processed.first().map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "first"
        ));
        assert!(matches!(
            queue.processed.get(1).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "second"
        ));
        assert!(matches!(
            queue.processed.get(2).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "third"
        ));
        assert!(matches!(
            queue.processed.get(3).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "fourth"
        ));
        assert!(matches!(
            queue.processed.get(4).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "fifth"
        ));
    }

    #[test]
    fn process_encodes_six_messages_synchronously_in_order() {
        let mut queue = EncodedMessageQueue::new();
        queue.append(vec![
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("first".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("second".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("third".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("fourth".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("fifth".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("sixth".to_string()),
            ),
        ]);

        queue.process();

        assert!(queue.pending.is_empty());
        assert_eq!(queue.processed.len(), 6);
        assert!(matches!(
            queue.processed.first().map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "first"
        ));
        assert!(matches!(
            queue.processed.get(1).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "second"
        ));
        assert!(matches!(
            queue.processed.get(2).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "third"
        ));
        assert!(matches!(
            queue.processed.get(3).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "fourth"
        ));
        assert!(matches!(
            queue.processed.get(4).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "fifth"
        ));
        assert!(matches!(
            queue.processed.get(5).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "sixth"
        ));
    }

    #[test]
    fn process_encodes_seven_messages_synchronously_in_order() {
        let mut queue = EncodedMessageQueue::new();
        queue.append(vec![
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("first".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("second".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("third".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("fourth".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("fifth".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("sixth".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("seventh".to_string()),
            ),
        ]);

        queue.process();

        assert!(queue.pending.is_empty());
        assert_eq!(queue.processed.len(), 7);
        assert!(matches!(
            queue.processed.first().map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "first"
        ));
        assert!(matches!(
            queue.processed.get(1).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "second"
        ));
        assert!(matches!(
            queue.processed.get(2).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "third"
        ));
        assert!(matches!(
            queue.processed.get(3).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "fourth"
        ));
        assert!(matches!(
            queue.processed.get(4).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "fifth"
        ));
        assert!(matches!(
            queue.processed.get(5).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "sixth"
        ));
        assert!(matches!(
            queue.processed.get(6).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "seventh"
        ));
    }

    #[test]
    fn process_encodes_eight_messages_synchronously_in_order() {
        let mut queue = EncodedMessageQueue::new();
        queue.append(vec![
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("first".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("second".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("third".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("fourth".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("fifth".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("sixth".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("seventh".to_string()),
            ),
            (
                Message::new(&MessageType::Peer).build(),
                ClientFilter::Direct("eighth".to_string()),
            ),
        ]);

        queue.process();

        assert!(queue.pending.is_empty());
        assert_eq!(queue.processed.len(), 8);
        assert!(matches!(
            queue.processed.first().map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "first"
        ));
        assert!(matches!(
            queue.processed.get(1).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "second"
        ));
        assert!(matches!(
            queue.processed.get(2).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "third"
        ));
        assert!(matches!(
            queue.processed.get(3).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "fourth"
        ));
        assert!(matches!(
            queue.processed.get(4).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "fifth"
        ));
        assert!(matches!(
            queue.processed.get(5).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "sixth"
        ));
        assert!(matches!(
            queue.processed.get(6).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "seventh"
        ));
        assert!(matches!(
            queue.processed.get(7).map(|(_, filter)| filter),
            Some(ClientFilter::Direct(id)) if id == "eighth"
        ));
    }

    #[test]
    fn receive_merges_processed_and_multiple_async_batches() {
        let mut queue = EncodedMessageQueue::new();
        queue
            .processed
            .push((encoded_marker(1), ClientFilter::Direct("processed".to_string())));
        queue
            .sender
            .send(vec![(encoded_marker(2), ClientFilter::Direct("batch-1".to_string()))])
            .unwrap();
        queue
            .sender
            .send(vec![
                (encoded_marker(3), ClientFilter::Direct("batch-2".to_string())),
                (encoded_marker(4), ClientFilter::Direct("batch-3".to_string())),
            ])
            .unwrap();

        let received = queue.receive();
        let payload_markers: Vec<u8> = received
            .iter()
            .map(|(encoded, _)| encoded.data[0])
            .collect();

        assert_eq!(payload_markers, vec![1, 2, 3, 4]);
        assert!(queue.processed.is_empty());
    }

    #[test]
    fn receive_merges_async_batches_when_processed_is_empty() {
        let mut queue = EncodedMessageQueue::new();
        queue
            .sender
            .send(vec![
                (encoded_marker(2), ClientFilter::Direct("batch-1".to_string())),
                (encoded_marker(3), ClientFilter::Direct("batch-2".to_string())),
            ])
            .unwrap();
        queue
            .sender
            .send(vec![(encoded_marker(4), ClientFilter::Direct("batch-3".to_string()))])
            .unwrap();

        let received = queue.receive();
        let payload_markers: Vec<u8> = received
            .iter()
            .map(|(encoded, _)| encoded.data[0])
            .collect();

        assert_eq!(payload_markers, vec![2, 3, 4]);
        assert!(queue.processed.is_empty());
    }

    #[test]
    fn receive_merges_exactly_two_async_batches_when_processed_empty() {
        let mut queue = EncodedMessageQueue::new();
        queue
            .sender
            .send(vec![(encoded_marker(8), ClientFilter::Direct("batch-a".to_string()))])
            .unwrap();
        queue
            .sender
            .send(vec![(encoded_marker(9), ClientFilter::Direct("batch-b".to_string()))])
            .unwrap();

        let received = queue.receive();
        let payload_markers: Vec<u8> = received
            .iter()
            .map(|(encoded, _)| encoded.data[0])
            .collect();

        assert_eq!(payload_markers, vec![8, 9]);
    }

    #[test]
    fn receive_merges_exactly_two_async_batches_when_processed_non_empty() {
        let mut queue = EncodedMessageQueue::new();
        queue
            .processed
            .push((encoded_marker(7), ClientFilter::Direct("processed".to_string())));
        queue
            .sender
            .send(vec![(encoded_marker(8), ClientFilter::Direct("batch-a".to_string()))])
            .unwrap();
        queue
            .sender
            .send(vec![(encoded_marker(9), ClientFilter::Direct("batch-b".to_string()))])
            .unwrap();

        let received = queue.receive();
        let payload_markers: Vec<u8> = received
            .iter()
            .map(|(encoded, _)| encoded.data[0])
            .collect();

        assert_eq!(payload_markers, vec![7, 8, 9]);
    }
}
