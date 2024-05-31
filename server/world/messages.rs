use std::sync::Arc;

use crossbeam_channel::{Receiver, Sender};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{common::ClientFilter, encode_message, server::Message, EncodedMessage};

pub type MessageQueue = Vec<(Message, ClientFilter)>;

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

    pub fn append(&mut self, mut list: Vec<(Message, ClientFilter)>) {
        self.pending.append(&mut list);
    }

    pub fn process(&mut self) {
        let all_pending: Vec<(Message, ClientFilter)> = self.pending.drain(..).collect();
        if all_pending.is_empty() {
            return;
        }

        let sender = Arc::clone(&self.sender);
        rayon::spawn_fifo(move || {
            all_pending.into_par_iter().for_each(|(message, filter)| {
                let encoded = EncodedMessage(encode_message(&message));
                sender.send(vec![(encoded, filter)]).unwrap();
            });
        });
    }

    pub fn receive(&mut self) -> Vec<(EncodedMessage, ClientFilter)> {
        let mut result = Vec::new();
        while let Ok(mut messages) = self.receiver.try_recv() {
            result.append(&mut messages);
        }
        result
    }
}
