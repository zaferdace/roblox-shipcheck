#!/usr/bin/env bash
# Full local verification gate: format, lint, headless tests, and a build.
# Mirrors CI. Run from anywhere; resolves the plugin root from this script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0

echo "== stylua --check =="
if stylua --check src tests; then echo "  ok"; else echo "  FAILED"; fail=1; fi

echo "== selene =="
if selene src; then echo "  ok"; else echo "  FAILED"; fail=1; fi

echo "== lune tests =="
if lune run tests/runner.luau "$ROOT"; then echo "  ok"; else echo "  FAILED"; fail=1; fi

echo "== rojo build =="
mkdir -p build
if rojo build default.project.json -o build/shipcheck.rbxm; then
	echo "  built build/shipcheck.rbxm"
else
	echo "  FAILED"
	fail=1
fi

if [ "$fail" -ne 0 ]; then
	echo ""
	echo "CHECK FAILED"
	exit 1
fi
echo ""
echo "ALL CHECKS PASSED"
