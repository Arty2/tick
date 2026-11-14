# AGENTS.md

Notes for whoever — human or agent — picks this up next. Read it in full
before touching anything; the gates hold it to a line budget so it stays
worth reading. The conventions come from `osseus`, a starter skeleton, with
its stack layer (SvelteKit) left behind: this app is a folder of plain files
with no build, and that is a feature, not a stage it hasn't grown out of.

## What this is

Acari is a countdown timer for presentations, streams and stage use, the
successor to `/tick` (the repository and some internal names keep `tick`).
`app/` is the entire app, and everything in it ships: `index.html` (markup
and the manual), `tick.css`, ES modules in `js/` (`main` picks `timer` or
`pad`; `transport`, `queue`, `qr`, `util` serve both), a manifest, icons, a
service worker, and PeerJS in `vendor/`. Everything outside `app/` is
documentation or tooling, and none of it ships.

## Commands

pnpm install · pnpm test · pnpm run gates · pnpm run test:e2e · pnpm run serve
· pnpm run feedback "..."

`pnpm run gates` (`scripts/gates.sh`) checks the rules a test can't see.
`pnpm test` is gates plus the Playwright suite in `tests/`, against `app/`
served by `scripts/serve.mjs` — never a server left running from before.

## Before you change anything

- **No build, no runtime dependency.** Don't add a bundler, a framework or
  a package the app imports. What is in `app/` is what the browser runs;
  a module is a file someone can read.
- **Works offline is the promise**, kept by `app/sw.js`, which caches the
  files it lists. A file added to `app/` goes in that list, and its
  `VERSION` follows the page's; the gates fail on either. The settings in a
  link go after `#`, never `?`, so they aren't sent to the server.
- **Nothing loads from another host.** The only network calls are the ones
  the remote control makes, and README § External services names every
  host; the gates fail when the code contacts one it doesn't. Third-party
  code needs the most justification — PeerJS is the one there is, vendored
  byte for byte, pinned by hash in the gates, loaded when a session starts.
- **The live site is acari.vercel.app**, which publishes `app/` as
  `vercel.json` says. The test server applies its headers, so the suite
  runs under the production CSP: scripts from this origin only, none inline.
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

`<meta name="version">` in `app/index.html` is the version; the manual shows
it, a test asserts that, `CHANGELOG.md` heads with it, and `app/sw.js`
repeats it (gated) to name its cache. Patch for a fix, minor for a feature.
**Bump once per session**, sized by the largest change; once a pull request
is open, every further push that changes `app/` bumps the patch. Docs- or tooling-only changes don't
bump. A patch rewrites its minor's heading, never adds a section.

`CHANGELOG.md` is for the person using the timer: features only, a few
words a line, three lines a release and six at most, plain text and `code`
spans. Easter eggs and hidden gestures stay out.

## How we work

- **Tests drive the real page** in Chromium, with a paused clock
  (`freezeAt` in `tests/fixtures.ts`) so a 25-minute countdown takes
  milliseconds and time moves only when a test moves it, and with
  every off-site request aborted so nothing passes because a CDN answered.
  A test fails on any console error. Open pages with `open` or `visit`,
  which wait for the app to start; the load event comes before it has.
- **Pure modules are tested without a browser**, against static data:
  `tests/qr.spec.ts` holds reference codes; no library is fetched to check.
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
