# Agents

## Cursor Cloud specific instructions

### Overview

Voxelize is a multiplayer voxel engine (browser-based Minecraft-like) with a Rust backend server (Actix-Web, port 4000) and a TypeScript/Three.js frontend client (Vite, port 3000). No database or external services are required.

### Required system tools (installed in VM snapshot)

- Rust stable toolchain with `wasm32-unknown-unknown` target
- `protoc` (protobuf compiler, via `apt install protobuf-compiler`)
- `wasm-pack` (builds Rust to WASM for the client-side mesher)
- `cargo-watch` (Rust hot-reload for `pnpm run demo:rs`)
- Node.js + pnpm 10.9.0

### Build and run commands

See `package.json` scripts at the repo root. Key commands:

- `pnpm install` -- install JS dependencies
- `pnpm run proto` -- generate protobuf code (required once before first build)
- `pnpm run build` -- build WASM mesher + all TS packages (required before running demo)
- `pnpm run demo` -- start both frontend (port 3000) and backend (port 4000) in parallel
- `pnpm run demo:ts` -- start frontend only
- `pnpm run demo:rs` -- start backend only (uses `cargo-watch`)
- `pnpm run lint` -- ESLint across all JS/TS
- `pnpm run test` -- vitest (JS)
- `pnpm run test:rust` -- `cargo test --test mesher_tests --test lights_tests`
- `cargo check --lib` -- check Rust library compiles

### Proxy setup for port-forwarded environments

The Vite dev server config (`examples/client/vite.config.js`) proxies `/ws/` and `/info` to the Rust backend on port 4000. This means the frontend works through single-port proxies (e.g., Cursor Cloud port forwarding) without needing port 4000 directly exposed. The client code in `main.ts` only swaps to port 4000 when accessed at `localhost:3000` directly.

### Gotchas

- The `pnpm-workspace.yaml` includes `onlyBuiltDependencies` to avoid interactive `pnpm approve-builds` prompts.
- The `packages/protocol` build step includes `copyproto` which copies generated protobuf files into `dist/`. Always run `pnpm run proto` before `pnpm run build` if `messages.proto` has changed.
- Husky pre-commit hook runs `pnpm lint-staged` (prettier + eslint on staged JS/TS files).
