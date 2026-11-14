# Changelog

What /tick gained, newest first, in a few words each. One section per minor
version, headed by the last version it shipped as: a patch rewrites its minor's
heading to the new number and adds its lines there, never a section of its own.
Features only — not fixes, not why, not how; that is the README's. Three lines
to a release, six at the very most. Plain text and `code` spans only.

## 0.3.6 — 2026-11-14

- Live at acari.vercel.app, where a link with settings opens the timer as set.
- The first warning comes 5 minutes before the end of sessions longer than 10 minutes.
- A larger counter that fits any screen, with the version number above it.
- A remote that turns the timer into a kiosk: messages, Black, Prev and Next, codes typed by hand.
- The remote keeps time if the kiosk drops, and a lost kiosk can be replaced.
- Queues written with `|`, and `@14:30` to count down to a time of day.

## 0.2.0 — 2026-11-14

- A named session queue that loads and starts the next slot when time runs out.
- Countdown to a wall-clock time, and a clock mode that keeps the timer running behind it.
- A remote control pad for another tab or device, with operator messages.
- Two warning thresholds, five editable presets, kiosk mode and share links.
- Works offline from a single file, in dark and light.

## 0.1.0 — 2023-03-24

- A shortcut-first countdown timer for streams and webinars, in one HTML file.
