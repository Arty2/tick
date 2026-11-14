#!/usr/bin/env bash
#
# Rules a test can't see, checked before the browser suite runs. Adapted
# from osseus's gates for an app with no build: every check reads app/ as
# shipped, because what is in that folder is what a visitor gets.
#
# Searches are scoped to app/ (and the docs they compare it with), never to
# scripts/, because this file necessarily contains the strings it looks for.
# vendor/ is someone else's code, pinned by hash below and otherwise left out.
#
# Every run appends one line to .claude/logs/gates.jsonl — gitignored, never
# leaves this machine. A check that never fires is a candidate to retire; a
# rule explained twice in review is a candidate to add here.

set -uo pipefail
cd "$(dirname "$0")/.."

APP="${APP:-app}"
PAGE="$APP/index.html"
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
if [ ! -r "$PAGE" ]; then
	fail "$PAGE is missing or unreadable" "every other check reads it" "app-readable"
	PAGE=/dev/null
fi

# The app's own script, where the sinks and the network calls live: every
# module, each line prefixed with its file and line number.
script=$(find "$APP/js" "$APP/sw.js" -name '*.js' 2>/dev/null | sort | xargs grep -n '' /dev/null 2>/dev/null)

# ── 1. No route from a string to script, and markup only from numbers ────────
# eval and friends have no business here at all. innerHTML is used to wrap
# colons in spans for the blink, which is safe only because what it wraps is
# digits; so an assignment must be '' or go through withColons(), and anything
# else needs a `safe-markup:` comment on the line saying why it is safe.
# Labels, queue names and operator messages are user text and must stay
# textContent — a remote pad can send them.
hard=$(printf '%s\n' "$script" | grep -E 'eval\(|new Function\(|document\.write|outerHTML|insertAdjacentHTML')
# No script in the page itself either: the Content-Security-Policy refuses it.
inline=$(grep -nE '<script(>| [^>]*>)[^<]' "$PAGE"; grep -nE '<[^>]+ on[a-z]+=' "$PAGE")
soft=$(printf '%s\n' "$script" | grep -E 'innerHTML[[:space:]]*=' \
	| grep -vE "innerHTML[[:space:]]*=[[:space:]]*'';|innerHTML[[:space:]]*=[[:space:]]*withColons\(|safe-markup:")
if [ -n "$hard$soft$inline" ]; then
	fail "markup or script sink in $APP" "$hard$soft$inline" "no-injection-sinks"
else
	pass "no script sinks; innerHTML only for digits" "no-injection-sinks"
fi

# ── 2. Every host the app contacts is named in the README ────────────────────
# "Works offline" is only honest if the README lists what doesn't. A new
# third-party call fails here until README § External services says
# what it is and what a user did to cause it.
hosts=$(printf '%s\n' "$script" | grep -oE '(https?|stun|turn)s?:(//)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
	| sed -E 's#^[a-z]+:(//)?##' | sort -u | grep -vx 'www.w3.org')
# (www.w3.org is the SVG namespace the QR code is drawn in: a name, never fetched.)
unnamed=""
for h in $hosts; do
	grep -qF "$h" README.md || unnamed="$unnamed $h"
done
if [ -z "$script" ]; then
	fail "could not look for hosts" "no script found under $APP" "network-hosts-documented"
elif [ -n "$unnamed" ]; then
	fail "hosts $APP contacts that README.md doesn't name" "$(echo "$unnamed" | xargs)" "network-hosts-documented"
else
	pass "every contacted host is named in README.md ($(echo "$hosts" | wc -w | tr -d ' '))" "network-hosts-documented"
fi

# ── 3. Third-party code ships with the app, pinned by hash ───────────────────
# PeerJS (for cross-device remote) runs with the page's full authority. It is
# served from vendor/, not from a CDN, and must be the published file byte
# for byte: the hash below is that of peerjs@1.5.4's dist/peerjs.min.js, the
# same one the CDN copy was once pinned to. Nothing is downloaded to check it.
PEERJS_SHA384="nlUQ8ZqCbvStErob+biJNzSgltf6urV3VGqhfIfzhmg9RXmpeRm76ELw0pYnKlTR"
vendor_bad=""
got=$(openssl dgst -sha384 -binary "$APP/vendor/peerjs.min.js" 2>/dev/null | openssl base64 -A)
[ "$got" = "$PEERJS_SHA384" ] || vendor_bad="vendor/peerjs.min.js is not peerjs@1.5.4 (sha384-$got)"
unknown=$(find "$APP/vendor" -type f ! -name 'peerjs.min.js' ! -name 'peerjs.LICENSE' 2>/dev/null)
[ -z "$unknown" ] || vendor_bad="$vendor_bad
unpinned vendor file: $unknown"
remote_src=$(printf '%s\n' "$script" | grep -E "(src|href)[[:space:]]*=[[:space:]]*['\"\`]https?://"; grep -nE '(src|href)="https?://[^"]*\.(js|css)' "$PAGE")
[ -z "$remote_src" ] || vendor_bad="$vendor_bad
script or style loaded from another host: $remote_src"
if [ -n "$vendor_bad" ]; then
	fail "third-party code is not what was pinned" "$vendor_bad" "third-party-code-pinned"
else
	pass "vendored PeerJS matches its pinned hash; nothing loads from another host" "third-party-code-pinned"
fi

# ── 4. The changelog heads with the version the app declares ─────────────────
# <meta name="version"> in index.html is the number; the manual shows it.
CHANGELOG="${CHANGELOG:-CHANGELOG.md}"
heading_re='^## ([0-9]+\.[0-9]+\.[0-9]+) (—|–|-) ([0-9]{4}-[0-9]{2}-[0-9]{2})[[:space:]]*$'
version=$(sed -nE 's/.*<meta name="version" content="([0-9]+\.[0-9]+\.[0-9]+)">.*/\1/p' "$PAGE" | head -n 1)
if [ -z "$version" ]; then
	fail "no <meta name=\"version\" content=\"X.Y.Z\"> in $PAGE" "" "changelog-heads-with-version"
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

# ── 5. Each release is short and plain ───────────────────────────────────────
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

# ── 6. The instructions stay short ───────────────────────────────────────────
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

# ── 7. The live site keeps its security headers and publishes app/ ───────────
# A generic edit to vercel.json (a new redirect, a cache rule) is an easy
# place to lose the headers block. The tests apply the same file, so they'd
# still pass.
missing=""
for key in Strict-Transport-Security X-Content-Type-Options X-Frame-Options Content-Security-Policy; do
	grep -q "\"$key\"" vercel.json 2>/dev/null || missing="$missing $key"
done
grep -q "\"outputDirectory\": \"$APP\"" vercel.json 2>/dev/null || missing="$missing outputDirectory-$APP"
grep -q "script-src 'self';" vercel.json 2>/dev/null || missing="$missing script-src-self-only"
if [ -n "$missing" ]; then
	fail "vercel.json is missing what the live site needs" "$(echo "$missing" | xargs)" "vercel-headers-and-output"
else
	pass "vercel.json has the security headers and publishes $APP/" "vercel-headers-and-output"
fi

# ── 8. The service worker keeps a copy of the whole app, at this version ─────
# Offline is the promise, and the worker delivers it from a list of files
# written by hand in sw.js. A file added to app/ and not to the list works
# online and is missing on stage. And its VERSION names the cache: left
# behind, visitors keep the old app.
if [ ! -r "$APP/sw.js" ]; then
	fail "$APP/sw.js is missing" "" "service-worker-covers-the-app"
else
	listed=$(sed -n '/^const FILES = \[/,/^\];/p' "$APP/sw.js" | grep -oE "'[^']+'" | tr -d "'" | sed 's#^\./$#index.html#' | sort)
	# What ships and is needed to run: everything but the worker itself and licence texts.
	shipped=$(cd "$APP" && find . -type f ! -name 'sw.js' ! -name '*.LICENSE' ! -name '.DS_Store' | sed 's#^\./##' | sort)
	diff_out=$(diff <(printf '%s\n' "$listed") <(printf '%s\n' "$shipped") | grep '^[<>]' | sed 's/^</listed, not in app\/:/; s/^>/in app\/, not listed:/')
	sw_version=$(sed -nE "s/^const VERSION = '([0-9]+\.[0-9]+\.[0-9]+)';.*/\1/p" "$APP/sw.js" | head -n 1)
	[ "$sw_version" = "$version" ] || diff_out="$diff_out
sw.js VERSION is '${sw_version:-none}', index.html says '${version:-none}'"
	if [ -n "$diff_out" ]; then
		fail "sw.js does not match the app it caches" "$diff_out" "service-worker-covers-the-app"
	else
		pass "sw.js lists every file in $APP/ ($(printf '%s\n' "$shipped" | wc -l | tr -d ' ')) at version $version" "service-worker-covers-the-app"
	fi
fi

mkdir -p .claude/logs
joined=$(IFS=,; echo "${checks[*]}")
printf '{"ts":"%s","sha":"%s","status":"%s","checks":[%s]}\n' \
	"$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
	"$([ "$status" -eq 0 ] && echo pass || echo fail)" "$joined" >> .claude/logs/gates.jsonl

[ "$status" -ne 0 ] && printf '\ngates failed\n'
exit "$status"
