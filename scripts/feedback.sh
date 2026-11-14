#!/usr/bin/env bash
#
# Appends a dated stub to TEMPLATE_FEEDBACK.md so logging friction with this
# template takes one command, not a remembered format. See that file, and
# AGENTS.md § Self-improving: closing the loop, for what it's for.
#
# Usage: pnpm run feedback "the gate for X fired on a legitimate use of Y"

set -euo pipefail

cd "$(dirname "$0")/.."

summary="${1:-}"
if [ -z "$summary" ]; then
	printf 'usage: pnpm run feedback "one-line summary"\n' >&2
	exit 1
fi

marker='<!-- Newest entries go directly below this line. -->'
entry=$(
	printf '\n## %s — %s\n\nWhat happened, and what you did about it. Link the commit or PR if there\nis one. One sentence on what osseus should probably do differently,\nif anything.\n' \
		"$(date -u +%Y-%m-%d)" "$summary"
)

if ! grep -qF "$marker" TEMPLATE_FEEDBACK.md; then
	printf 'TEMPLATE_FEEDBACK.md is missing its marker line — append by hand instead.\n' >&2
	exit 1
fi

# Insert directly after the marker rather than at end-of-file, so entries
# read newest-first without anyone having to scroll.
awk -v entry="$entry" -v marker="$marker" '
	{ print }
	index($0, marker) { print entry }
' TEMPLATE_FEEDBACK.md > TEMPLATE_FEEDBACK.md.tmp
mv TEMPLATE_FEEDBACK.md.tmp TEMPLATE_FEEDBACK.md

printf 'Added a stub to TEMPLATE_FEEDBACK.md — fill it in and commit it.\n'
