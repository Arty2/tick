# AGENTS.md

Notes for whoever — human or agent — picks this up next. Read it in full
before touching anything; the gates hold it to a line budget so it stays
worth reading. The conventions come from `osseus`, a starter skeleton, with
its stack layer (SvelteKit, Vercel) left behind: this app is one HTML file
with no build, and that is a feature, not a stage it hasn't grown out of.

## What this is

`/tick` is a countdown timer for presentations, streams and stage use.
`tick.html` is the entire app — markup, styles and script in one file that
works from `file://` with no network. Everything else in the repository is
documentation or tooling, and none of it ships.

## Commands

pnpm install · pnpm test · pnpm run gates · pnpm run test:e2e · pnpm run serve
· pnpm run feedback "..."

`pnpm run gates` (`scripts/gates.sh`) checks the rules a test can't see.
`pnpm test` is gates plus the Playwright suite in `tests/`, against
`tick.html` served by `scripts/serve.mjs` — never `file://` and never a
server left running from before.

## Before you change anything

- **One file, no build, no runtime dependency.** Don't add a bundler, a
  framework or a second file the app needs to run. A user saves the page and
  has the whole thing.
- **Works offline is the promise.** The only network calls are the ones the
  remote control makes, and README § What leaves this machine names every
  host; the gates fail when the code contacts one it doesn't. A third-party
  script is the exception that needs the most justification — PeerJS is the
  one there is, loaded only when the remote is opened.
- **The live site is acari.vercel.app**, configured by `vercel.json`. The
  test server applies its headers and redirect, so the suite runs under the
  production CSP; a new resource the app loads needs a directive there and a
  row in README § What leaves this machine.
- **No route from user text to markup.** Labels, queue names and operator
  messages arrive from URLs and from a remote pad; they go in through
  `textContent`. `innerHTML` is for digits only, and the gates enforce it.
- **Evergreen browsers, Baseline "Widely available".** Weigh the failure
  mode, not just the support table: a feature that is invalid at
  computed-value time can blank the display mid-talk.
- **Saved data is migrated, not trusted.** `localStorage` may hold an older
  version's shape, or garbage; loading it must still produce a working
  timer. A write that fails (private window, full quota) shouldn't break
  the timer either.

## Versioning

`<meta name="version">` in `tick.html` is the only copy of the version; the
manual shows it, a test asserts that, and `CHANGELOG.md` heads with it.
Patch for a fix, minor for a feature. **Bump once per session**, sized by
the largest change; once a pull request is open, every further push that
changes `tick.html` bumps the patch. Docs- or tooling-only changes don't
bump. A patch rewrites its minor's heading, never adds a section.

`CHANGELOG.md` is for the person using the timer: features only, a few
words a line, three lines a release and six at most, plain text and `code`
spans. Easter eggs and hidden gestures stay out.

## How we work

- **Tests drive the real page** in Chromium, with a paused clock
  (`freezeAt` in `tests/fixtures.ts`) so a 25-minute countdown takes
  milliseconds and time moves only when a test moves it, and with
  every off-site request aborted so nothing passes because a CDN answered.
  A test fails on any console error.
- **A bug found and not yet fixed is a `test.fail`**, with a comment saying
  what is wrong. Fixing it flips the test and forces the marker off.
- **Verify in a real browser, not just in tests.** Say plainly what was
  checked and what wasn't.
- **The README is the product as a user meets it.** A change to what a user
  can do or see isn't finished until the README — and the in-app manual,
  which repeats the keys — says so, in the same commit.
- **Small commits with real messages**: what changed, why that shape, what
  was verified. No model names in anything that lands in the repo.
- **Pull requests open as drafts.** A draft runs the gates; marking it ready
  for review runs the browser suite too, and that has to pass to merge.
- **Watch a pull request only when asked.**
- **Scratch work stays out of the repository** — screenshots and scripts made
  to check something go in a scratch directory. Read `git status` before
  `git add -A`.
- **Screenshots in `screenshots/` are of the current version.** Retake them
  when the look changes: 1280×720 at 2x, a running session with a queue.
- **Comments explain the why**, and a number in prose is read off the code.

## Closing the loop

`TEMPLATE_FEEDBACK.md` logs where `osseus`'s conventions didn't fit this
project, for someone to fold back into `osseus` later; `pnpm run feedback`
appends a dated stub. `.claude/logs/gates.jsonl` (gitignored, local only)
records every gates run, so a check that never fires can be retired and one
that keeps firing promoted.

## Credits

Dialectic Acheiropoieton of Heracles Papatheodorou and&nbsp;Claude
