/// A filter for clients, used for specific broadcasting.
#[derive(Clone, Debug, Hash, Eq, PartialEq)]
pub enum ClientFilter {
    All,
    Direct(String),
    Include(Vec<String>),
    Exclude(Vec<String>),
}
