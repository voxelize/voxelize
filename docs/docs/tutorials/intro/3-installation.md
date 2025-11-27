---
sidebar_position: 3
---

# Installation

The tutorial repo is already set up with dependencies. Here's what's included:

## Server Dependencies

```toml title="Cargo.toml"
voxelize = "1.0.0"
actix-web = "4.5.1"
specs = { version = "0.20.0", features = ["specs-derive", "serde"] }
```

- `voxelize` - Core server library
- `actix-web` - WebSocket handling
- `specs` - Entity Component System

## Client Dependencies

```json title="package.json"
"dependencies": {
  "@voxelize/core": "^1.0.0",
  "three": "^0.165.0"
}
```

- `@voxelize/core` - Client library
- `three` - 3D rendering

## Running the Tutorial

Start the server:

```bash
npm run server
```

In another terminal, start the client:

```bash
npm run dev
```

The server runs on `http://localhost:4000` and the client on `http://localhost:5173`.

Stuck? Check the [final branch](https://github.com/voxelize/voxelize-tutorial/tree/final) for the completed code.
