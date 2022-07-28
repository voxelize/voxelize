---
sidebar_position: 2
---

# Getting Started

To create a voxelize app, first create a root project folder.

```bash
mkdir voxelize-example
cd voxelize-example
```

## What you'll need

- [Rust](https://www.rust-lang.org/tools/install) version 1.16 or above:
  - You can write your own Voxelize server in Rust _or_ you could create a server with the CLI.

## Start Developing

A fullstack Voxelize app consists of a Rust server and a regular web client. For the client-side example in this tutorial,
we use plane HTML + Webpack as our choice of frontend.

### Cloning the Example

To get started with this tutorial, go ahead and clone the given example:

```bash
# Clone the git-repository
git clone https://github.com/shaoruu/voxelize-example

# Navigate into the project folder
cd voxelize-example

# Install the dependencies
npm install
```

The template example consists of a Rust app `server` contained within a basic `webpack` based JS frontend, with client-side code located in the `client` folder.
