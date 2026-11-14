#!/bin/bash
# Installs the test tooling before the first turn of a Claude Code web
# session, which starts from a bare clone. The app itself needs nothing.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
corepack enable >/dev/null 2>&1 || true
pnpm install
