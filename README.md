# /tick

A single-file countdown timer for presentations, streams, and stage use.

No install. No build step. No server. Open `tick.html` and go.

- Live: [acari.vercel.app](https://acari.vercel.app)
- Source: [github.com/Arty2/tick](https://github.com/Arty2/tick)

![/tick counting down a 25-minute keynote, with a break and Q&A queued next](./screenshots/ticker-screenshot_01.png)

---

## Quick start

Open [acari.vercel.app](https://acari.vercel.app), or download `tick.html` and open it in any browser. That's it.

Or serve it from anywhere — it's one file with no external dependencies at load time.

---

## What it does

- Counts down from any duration (1–999 min)
- Turns red and counts up in overtime — auto-advances to the next session if one is queued
- Named session queue: label each slot, drag to reorder, loads automatically in sequence
- Countdown to a wall-clock time (defaults to the next :00 or :30)
- Clock/watch mode: shows current time while the timer runs in the background
- Remote control pad: open on any device, control the timer from across the room
- Two configurable warning thresholds with flash sync
- Bell synthesis (no samples) — end-of-session or once per overtime minute
- Five configurable presets
- Kiosk mode: hides all chrome, enters fullscreen, enables WakeLock on desktop
- Share URLs that restore exact timer state
- Dark and light themes

![The same timer in the light theme](./screenshots/ticker-screenshot_02.png)
- Works offline: save the page and open it from disk

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│  00:00 (session elapsed)       HH:MM:SS (clock)     │
│                                                     │
│              STATUS / HINT                          │
│              25:00                                  │
│              Session Title                          │
│              NEXT                                   │
│              ▶ 10:00  Talk                          │
│                                                     │
│  [?]                                          [⋮]  │
└─────────────────────────────────────────────────────┘
```

- **`?`** bottom-left — opens the manual
- **`⋮`** bottom-right — opens the toolbar menu
- Top-bar always visible: session elapsed time (left), wall clock with seconds (right)

---

## Controls

### Mouse / touch

| Action | Effect |
|---|---|
| Click / tap | Start → pause → unpause |
| Tap in overtime | Advance to next session, or reset |
| Double-click / double-tap | Toggle kiosk mode |
| Scroll (while running) | ±1 min |
| Swipe up / down / left / right | +10 / −5 / +1 / −1 min |

### Keyboard

| Key | Action |
|---|---|
| `Enter` | Start / restart |
| `Space` | Start / pause |
| `0–9` | Type minutes, confirm with Enter |
| `Ctrl+Enter` | Skip to next queued session immediately |
| `↑ ↓ ← →` | +10 / −5 / +1 / −1 min |
| `Ctrl+↑ / ↓` | Load previous / next preset |
| `N` | Open queue modal |
| `U` | Open target (countdown-to-clock) modal |
| `W` | Open warning thresholds |
| `Del` / `Backspace` | Edit session label |
| `` ` `` | Ring bell on demand |
| `Insert` | Cycle sound mode |
| `Page Up` | Toggle kiosk |
| `Page Down` | Toggle theme |
| `End` | Reset |
| `Home` | Toggle manual |
| `Tab` | Open toolbar menu |
| `Escape` | Close menu → close modal → exit mode |

---

## Session queue

Open with **N** or click any queue row below the timer.

- **Current session** — sets the label shown below the timer
- **Up next** — a list of named slots (label + minutes); drag to reorder
- When a timer ends, the next slot loads automatically and starts running
- `Ctrl+Enter` skips immediately with a ping
- The label and queue are saved to localStorage

---

## Target mode

Click **target** in the toolbar (or press **U**). Enter a wall-clock time (24h). The timer counts down to that moment. Defaults to the next :00 or :30.

---

## Presets

Five slots in the toolbar. Click to load. Long-press (or right-click) to edit label and duration. Cycle with `Ctrl+↑/↓`.

---

## Remote control

Click **remote** in the toolbar.

A 6-character code and QR code appear. Share the URL or scan the QR on any device to open the remote pad.

The remote pad mirrors the live timer state and provides: start, pause, reset, bell, skip next, ±1/5 min, and a queue editor. Buttons vibrate on mobile.

**Operator message:** type in the host's message field and press Enter. The text flashes on the presenter's screen for 6 seconds.

**Transport note:** same-browser tabs connect instantly via BroadcastChannel. Cross-device requires internet access — the connection is brokered by [peerjs.com](https://peerjs.com) using WebRTC. This may not work on restrictive networks.

---

## URL parameters

All parameters are optional and override saved preferences without overwriting them.

| Param | Values | Effect |
|---|---|---|
| `mins` | `1–999` | Starting duration in minutes |
| `label` | text | Session label (URL-encoded) |
| `next` | `Title:25,10` | Queue — `Label:mins` or plain `mins`, comma-separated |
| `theme` | `dark` \| `light` | Force theme |
| `sound` | `0` \| `1` \| `2` | Off / end-bell / per-minute bell |
| `rc` | `XXXXXX` | Open as remote pad for this room code |

Example:
```
tick.html?mins=25&label=Keynote&next=Break:5,QA:10&theme=dark&sound=1
```

---

## Kiosk mode

Double-click, double-tap, or press `Page Up`. On desktop, enters real fullscreen and enables WakeLock (screen stays on). On iOS the browser bar remains — this is a platform limitation.

The top-bar stays visible in kiosk with session elapsed time and the current clock. All other chrome is hidden.

Exit: double-click, double-tap, or `Escape`.

---

## Sound

Three modes cycled with the **sound** button or `Insert`:

- **Off**
- **End bell** — one bell when the timer hits zero
- **Per minute** — one bell each overtime minute

Bells are synthesised from additive harmonics — no audio samples, works offline.

Ring on demand with `` ` `` or long-press the sound button.

---

## Colours

| Colour | Meaning |
|---|---|
| Grey | Idle |
| White | Running |
| Orange | Warning (flashes at second threshold) |
| Amber | Paused |
| Red | Overtime |
| Green | Reset |
| Purple | Next session loaded / queue |
| Blue | Target (countdown to clock time) |
| Teal | Clock / watch mode |

---

## Offline

The app works from `file://` with no network: save `tick.html` and open it from disk. Served from a web host it is an ordinary page, so it needs the connection to load; there is no service worker, because it would have to be a second file. It can still be added to a phone's home screen, where it opens without the browser bar.

---

## What leaves this machine

Nothing, until you open the remote control. The timer, queue, presets and settings live in this browser's `localStorage` and are never sent anywhere.

Clicking **remote** makes these requests, and only these:

| Host | What for |
|---|---|
| `api.qrserver.com` | Draws the QR code. The remote URL (with its room code) is sent to it. Skipped when offline; the URL is shown as text instead. |
| `cdn.jsdelivr.net` | Downloads the PeerJS library for cross-device remote, checked against a pinned hash. |
| `0.peerjs.com` | PeerJS's public broker, which introduces the two devices to each other. |
| `stun.l.google.com`, `stun1.l.google.com` | STUN servers that help the two devices find a direct route. |

After that, timer state and commands travel directly between the two devices over WebRTC. Two tabs in the same browser use `BroadcastChannel` and need none of the above.

---

## Limitations

- **iOS fullscreen**: not available in Safari; kiosk is CSS-only
- **Remote cross-device**: requires internet and peerjs.com to be reachable
- **QR code**: fetched from api.qrserver.com; falls back to plain text URL when offline

---

## Development

The app is `tick.html` and needs nothing else. The tests do:

```
pnpm install
pnpm test          # gates, then the browser suite against tick.html
pnpm run serve     # http://localhost:4173, the way a web host serves it
```

| Version change | When |
|---|---|
| Patch (`0.2.1` → `0.2.2`) | A fix |
| Minor (`0.2.1` → `0.3.0`) | A feature |
| Leading zero | Moves only by a deliberate decision to call it finished |

The version lives in one place, `<meta name="version">` in `tick.html`; the manual shows it and [CHANGELOG.md](./CHANGELOG.md) heads with it. How to work on this repository is in [AGENTS.md](./AGENTS.md).

| File | Purpose |
|---|---|
| `tick.html` | The entire app |
| `README.md` | This file |
| `CHANGELOG.md` | What each version added |
| `AGENTS.md` | How to work on this repository, for people and agents |
| `tests/` | Browser tests (Playwright) |
| `scripts/` | The gates, a test server, the feedback stub |
| `vercel.json` | How the live site is built, redirected and secured |

---

## Deployment

[acari.vercel.app](https://acari.vercel.app) is built by Vercel from `vercel.json`: no install, and the build copies `tick.html` alone into the site, so the tests and docs aren't published. The bare domain redirects to `/tick.html`, carrying any query string with it, so `https://acari.vercel.app/?mins=25` opens a 25-minute timer. Every response carries the security headers in `vercel.json`, including a Content-Security-Policy that allows only the remote control's hosts listed above. Pushes that don't touch `tick.html` or `vercel.json` don't redeploy.

---

## Credit and licence

Dialectic Acheiropoieton of Heracles Papatheodorou and Claude.

MIT licence — see [LICENSE](./LICENSE).
