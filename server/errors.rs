use std::fmt;

#[derive(Debug, Clone)]
pub struct AddWorldError;

impl fmt::Display for AddWorldError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "could not add world.")
    }
}
