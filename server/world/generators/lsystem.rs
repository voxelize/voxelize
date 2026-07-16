use hashbrown::HashMap;

/// Deterministic splitmix64 parameter stream. One instance is seeded per
/// generated tree, and every stochastic decision (rule selection, turtle
/// jitter) pulls from it in walk order, so the same seed always grows the
/// same tree.
pub struct TreeRng(u64);

impl TreeRng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    /// One full avalanche pass, exposed so callers can fold coordinates
    /// and world seeds into a well-mixed stream seed.
    pub fn scramble(mut x: u64) -> u64 {
        x ^= x >> 30;
        x = x.wrapping_mul(0xbf58476d1ce4e5b9);
        x ^= x >> 27;
        x = x.wrapping_mul(0x94d049bb133111eb);
        x ^= x >> 31;
        x
    }

    /// Uniform draw in [0, 1).
    pub fn unit(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        (Self::scramble(self.0) >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Uniform draw in [-1, 1).
    pub fn signed(&mut self) -> f64 {
        self.unit() * 2.0 - 1.0
    }

    /// Uniform draw in [lo, hi).
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + self.unit() * (hi - lo)
    }
}

#[derive(Debug, Clone)]
pub struct LSystem {
    pub axiom: String,
    pub rules: HashMap<char, String>,
    /// Weighted production alternatives. When a symbol has alternatives,
    /// seeded generation re-rolls the production per occurrence, so one
    /// species grows structurally different individuals.
    pub stochastic_rules: HashMap<char, Vec<(String, f64)>>,
    pub iterations: u32,
}

impl Default for LSystem {
    fn default() -> Self {
        Self {
            axiom: "F%".to_owned(),
            rules: HashMap::new(),
            stochastic_rules: HashMap::new(),
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
            self.rules
                .insert(key.chars().next().unwrap(), value.to_string());
        }
    }

    pub fn set_iterations(&mut self, iterations: u32) {
        self.iterations = iterations;
    }

    pub fn is_stochastic(&self) -> bool {
        !self.stochastic_rules.is_empty()
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

    /// Expands the axiom like `generate`, except symbols with weighted
    /// alternatives pick one per occurrence from the tree's stream.
    /// Deterministic rules still apply to every other symbol.
    pub fn generate_seeded(&self, rng: &mut TreeRng) -> String {
        let mut result = self.axiom.clone();

        for _ in 0..self.iterations {
            let mut new_result = String::with_capacity(result.len() * 2);
            for c in result.chars() {
                if let Some(alternatives) = self.stochastic_rules.get(&c) {
                    new_result.push_str(pick_production(alternatives, rng.unit()));
                } else if let Some(rule) = self.rules.get(&c) {
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

fn pick_production(alternatives: &[(String, f64)], roll: f64) -> &str {
    let total: f64 = alternatives.iter().map(|(_, weight)| weight).sum();
    let mut cursor = roll * total;
    for (production, weight) in alternatives {
        if cursor < *weight {
            return production;
        }
        cursor -= weight;
    }
    &alternatives[alternatives.len() - 1].0
}

// The builder for LSystems
#[derive(Default)]
pub struct LSystemBuilder {
    axiom: String,
    rules: HashMap<char, String>,
    stochastic_rules: HashMap<char, Vec<(String, f64)>>,
    iterations: u32,
}

impl LSystemBuilder {
    pub fn new() -> LSystemBuilder {
        LSystemBuilder {
            axiom: String::new(),
            rules: HashMap::new(),
            stochastic_rules: HashMap::new(),
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

    pub fn stochastic_rule(
        mut self,
        key: char,
        alternatives: &[(&str, f64)],
    ) -> LSystemBuilder {
        self.stochastic_rules.insert(
            key,
            alternatives
                .iter()
                .map(|&(production, weight)| (production.to_owned(), weight))
                .collect(),
        );
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
            stochastic_rules: self.stochastic_rules,
            iterations: self.iterations,
        }
    }
}
