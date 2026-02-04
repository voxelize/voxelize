use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::any::Any;
use std::fmt::Debug;

pub trait ItemComponent: Any + Send + Sync + Debug {
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
    fn clone_box(&self) -> Box<dyn ItemComponent>;
    fn to_json(&self) -> Value;
    fn component_name(&self) -> &'static str;
}

impl<T> ItemComponent for T
where
    T: Any + Send + Sync + Debug + Clone + Serialize + DeserializeOwned + 'static,
    T: ItemComponentName,
{
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn clone_box(&self) -> Box<dyn ItemComponent> {
        Box::new(self.clone())
    }

    fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    fn component_name(&self) -> &'static str {
        T::COMPONENT_NAME
    }
}

pub trait ItemComponentName {
    const COMPONENT_NAME: &'static str;
}

impl Clone for Box<dyn ItemComponent> {
    fn clone(&self) -> Self {
        self.clone_box()
    }
}
