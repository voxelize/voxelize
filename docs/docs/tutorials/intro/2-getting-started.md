---
sidebar_position: 2
---

# Getting Started

This series of tutorials will be based on [this tutorial repository](https://github.com/voxelize/voxelize-tutorial). We will be building a full-stack deployable app that teaches you how to use Voxelize.

## What you'll need

In order to develop in Voxelize, some prior knowledge is recommended:
- [Rust](https://www.rust-lang.org/tools/install) version `1.7` or above
    - We use Rust to write our Voxelize server.
- [ThreeJS](https://threejs.org/) version `v0.158.0` or above.
    - The frontend-side is essentially a ThreeJS app.

## Start developing

A fullstack Voxelize app consists of a Rust server and a web client. For the client-side example in this tutorial, we will use the plain HTML + JS template from [vite.js](https://vitejs.dev/).

### Cloning the Example

To get started with this tutorial, go ahead and clone the given example:

```bash
# Clone the git-repository
git clone https://github.com/voxelize/voxelize-tutorial

# Navigate into the project folder
cd voxelize-tutorial

# Install the dependencies
npm install
```

The template example consists of a Rust app `server` contained within a basic `webpack` based JS frontend, with client-side code located in the `client` folder.
