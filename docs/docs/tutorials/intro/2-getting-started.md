---
sidebar_position: 2
---

# Getting Started

This tutorial builds a multiplayer voxel world from scratch. You'll follow along with the [voxelize-tutorial repository](https://github.com/voxelize/voxelize-tutorial).

## Prerequisites

You need:

- [Rust](https://www.rust-lang.org/tools/install) 1.7+
- [Node.js](https://nodejs.org/) for the client
- Basic [ThreeJS](https://threejs.org/) knowledge helps

## Clone the Tutorial

```bash
git clone https://github.com/voxelize/voxelize-tutorial
cd voxelize-tutorial
npm install
```

The repo structure:

- `src/main.rs` - Rust server
- `main.js` - Client code
- `index.html` - Entry point
- `public/blocks/` - Block textures

A Voxelize app is a Rust server + web client. The client uses ThreeJS for rendering, and we're using Vite for the build setup.
