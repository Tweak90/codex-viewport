#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
codex app-server daemon start
docker compose -f compose.gateway.yml up -d --build
