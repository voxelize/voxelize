use hashbrown::HashMap;

#[derive(Debug, Clone)]
pub struct LSystem {
    pub axiom: String,
    pub rules: HashMap<char, String>,
    pub iterations: u32,
}

impl Default for LSystem {
    fn default() -> Self {
        Self {
            axiom: "F%".to_owned(),
            rules: HashMap::new(),
            iterations: 0,
        }
    }
}

impl LSystem {
    pub fn new() -> LSystemBuilder {
        LSystemBuilder::default()
    }

    pub fn set_axiom(&mut self, axiom: &str) {
        self.axiom = axiom.to_string();
    }

    pub fn set_rules(&mut self, rules: &[(&str, &str)]) {
        for &(key, value) in rules {
            let Some(rule_key) = key.chars().next() else {
                continue;
            };
            self.rules.insert(rule_key, value.to_string());
        }
    }

    pub fn set_iterations(&mut self, iterations: u32) {
        self.iterations = iterations;
    }

    pub fn generate(&self) -> String {
        let mut result = String::new();

        for c in self.axiom.chars() {
            result.push(c);
        }

        for _ in 0..self.iterations {
            let mut new_result = String::new();
            for c in result.chars() {
                if let Some(rule) = self.rules.get(&c) {
                    new_result.push_str(rule);
                } else {
                    new_result.push(c);
                }
            }
            result = new_result;
        }

        result
    }
}

// The builder for LSystems
#[derive(Default)]
pub struct LSystemBuilder {
    axiom: String,
    rules: HashMap<char, String>,
    iterations: u32,
}

impl LSystemBuilder {
    pub fn new() -> LSystemBuilder {
        LSystemBuilder {
            axiom: String::new(),
            rules: HashMap::new(),
            iterations: 0,
        }
    }

    pub fn axiom(mut self, axiom: &str) -> LSystemBuilder {
        self.axiom = axiom.to_owned();
        self
    }

    pub fn rule(mut self, key: char, value: &str) -> LSystemBuilder {
        self.rules.insert(key, value.to_owned());
        self
    }

    pub fn iterations(mut self, iterations: u32) -> LSystemBuilder {
        self.iterations = iterations;
        self
    }

    pub fn build(self) -> LSystem {
        LSystem {
            axiom: self.axiom,
            rules: self.rules,
            iterations: self.iterations,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::LSystem;

    #[test]
    fn set_rules_skips_empty_rule_keys() {
        let mut system = LSystem::default();
        system.set_rules(&[("", "AB"), ("F", "FX")]);

        assert_eq!(system.rules.len(), 1);
        assert_eq!(system.rules.get(&'F'), Some(&String::from("FX")));
    }

    #[test]
    fn set_rules_uses_first_character_of_rule_key() {
        let mut system = LSystem::default();
        system.set_rules(&[("FG", "X")]);

        assert_eq!(system.rules.get(&'F'), Some(&String::from("X")));
        assert!(!system.rules.contains_key(&'G'));
    }
}
