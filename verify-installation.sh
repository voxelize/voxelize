#!/bin/bash

echo "Verifying Voxelize project dependencies..."
echo "========================================="

# Check Rust installation
echo "Checking Rust..."
if command -v rustc &> /dev/null; then
    echo "✓ Rust installed: $(rustc --version)"
else
    echo "✗ Rust not found"
fi

# Check Node.js installation
echo -e "\nChecking Node.js..."
if command -v node &> /dev/null; then
    echo "✓ Node.js installed: $(node --version)"
else
    echo "✗ Node.js not found"
fi

# Check pnpm installation
echo -e "\nChecking pnpm..."
if command -v pnpm &> /dev/null; then
    echo "✓ pnpm installed: $(pnpm --version)"
else
    echo "✗ pnpm not found"
fi

# Check cargo-watch installation
echo -e "\nChecking cargo-watch..."
if command -v cargo-watch &> /dev/null; then
    echo "✓ cargo-watch installed: $(cargo-watch --version)"
else
    echo "✗ cargo-watch not found"
fi

# Check protoc installation
echo -e "\nChecking protoc..."
if command -v protoc &> /dev/null; then
    echo "✓ protoc installed: $(protoc --version)"
else
    echo "✗ protoc not found"
fi

# Check if node_modules exists
echo -e "\nChecking JavaScript dependencies..."
if [ -d "node_modules" ]; then
    echo "✓ JavaScript dependencies installed"
else
    echo "✗ JavaScript dependencies not found"
fi

# Check if Rust target directory exists
echo -e "\nChecking Rust build..."
if [ -d "target" ]; then
    echo "✓ Rust project built"
else
    echo "✗ Rust project not built"
fi

# Check if protocol files exist
echo -e "\nChecking protocol files..."
if [ -f "packages/protocol/dist/protocol.js" ]; then
    echo "✓ Protocol files generated"
else
    echo "✗ Protocol files not found"
fi

echo -e "\nVerification complete!"
echo "======================"
echo "If all checks pass, you can start the development server with: pnpm run demo" 