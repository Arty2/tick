# Acari

**Acari** is a countdown timer that runs in a web browser. It is the successor to [/tick](https://heracl.es/tick), the single-file timer it grew out of. People use it to keep time during talks, live streams, meetings and stage events. It needs nothing but a browser. It can be installed like an app, and once it has been opened it works without an internet connection.

- Live version: [acari.vercel.app](https://acari.vercel.app)
- Source code: [github.com/Arty2/tick](https://github.com/Arty2/tick)
- Its predecessor, /tick: [heracl.es/tick](https://heracl.es/tick)

![Acari showing 09:59 left in a keynote, with a break and a Q&A session waiting next](./screenshots/ticker-screenshot_01.png)

---

## Starting

Open [acari.vercel.app](https://acari.vercel.app) in a browser. Nothing else is needed.

- To keep Acari on a device, choose **install** in the menu. See [Installing and working offline](#installing-and-working-offline).
- To host a copy, put the contents of the `app` folder on any web server. There is nothing to build.

---

## Features

- Counts down from any length between 1 and 999 minutes.
- After the time runs out, the numbers turn red and count up. This is called **overtime**.
- Keeps a **queue**: a list of sessions, each with a name and a length. When one session ends, the next one starts by itself.
- Can count down to a time of day, such as 14:30.
- Has a **clock mode** that shows the time of day while the timer keeps running.
- Can be controlled from a phone or another computer (**remote control**), by several remotes at once, and shown on several screens.
- Changes colour at two warning points before the end. For sessions longer than 10 minutes, the first warning comes 5 minutes before the end.
- Can ring a bell. The bell sound is made by the program, not played from a recording.
- Has five **presets**: saved lengths that load with one click.
- Has a **kiosk mode** that hides everything except the time.
- Can make a link that opens the same timer on another device.
- Can be installed, and works offline.
- Has a dark theme and a light theme.

![The same timer in the light theme](./screenshots/ticker-screenshot_02.png)

---

## Screen layout

```
┌─────────────────────────────────────────────────────┐
│  00:00 (since start)   v0.4.0   HH:MM:SS (clock)    │
│                                                     │
│              STATUS                                 │
│              25:00                                  │
│              Session name                           │
│              NEXT                                   │
│              ▶ 10:00  Talk                          │
│                                                     │
│  [?]                                          [⋮]   │
└─────────────────────────────────────────────────────┘
```

- The top left shows how long the timer has been running since it was first started.
- The top middle shows the version number. It is hidden in kiosk mode.
- The top right shows the time of day.
- The **?** button (bottom left) opens the manual.
- The **⋮** button (bottom right) opens the menu.

---

## Controls

### Mouse and touch

| Action | What it does |
|---|---|
| Click or tap | Starts the timer. Another click pauses it, and another starts it again. |
| Click or tap in overtime | Loads the next session in the queue. If the queue is empty, it resets the timer. |
| Tap the queue under the timer | Opens the queue. |
| Double-click or double-tap | Turns kiosk mode on or off. |
| Mouse wheel (while running) | Adds or takes away 1 minute. |
| Swipe up, down, left, right (while running) | Adds 10, takes away 5, adds 1, or takes away 1 minute. |

### Keyboard

| Key | What it does |
|---|---|
| `Enter` | Starts again from the starting length. |
| `Space` | Starts or pauses. In overtime, loads the next session, or starts again. |
| `0`–`9`, then `Enter` | Sets the length in minutes. For example, `2`, `5`, `Enter` sets 25 minutes. |
| `Ctrl+Enter` | Loads the next session in the queue now. It waits until it is started. |
| `↑` `↓` `←` `→` | Adds 10, takes away 5, adds 1, or takes away 1 minute. |
| `Ctrl+↑`, `Ctrl+↓` | Loads the previous or next preset. |
| `N` | Opens the queue. |
| `U` | Opens the target time (counting down to a time of day). |
| `W` | Opens the warning settings. |
| `Delete` or `Backspace` | Changes the session name. `Enter` saves it. |
| `` ` `` | Rings the bell. |
| `Insert` | Turns the bell at the end on or off. |
| `Page Up` | Turns kiosk mode on or off. |
| `Page Down` | Changes between the dark and light themes. |
| `End` | Resets the timer. |
| `Home` | Opens or closes the manual. |
| `Tab` | Opens the menu. |
| `Escape` | Closes the menu or a window. If none is open, it leaves target time, clock mode or kiosk mode. |

The keys only change the timer when no text box is being typed in.

---

## Queue

The queue is a list of sessions that run one after another. To open it, press `N`, choose **queue** in the menu, or click the list under the timer.

- **Current session** is the name shown under the timer.
- **Up next** is the list of sessions. Each one has a name and a length in minutes, or a time of day written `>14:30`, which makes that session count down to 14:30. **+ Add** adds a session, **×** removes one, and dragging a row changes the order.
- When a session ends, the next one loads and starts by itself. A short sound plays.
- The queue and the session name are saved in the browser. They are still there the next time Acari is opened.

### Writing a queue

A queue can also be written as text: in a link, or in the queue box on the remote pad. Sessions are separated by `|` (a vertical bar), and each session is one of these:

| Written | Means |
|---|---|
| `Talk@25` | A session called Talk, 25 minutes long |
| `25` | A 25-minute session with no name |
| `Panel>14:30` | A session called Panel that counts down to 14:30 (the next 14:30, which may be tomorrow) |
| `>14:30` | A countdown to 14:30 with no name |

For example, `Keynote@40|Break@5|Q&A, panel: part 2@15|Lunch>12:30`. Names may contain commas and colons. A `|` inside a name is written `\|`.

In the list under the timer, a session with a length shows a triangle, its length and its name. A session that counts down to a time of day shows that time, a triangle with a bar, the time left until then, and its name.

---

## Target time

The **target** button (or `U`) makes the timer count down to a time of day. The time is written in the 24-hour clock, such as 14:30. The box first shows the next full or half hour. If the time has already passed today, the timer counts down to that time tomorrow.

---

## Presets

The menu has five preset buttons. Clicking one loads its length. Holding a preset down, or right-clicking it, opens a box to change its name and length. An empty preset shows **+**. At first, the presets are 5, 10 and 25 minutes.

Holding down the **reset** button for about one second removes everything Acari has saved: presets, queue, settings and the session name.

---

## Warnings

The timer changes colour before the end, at two points:

- At the **first warning** the numbers turn orange. This is 2 minutes before the end. For a session longer than 10 minutes, it is 5 minutes before the end.
- At the **second warning** the numbers also flash. This is 1 minute before the end at first.

The **warn** button (or `W`) changes these points. They are set in seconds. Setting one to `0` turns it off. If the first warning's box is left empty, it goes back to 2 or 5 minutes, as above.

---

## Remote control

The remote control lets other devices start, pause and change the timer, and lets the timer show on more than one screen.

1. Choose **remote** in the menu. A code of six letters and numbers appears, with a QR code. Acari draws the QR code itself; no internet is needed for it.
2. On the other device, scan the QR code. Without a camera, open Acari on that device, choose **remote**, then **Join**, type the code and choose **Remote**.
3. The other device now shows a **remote pad**, and the timer screen changes to kiosk mode. It stays in kiosk mode if the remote pad disconnects.

While a session is on, the menu's button reads **remote: waiting** until a remote pad connects, and **remote: connected** after. **Stop** in the remote window ends the session.

### The remote pad

The remote pad's top bar shows the connection, the timer's code and a small QR code. Typing another code into the bar and pressing Enter switches the pad to that timer. Under the top bar, the remote pad shows the same line as the timer screen: the time since the session started on the left, and the time of day on the right. Below that it shows the time left, the session name and the queue. All of this sits in a frame, as a small picture of the timer screen. The pad keeps its own screen from going dark while it is open.

Its buttons reset, start or pause (one button, which changes between the two), ring the bell, load the next or the previous session, and add or take away time.

- **Start** is green. It becomes an amber **Pause** while the timer runs.
- Before the timer has been started, the minute buttons (**−1m**, **+1m**, **−5m**, **+10m**) change the length it will count down from, and **Reset** is greyed out, because there is nothing to reset. While the timer runs, the minute buttons change the time left. While it is paused, they are greyed out.
- **Prev** goes back to the session that ran before and puts the current one back at the front of the queue; it is greyed out until a session has handed over to the next.
- **Black** covers the whole timer screen in the theme's background colour (black in the dark theme, white in the light one). The timer keeps running underneath, and changes made from the remote pad don't show until **Black** is pressed again. The button is lit while the screen is covered. On the timer screen itself, `Escape`, a double tap or a double-click also lifts the cover, so it can be lifted without the remote or a keyboard; single taps and clicks on the cover do nothing.
- The queue box shows the current queue, written as described in [Writing a queue](#writing-a-queue), such as `Talk@25|QA>14:30`. Changing it and pressing **Set** changes the queue; emptying it and pressing **Set** clears the queue.

On phones, the buttons vibrate when pressed.

The remote pad has a message box. A message typed there appears on the timer screen for 6 seconds, in large dark letters on an orange band above the time. The time gets smaller while the message shows, so both can be read. It can tell the speaker, for example, to finish soon. While the message is up, the pad shows it too, inside the frame above the time. **Send** is greyed out until something is typed, and then turns orange; **Clear** removes the message sooner, and is greyed out when there is nothing to clear.

### Several remotes

Any number of remote pads can join the same code, and all of them control the timer. When there are others, a pad shows how many right after **Connected** in its top bar: **+1** means one other remote pad is connected, **+2** two, and so on. The remote window on the timer screen counts them too.

### Several kiosks

A timer can show on more than one screen. To add a screen, press the small QR code at the top right of a remote pad and open its link, or scan the large QR code it shows, on the new screen. Or, on the new screen, open Acari, choose **remote**, then **Join**, type the code and choose **Kiosk**.

The first kiosk holds the timer. Every other kiosk is **read only**: it shows the first kiosk's time, queue, messages and **Black**, counts by its own clock between updates, and takes no clicks or keys. Its top line says **read only**. This is the same for another tab in the same browser and for another device. On a read-only kiosk, a double-click or double tap fills the screen, and `Escape` stops following and makes the page an ordinary timer again.

### When a kiosk is lost

If the first kiosk stops answering for a few seconds, the remote pad says **Kiosk lost**. The timer does not stop:

- A read-only kiosk, if there is one, takes over after a few more seconds and becomes the kiosk that holds the timer.
- If there is none, the small QR code on the remote pad gives a link for a new kiosk, which takes over the same code.
- Meanwhile the remote pad keeps counting on its own, and its buttons (start, pause, the minute buttons, reset, Next and the queue box) work on the pad's copy; the time is underlined with dots while this is so. When a kiosk answers again, the pad's timer is sent to it and replaces the kiosk's, because the pad kept going while the kiosk was out of touch. There is one exception: if the remote pad itself went offline, it says **Offline**, and when it is back it takes the kiosk's timer instead.

### What needs the internet

Tabs in the same browser connect straight away, without the internet. Different devices need the internet to find each other. They are introduced by a free service called [PeerJS](https://peerjs.com), and then talk to each other directly. This may not work on some school or office networks. Finding devices on the same network without any outside service is not possible for a web page: browsers do not let pages search the local network, and two pages can only be introduced by a server both can reach.

---

## Links that set up the timer

A link to Acari can include settings after a `#`. These settings are used for that visit only. They do not replace the settings saved in the browser. Because they follow a `#`, the browser keeps them to itself: they are not sent to the server that the page comes from.

| Setting | Values | What it does |
|---|---|---|
| `mins` | `1`–`999` | The starting length in minutes. |
| `label` | text | The session name. |
| `next` | `Break@5\|QA>14:30` | The queue, written as described in [Writing a queue](#writing-a-queue): sessions separated by `\|`, each `name@minutes`, minutes alone, or `name>HH:MM`. |
| `theme` | `dark` or `light` | The theme. |
| `sound` | `0` or `1` | The bell when the time runs out: off or on. |
| `remote` | a six-letter code | Opens the remote pad for that code. The **remote** button makes these links. |
| `kiosk` | a six-letter code | Opens a kiosk for that code. It is read only while another kiosk holds the timer, and takes the timer over if none does. The small QR code on the remote pad makes these links. |

For example, this link opens a 25-minute keynote with a break and questions after it:

```
https://acari.vercel.app/#mins=25&label=Keynote&next=Break@5|QA@10&theme=dark&sound=1
```

The **share** button opens the device's own share window with a link like this for the timer as it is now, so it can be sent with any app on the device. In a browser with no share window, the link is copied instead.

---

## Kiosk mode

Kiosk mode hides the buttons and the menu, so that only the time and the top line are shown. It is turned on with a double-click, a double-tap, `Page Up`, or the **kiosk** button. It is turned off the same way, or with `Escape`.

On computers, kiosk mode also fills the whole screen and stops the screen from going dark. On iPhones and iPads the browser's address bar stays, because Safari does not allow web pages to fill the screen.

---

## Sound

The **sound** button (or `Insert`) turns the bell on or off. When it is on, one bell rings when the time runs out. The button shows a bell. It is amber while the sound is on, and the bell is struck through while it is off.

`` ` `` rings the bell at any time, and so does holding down the **sound** button.

---

## Colours

| Colour | Meaning |
|---|---|
| Grey | Not started |
| White | Running |
| Orange | Close to the end (flashing near the very end) |
| Amber | Paused |
| Red | Overtime |
| Green | Just reset |
| Purple | The next session is loaded |
| Blue | Counting down to a time of day |
| Teal | Clock mode |

---

## Installing and working offline

The **install** button in the menu adds Acari to the device as an app. It then opens in its own window, without the browser's address bar.

- In Chrome, Edge and other browsers that have an install window, the button opens it.
- In Safari and Firefox, the button says where to look instead: **Share → Add to Home Screen** on an iPhone or iPad, or the browser's own menu.

Installed or not, Acari keeps a copy of itself in the browser the first time it is opened. After that it opens with no internet connection. When a new version is published, the copy is replaced the next time the page is opened online.

---

## External services: what leaves this computer

The timer uses no outside services. Nothing is sent anywhere until a remote session connects two devices; the timer, queue, presets and settings are kept only in this browser. The settings in a link follow a `#`, so the server that sends the page never sees them. The QR codes are drawn by Acari itself.

Choosing **remote**, or opening a remote pad or a kiosk link, uses these external services, and no others:

| Service | Run by | What it does | What it receives | Without it |
|---|---|---|---|---|
| `0.peerjs.com` | [PeerJS](https://peerjs.com), its free public server | Introduces the devices to each other | An ID made from the code | Only tabs in the same browser can connect |
| `stun.l.google.com`, `stun1.l.google.com` | Google, public STUN servers | Help the devices find a direct route through routers | The devices' network addresses | Devices on different networks may not connect |

After the introduction, the devices talk to each other directly (WebRTC); the timer itself never passes through these services. Tabs in the same browser use none of them.

The PeerJS program (version 1.5.4, [MIT licence](./app/vendor/peerjs.LICENSE)) is part of Acari, in `app/vendor`. It is not fetched from another site.

The live version is hosted by [Vercel](https://vercel.com), which serves the app's files when it is opened.

---

## Limitations

- **iPhone and iPad**: kiosk mode cannot fill the whole screen.
- **Remote control between devices**: needs the internet, and needs peerjs.com to be reachable.
- **Opening the files directly**: Acari must come from a web server (or be installed). A browser will not run it from a folder on the disk, because it is made of several files.

---

## Development

Acari is the `app` folder: a page, a style sheet, and a few JavaScript modules. It has no build step and no dependency. The tests need [Node.js](https://nodejs.org) and pnpm:

```
pnpm install
pnpm test          # checks the rules, then runs the browser tests
pnpm run serve     # serves the app at http://localhost:4173
```

| Version change | When |
|---|---|
| Patch (`0.4.0` → `0.4.1`) | A fix |
| Minor (`0.4.0` → `0.5.0`) | A new feature |
| The first number | Changes only when the project is decided to be finished |

The version number is written in `<meta name="version">` in `app/index.html`. The manual shows it, and [CHANGELOG.md](./CHANGELOG.md) starts with it. `app/sw.js` repeats it to name its saved copy, and the rule checks make sure the two agree. [AGENTS.md](./AGENTS.md) explains how to work on the project.

| File | What it is |
|---|---|
| `app/index.html` | The page: every screen and window, and the manual |
| `app/tick.css` | How it looks |
| `app/js/main.js` | Starts the page as a timer or as a remote pad |
| `app/js/timer.js` | The timer, its menu and windows, and the kiosk's side of the remote control |
| `app/js/pad.js` | The remote pad |
| `app/js/transport.js` | How kiosks and remote pads talk to each other |
| `app/js/queue.js` | Reading and writing a queue as text |
| `app/js/qr.js` | Draws QR codes |
| `app/js/util.js` | Small things the others share |
| `app/sw.js`, `app/manifest.webmanifest`, `app/icons/` | Installing and working offline |
| `app/vendor/` | PeerJS, as published |
| `README.md` | This file |
| `CHANGELOG.md` | What each version added |
| `AGENTS.md` | How to work on the project, for people and AI agents |
| `tests/` | Browser tests (Playwright) |
| `scripts/` | The rule checks, a test server, and a feedback helper |
| `vercel.json` | How the live version is published and protected |

---

## Deployment

The live version at [acari.vercel.app](https://acari.vercel.app) is published by Vercel, using `vercel.json`. The `app` folder is published as it is, at the root of the site; the tests and documents are not. Every file is sent with the security headers in `vercel.json`. One of them, the Content-Security-Policy, lets the page run only its own scripts and reach only the services listed in [External services](#external-services-what-leaves-this-computer).

---

## Credit and licence

Dialectic Acheiropoieton of Heracles Papatheodorou and Claude.

The MIT licence applies. See [LICENSE](./LICENSE).
