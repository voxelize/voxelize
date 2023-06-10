// reference: https://github.com/NotAPenguin0/andromeda-rs/blob/master/crates/inject/src/storage.rs

use std::{
    any::{Any, TypeId},
    boxed::ThinBox,
    collections::HashMap,
    sync::RwLock,
};

#[derive(Debug, Default)]
pub struct ErasedStorage {
    dyn_items: HashMap<TypeId, ThinBox<dyn Any>>,
    items: HashMap<TypeId, Box<dyn Any>>,
}

impl ErasedStorage {
    /// Create a new erased storage.
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert a dynamic item into the storage.
    pub fn insert_dyn<T: ?Sized + 'static>(&mut self, item: ThinBox<T>) {
        // SAFETY: ThinBox always has the same size regardless of the type inside,
        // so we can transmute this to a different pointer until we cast it back to
        // T in get()
        let any = unsafe { std::mem::transmute::<_, ThinBox<dyn Any>>(item) };
        self.dyn_items.insert(TypeId::of::<T>(), any);
    }

    /// Insert a static type into the storage. This can be retrieved back
    /// by calling [`Self::get::<T>()`].
    pub fn insert<T: 'static>(&mut self, item: T) {
        self.items.insert(TypeId::of::<T>(), Box::new(item));
    }

    /// Insert a static type T into the registry, with an additional lock around it.
    pub fn insert_sync<T: 'static>(&mut self, item: T) {
        // self.insert(RwLock::)
    }
}
