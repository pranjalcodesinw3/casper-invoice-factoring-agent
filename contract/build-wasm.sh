#!/usr/bin/env bash
# Builds a ReceivableEscrow wasm the Casper node will actually accept.
#
# `cargo odra build` alone produces a module the node REJECTS at preprocessing
# with "Bulk memory operations are not supported". Rust's wasm32-unknown-unknown
# target enables bulk-memory by default, and the opcodes come from precompiled
# `std`, so RUSTFLAGS on our own crate cannot remove them: a clean rebuild with
# -C target-feature=-bulk-memory still emits 479 of them.
#
# The fix is to lower them after the fact. wasm-opt rewrites memory.copy and
# memory.fill into MVP instructions, which is what makes the module installable.
#
# Getting this wrong costs real money: a rejected install consumes the ENTIRE
# payment limit, so an unvalidated wasm is expensive to discover.
set -euo pipefail

cd "$(dirname "$0")"
ODRA_MODULE=ReceivableEscrow cargo odra build

RAW=wasm/ReceivableEscrow.wasm
# The input still contains post-MVP features, so they must be ENABLED for
# wasm-opt to parse it, and lowered in the same pass.
wasm-opt \
  --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
  --enable-nontrapping-float-to-int \
  --llvm-memory-copy-fill-lowering --signext-lowering \
  -Os "$RAW" -o "$RAW.tmp"
mv "$RAW.tmp" "$RAW"

REMAINING=$(wasm2wat "$RAW" 2>/dev/null | grep -cE "memory\.copy|memory\.fill|memory\.init" || true)
if [ "$REMAINING" != "0" ]; then
  echo "FAIL: $REMAINING bulk-memory ops remain; the node will reject this" >&2
  exit 1
fi
echo "ok: $RAW is MVP-clean ($(wc -c < "$RAW") bytes)"
