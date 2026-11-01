#!/bin/sh
set -eu
cd "$(dirname "$0")"
node test-manager.cjs
node test-features.cjs
node test-composite-join.cjs
node test-window.mjs
node test-autoload.mjs
node test-tk-first-persistent.cjs
