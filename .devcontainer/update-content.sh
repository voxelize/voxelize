#!/bin/bash
set -e

# Install Rust dependencies
echo "Installing Rust dependencies..."
cargo fetch

# Install Node.js dependencies
echo "Installing Node.js dependencies with pnpm..."
pnpm install --recursive

echo "Dependencies successfully installed!" 

echo "Building proto files..."
pnpm proto

echo "Building..."
pnpm build

echo "Content successfully updated!"

