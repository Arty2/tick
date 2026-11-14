# Template feedback

A log of friction this project hit that the `osseus` skeleton could have
prevented — or where its conventions didn't fit — kept here, in the project that hit it, rather than nowhere,
because a lesson that isn't written down gets rediscovered by the next
person (or the next session) instead of fixed once. See
[AGENTS.md § Self-improving: closing the loop](./AGENTS.md#self-improving-closing-the-loop)
for what happens to these entries.

No
server collects it, nothing is aggregated automatically, and it only ever
says what actually happened in this repository. Committing it means it
travels with the code and shows up in `git log` and code review like any
other change — which is also the point: a reviewer sees _why_ a gate got
loosened or a dependency got added, not just that it did.

## When to add an entry

- A gate in `scripts/gates.sh` fired on something that was actually fine,
  and you turned it off or narrowed it.
- A CSP directive, security header, or the JS budget had to be loosened or
  raised for a real feature, not worked around.
- You wrote something from scratch that the skeleton should have shipped —
  a local-first pattern, an import/export format, a common component.
- You added a dependency to solve a problem this skeleton's "no dependency
  by default" stance made harder than it should have been.
- A gate, a lint rule, or a piece of `AGENTS.md` was simply wrong, confusing,
  or out of date the moment you tried to follow it.

Skip the ordinary stuff — a normal feature, a normal bug fix. This file is
for friction that's specifically about the _skeleton_, not about the app
being built on top of it.

## Format

One entry per finding, newest first, appended below the line. Keep each one
short — a paragraph, not a report:

```
## YYYY-MM-DD — one-line summary

What happened, and what you did about it in this repo. Link the commit or
PR if there is one. One sentence on what osseus itself should probably do
differently, if anything.
```

`pnpm run feedback "one-line summary"` appends a dated stub in this shape
so there's nothing to remember about the format — just fill it in.

**Folded entries are deleted.** Once an entry has been read back into
`osseus` — as a rule, a gate, or a lesson in its `docs/LEARNINGS.md` — it
comes out of this file, so the log only ever holds what hasn't been dealt
with yet. `osseus` keeps its own log the same way: the entries it wrote
about itself are in `docs/LEARNINGS.md` now, and a project templated from it
starts with nothing below the line.

---

<!-- Newest entries go directly below this line. -->

## 2026-11-14 — The CSP allows inline script and style

osseus's policy is `script-src 'self'`, with SvelteKit hashing what is
inline. tick.html is nothing but inline script and style, and a hash in
vercel.json would have to change with every edit, so the header says
`'unsafe-inline'` and keeps the rest strict: third-party hosts limited to the
remote's, no objects, no base, no framing. The defence against injection is
the gate that keeps user text out of `innerHTML`. osseus could ship a
"no build" CSP with this trade-off written down, or a gate that computes the
inline hash.

## 2026-11-14 — A Playwright fixture nobody names never runs

The fixtures that abort off-site requests and fail on console errors were
plain fixtures, so they only ran in tests that happened to name them; most
of the suite ran with the network open and errors unchecked, and review
caught it, not a test. Fixed with `{ auto: true }`. If osseus ever grows a
shared e2e fixture for the same job, it should be auto from the start.

## 2026-11-14 — Long fake-clock runs need fastForward, not runFor

The timer redraws on `requestAnimationFrame`, and Playwright's `page.clock.runFor`
fires every frame in between: a one-minute jump took tens of seconds and hit
the test timeout. `fastForward` jumps and fires each due timer once, which is
all a countdown needs. osseus's e2e notes could say which to reach for.

## 2026-11-14 — The no-injection gate needed an escape hatch for digits

tick wraps colons in spans for the blink, so it sets `innerHTML` from numbers
on every tick. osseus's gate bans `innerHTML` outright. Narrowed here to
`''`, `withColons(...)`, or a line carrying a `safe-markup:` comment that
says why. osseus could ship the narrowed form for apps without a framework
to escape for them.

## 2026-11-14 — One-file apps have no stack layer to swap

tick is a single HTML file with no build, so STACK.md, the bundle budget,
types, lint and unit tests had nothing to attach to. Kept the portable layer
(AGENTS.md, changelog rules, PR template, this log), gates rewritten to read
the shipped file, Playwright against a 30-line static server. The version
lives in a `<meta>` tag because there is no package.json the app reads.
osseus could name "no build" as a supported stack and say what survives.

## 2026-11-14 — "No third-party script origin, ever" has one exception here

Cross-device remote needs a WebRTC broker; PeerJS from cdnjs is loaded only
when the remote opens. Kept, and named in README § What leaves this machine,
with a gate that fails if a contacted host isn't listed there.
