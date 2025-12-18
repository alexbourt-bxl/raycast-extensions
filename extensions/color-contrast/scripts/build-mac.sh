#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SRC="$ROOT_DIR/native/mac/main.swift"
OUT="$ROOT_DIR/assets/mac"

mkdir -p "$ROOT_DIR/assets"

swiftc \
  -O \
  -framework Cocoa \
  "$SRC" \
  -o "$OUT"

chmod +x "$OUT"

echo "Built $OUT"
