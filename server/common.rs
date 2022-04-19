/// A filter for clients, used for specific broadcasting.
pub enum ClientFilter {
    All,
    Direct(String),
    Include(Vec<String>),
    Exclude(Vec<String>),
}
