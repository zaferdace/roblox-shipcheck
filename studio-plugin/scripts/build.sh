#!/usr/bin/env bash
# Builds both Creator Store artifacts:
#   build/shipcheck.rbxm       (Pro  — Config.edition = "pro")
#   build/shipcheck-free.rbxm  (Free — Config.edition flipped to "free")
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p build

CONFIG="src/Config.luau"

echo "== building Pro =="
rojo build default.project.json -o build/shipcheck.rbxm
echo "  build/shipcheck.rbxm"

echo "== building Free =="
cp "$CONFIG" "$CONFIG.bak"
perl -pi -e 's/edition = "pro"/edition = "free"/' "$CONFIG"
rojo build default.project.json -o build/shipcheck-free.rbxm
mv "$CONFIG.bak" "$CONFIG"
echo "  build/shipcheck-free.rbxm"

echo "done."
