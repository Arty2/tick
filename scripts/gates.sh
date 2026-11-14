#!/usr/bin/env bash
#
# Rules a test can't see, checked before the browser suite runs. Adapted
# from osseus's gates for an app that is one HTML file with no build: every
# check reads tick.html as shipped, because there is nothing else to read.
#
# Searches are scoped to tick.html (and the docs they compare it with), never
# to scripts/, because this file necessarily contains the strings it looks for.
#
# Every run appends one line to .claude/logs/gates.jsonl — gitignored, never
# leaves this machine. A check that never fires is a candidate to retire; a
# rule explained twice in review is a candidate to add here.

set -uo pipefail
cd "$(dirname "$0")/.."

APP="${APP:-tick.html}"
status=0
checks=()

fail() {
	status=1
	checks+=("{\"name\":\"$3\",\"pass\":false}")
	printf '  FAIL  %s\n' "$1"
	printf '%s\n' "$2" | sed 's/^/        /'
}
pass() {
	checks+=("{\"name\":\"$2\",\"pass\":true}")
	printf '    ok  %s\n' "$1"
}

# A check that cannot run must fail, not pass.
if [ ! -r "$APP" ]; then
	fail "$APP is missing or unreadable" "every other check reads it" "app-readable"
	APP=/dev/null
fi

# The script half of the file, where the sinks and the network calls live.
script=$(awk '/<script>/{on=1} on{printf "%d:%s\n", NR, $0} /<\/script>/{on=0}' "$APP")

# ── 1. No route from a string to script, and markup only from numbers ────────
# eval and friends have no business here at all. innerHTML is used to wrap
# colons in spans for the blink, which is safe only because what it wraps is
# digits; so an assignment must be '' or go through withColons(), and anything
# else needs a `safe-markup:` comment on the line saying why it is safe.
# Labels, queue names and operator messages are user text and must stay
# textContent — a remote pad can send them.
hard=$(printf '%s\n' "$script" | grep -nE 'eval\(|new Function\(|document\.write|outerHTML|insertAdjacentHTML' | cut -d: -f2-)
soft=$(printf '%s\n' "$script" | grep -E 'innerHTML[[:space:]]*=' \
	| grep -vE "innerHTML[[:space:]]*=[[:space:]]*'';|innerHTML[[:space:]]*=[[:space:]]*withColons\(|safe-markup:")
if [ -n "$hard$soft" ]; then
	fail "markup or script sink in $APP" "$hard$soft" "no-injection-sinks"
else
	pass "no script sinks; innerHTML only for digits" "no-injection-sinks"
fi

# ── 2. Every host the app contacts is named in the README ────────────────────
# "Works offline" is only honest if the README lists what doesn't. A new
# third-party call fails here until README § What leaves this machine says
# what it is and what a user did to cause it.
hosts=$(printf '%s\n' "$script" | grep -oE '(https?|stun|turn)s?:(//)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
	| sed -E 's#^[a-z]+:(//)?##' | sort -u)
unnamed=""
for h in $hosts; do
	grep -qF "$h" README.md || unnamed="$unnamed $h"
done
if [ -z "$hosts" ] && [ "$APP" = /dev/null ]; then
	fail "could not look for hosts" "$APP unreadable" "network-hosts-documented"
elif [ -n "$unnamed" ]; then
	fail "hosts $APP contacts that README.md doesn't name" "$(echo "$unnamed" | xargs)" "network-hosts-documented"
else
	pass "every contacted host is named in README.md ($(echo "$hosts" | wc -w | tr -d ' '))" "network-hosts-documented"
fi

# ── 3. The changelog heads with the version tick.html declares ───────────────
# <meta name="version"> is the only copy of the number; the manual shows it.
CHANGELOG="${CHANGELOG:-CHANGELOG.md}"
heading_re='^## ([0-9]+\.[0-9]+\.[0-9]+) (—|–|-) ([0-9]{4}-[0-9]{2}-[0-9]{2})[[:space:]]*$'
version=$(sed -nE 's/.*<meta name="version" content="([0-9]+\.[0-9]+\.[0-9]+)">.*/\1/p' "$APP" | head -n 1)
if [ -z "$version" ]; then
	fail "no <meta name=\"version\" content=\"X.Y.Z\"> in $APP" "" "changelog-heads-with-version"
elif [ ! -r "$CHANGELOG" ]; then
	fail "$CHANGELOG is missing" "start it with '## $version — $(date -u +%Y-%m-%d)'" "changelog-heads-with-version"
else
	malformed=$(grep -n '^## ' "$CHANGELOG" | grep -vE "^[0-9]+:${heading_re#^}")
	top=$(sed -nE "s/${heading_re}/\1/p" "$CHANGELOG" | head -n 1)
	if [ -n "$malformed" ]; then
		fail "$CHANGELOG has a malformed heading" "$malformed
headings are '## X.Y.Z — YYYY-MM-DD'" "changelog-heads-with-version"
	elif [ "$top" != "$version" ]; then
		fail "$CHANGELOG does not open with $version" "top heading is '${top:-none}'" "changelog-heads-with-version"
	else
		pass "$CHANGELOG opens with $version" "changelog-heads-with-version"
	fi
fi

# ── 4. Each release is short and plain ───────────────────────────────────────
# Overridable to test the failure path: CHANGELOG_MAX=1 pnpm run gates.
CHANGELOG_MAX="${CHANGELOG_MAX:-6}"
if [ -r "$CHANGELOG" ]; then
	long=$(awk -v max="$CHANGELOG_MAX" '
		/^## / { if (name != "" && len > max) printf "%s — %d lines\n", name, len; name = $0; len = 0; next }
		name != "" && $0 !~ /^[[:space:]]*$/ { len++ }
		END { if (name != "" && len > max) printf "%s — %d lines\n", name, len }
	' "$CHANGELOG")
	markup=$(awk '/^## / { r = 1; next } r && (/\*\*/ || /\[[^]]*\]\(/ || /^[[:space:]]*#/) { printf "%d: %s\n", NR, $0 }' "$CHANGELOG")
	if [ -n "$long$markup" ]; then
		fail "a release in $CHANGELOG is over $CHANGELOG_MAX lines or has markup" "$long$markup" "changelog-releases-short-and-plain"
	else
		pass "every release is $CHANGELOG_MAX lines or fewer, plain text" "changelog-releases-short-and-plain"
	fi
else
	fail "$CHANGELOG is missing" "see above" "changelog-releases-short-and-plain"
fi

# ── 5. The instructions stay short ───────────────────────────────────────────
# Read in full every session; a long one gets skimmed. Raise on purpose.
AGENTS_MAX="${AGENTS_MAX:-120}"
if [ ! -r AGENTS.md ]; then
	fail "AGENTS.md is missing or unreadable" "" "instructions-file-budget"
else
	n=$(wc -l < AGENTS.md | tr -d ' ')
	if [ "$n" -gt "$AGENTS_MAX" ]; then
		fail "AGENTS.md is $n lines (budget $AGENTS_MAX)" "move detail elsewhere, or raise AGENTS_MAX on purpose" "instructions-file-budget"
	else
		pass "AGENTS.md is $n lines (budget $AGENTS_MAX)" "instructions-file-budget"
	fi
fi

mkdir -p .claude/logs
joined=$(IFS=,; echo "${checks[*]}")
printf '{"ts":"%s","sha":"%s","status":"%s","checks":[%s]}\n' \
	"$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
	"$([ "$status" -eq 0 ] && echo pass || echo fail)" "$joined" >> .claude/logs/gates.jsonl

[ "$status" -ne 0 ] && printf '\ngates failed\n'
exit "$status"
