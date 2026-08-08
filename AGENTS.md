# AGENTS.md

## Cursor Cloud specific instructions

Voxelize is a multiplayer voxel engine: a Rust authoritative server (`voxelize`), a WASM mesher,
and TypeScript client packages (`@voxelize/*`). See `README.md` for the canonical Quick Start,
package list, and development commands; this section only captures the non-obvious, durable
caveats for building, running, and testing it in the cloud VM.

### Build / run / test

- Setup: `pnpm install` -> `pnpm proto` -> `pnpm build` (`pnpm build` builds the WASM mesher and
  all packages).
- Standalone demo: `pnpm demo` runs the demo server (Rust `--example demo`, port **4000**) and the
  demo client (Vite, port **3000**); then open http://localhost:3000.
- Tests: `pnpm test` (TypeScript, vitest), `pnpm test:rust` (mesher + lighting + worldgen), `pnpm check`
  (`cargo check --workspace --all-targets`).

### Non-obvious caveats

- **Rust must be stable >= 1.90.** `rust-toolchain.toml` pins `channel = "stable"` and the
  dependency graph pulls edition-2024 crates; older toolchains (e.g. 1.83) fail to build the
  server, the WASM mesher, and `cargo-watch`.
- **`wasm-pack` and `protoc` are required** in addition to Rust / Node / pnpm / cargo-watch:
  `pnpm build` invokes `wasm-pack` for the client mesher, and `pnpm proto` needs `protoc`.
- **Port clashes when embedded.** `pnpm demo` defaults the client to port 3000 and the server to
  4000. When Voxelize is a submodule of a parent workspace that also uses those ports, run the demo
  client on another port (`cd examples/client && pnpm exec vite --port 3005`) or stop the parent
  stack first.
- **No GPU in the cloud VM** — the browser client runs software WebGL and is very CPU-heavy, so
  live browser sessions can be sluggish or drop the connection under load. For deterministic,
  reliable in-world testing prefer the headless `@voxelize/agent` package over manual browser
  gameplay.

### Programmatic checks

- Rust type check: `pnpm check` (or `cargo check --workspace --all-targets`).
- Rust tests: `pnpm test:rust` (or `pnpm test:rust:all`).
- TypeScript tests: `pnpm test`.
