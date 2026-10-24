#!/usr/bin/env bash
# Rebuilds vendor/demucs-wasm from a pinned demucs-rs commit.
# Needs: rustup (stable, wasm32-unknown-unknown target) and wasm-bindgen-cli 0.2.108 on PATH.
set -euo pipefail
REV=805d6f72ede20282832ac78c634e8767716c0b21
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/demucs-rs-build"
rm -rf "$WORK"
git clone -q https://github.com/nikhilunni/demucs-rs.git "$WORK"
git -C "$WORK" checkout -q "$REV"
(cd "$WORK" && cargo build -p demucs-wasm --release --target wasm32-unknown-unknown)
wasm-bindgen --target web --out-dir "$ROOT/vendor/demucs-wasm" \
	"$WORK/target/wasm32-unknown-unknown/release/demucs_wasm.wasm"
cp "$WORK/LICENSE" "$ROOT/vendor/demucs-wasm/LICENSE"
echo "vendor/demucs-wasm rebuilt from $REV"
