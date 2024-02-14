/// A filter for clients, used for specific broadcasting.
#[derive(Clone, Debug)]
pub enum ClientFilter {
    All,
    Direct(String),
    Include(Vec<String>),
    Exclude(Vec<String>),
}
