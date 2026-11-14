// The timer: the countdown and its face, the menu and its windows, and the
// kiosk's side of the remote control. Loaded by main.js on every page that
// isn't a remote pad.
import { $, pad, absSec, fmt, nextUntilMs, params, codeParam, makeCode, remoteUrl, kioskUrl, go, copyText,
  PREFS_KEY, loadPrefs, openModal, closeModal, isAnyModalOpen, wireBtn, backdropClose, CODE_RE } from './util.js';
import { toMins, parseLength, parseQueue, queueStr, lengthStr, entryTime, toEntry, queueRows, tickQueueRows } from './queue.js';
import { bcTransport, peerTransport, clientLink, HEARTBEAT_MS, LOST_MS } from './transport.js';
import { qrSvg } from './qr.js';

// ── Settings in the link ──────────────────────────────
const DEFAULT_MINS = toMins(params.get('mins')) || 10;
const URL_LABEL    = params.get('label') ?? '';
const URL_NEXT_ITEMS = parseQueue(params.get('next') ?? '');
const URL_THEME    = params.get('theme') ?? '';
const URL_SOUND    = params.has('sound') ? +params.get('sound') : -1;

// ── DOM refs ──────────────────────────────────────────
const app          = $('app'),
      display      = $('timer-display'),
      labelWrap    = $('label-wrap'),
      labelEl      = $('label-text'),
      labelSub     = $('label-sub'),
      sessionQueue = $('session-queue'),
      sessionLabelEl = $('session-label'),
      wallClock    = $('wall-clock'),
      toolbar      = $('toolbar'),
      manual       = $('manual'),
      statusHint   = $('status-hint'),
      sessionEl    = $('session-timer'),
      keyBufEl     = $('key-buffer'),
      swipeEl      = $('swipe-hint'),
      btnSound     = $('btn-sound'),
      btnNext      = $('btn-next'),
      btnNextLbl   = btnNext.querySelector('.lbl'),
      btnUntilOpen = $('btn-until-open'),
      btnUntilAct  = $('btn-until-active'),
      btnCW        = $('btn-clock-watch');

// ── State ─────────────────────────────────────────────
// warnSecs1 null = automatic: AUTO_WARN_SHORT before the end, or AUTO_WARN_LONG
// for a session longer than LONG_SESSION — two minutes' notice is too little
// to wrap up a 45-minute talk. A number set in the warn window replaces it.
const AUTO_WARN_SHORT = 120, AUTO_WARN_LONG = 300, LONG_SESSION = 10 * 60;
let warnSecs1 = null, warnSecs2 = 60;
let totalSecs = DEFAULT_MINS * 60, remaining = totalSecs;
// The length of the countdown under way: totalSecs, or for a target time the
// time to it when it was set.
let untilLenSecs = 0;
const sessionLen = () => untilTarget ? untilLenSecs : totalSecs;
const firstWarnSecs = () => warnSecs1 ?? (sessionLen() > LONG_SESSION ? AUTO_WARN_LONG : AUTO_WARN_SHORT);
let running = false, editingLabel = false;
let customLabel = URL_LABEL, uiState = 'idle';
// null, not -1, for "nothing drawn yet": -1 is a real value (one second
// into overtime), and a first frame landing there was skipped.
let resumeAbsSec = 0, resumeVal = remaining, lastRenderedSec = null;
let T0_ABSSEC = null;
let soundMode = 0, bellRecord = null;
let nextQueue = URL_NEXT_ITEMS.length ? URL_NEXT_ITEMS.slice() : [{label:'', mins:10}];
let untilTarget = null, untilLabel = '';
let watchMode = false;
let kioskMode = false, kioskByRemote = false, blackout = false;
// This page's part in a remote session: 'solo' (none), 'host' (the kiosk that
// holds the timer) or 'mirror' (a read-only kiosk that follows the host).
let role = 'solo';
const readOnly = () => role === 'mirror';
// Blackout covers the screen (in the theme's background colour) without
// touching the timer, so changes made from the remote don't show until it lifts.
function setBlackout(on) { blackout = !!on; $('blackout').hidden = !blackout; }
// Lifted on the kiosk itself (Esc, double tap, double click): tell the remote.
function liftBlackout() { if (readOnly()) return; setBlackout(false); broadcastState(); }
let lastCoverTap = 0;
const DEFAULT_PRESETS = [
  {label:'5 min',mins:5},{label:'10 min',mins:10},{label:'25 min',mins:25},
  {label:'',mins:0},{label:'',mins:0},
];
let presets = DEFAULT_PRESETS.map(p => ({...p}));
let activePresetIdx = -1;
let isTouching = false, hasTouched = false;
let touchX0 = 0, touchY0 = 0, touchT0 = 0, lastTapT = 0;
let longPressTid = null, wakeLock = null;

// ── Prefs ─────────────────────────────────────────────
// Each saved field is checked on its own, so one bad field costs that field
// and not the rest.
const p = loadPrefs();
// Fields a URL parameter set for this visit. savePrefs() keeps the stored
// value for these, so a share link's theme, sound, queue or label never
// replaces the user's own; changing one by hand clears its flag (setPrefOwn).
const fromUrl = {
  theme: URL_THEME === 'light' || URL_THEME === 'dark',
  sound: [0,1].includes(URL_SOUND),
  nextQueue: URL_NEXT_ITEMS.length > 0,
  customLabel: !!URL_LABEL,
};
const storedPrefs = p;
const setPrefOwn = (...keys) => keys.forEach(k => { fromUrl[k] = false; });
// The bell at the end of a session: on (1) or off (0).
soundMode = [0,1].includes(URL_SOUND) ? URL_SOUND : p.sound === 1 ? 1 : 0;
// A saved queue wins over the first-visit default even when empty: the user
// cleared it, and it shouldn't come back as a 10-minute slot on reload.
if (!URL_NEXT_ITEMS.length && Array.isArray(p.nextQueue)) nextQueue = p.nextQueue.map(toEntry).filter(Boolean);
if (Array.isArray(p.presets) && p.presets.length === 5)
  presets = p.presets.map(e => toEntry(e) ?? {label:'', mins:0});
const toWarn = v => typeof v === 'number' && v >= 0 && v <= 7200 ? Math.floor(v) : null;
warnSecs1 = toWarn(p.warnSecs1);
warnSecs2 = toWarn(p.warnSecs2) ?? warnSecs2;
if (!URL_LABEL && typeof p.customLabel === 'string') customLabel = p.customLabel;

const savePrefs = () => {
  // A read-only kiosk shows another kiosk's timer; none of it is this
  // device's to save.
  if (role === 'mirror') return;
  const now = {
    theme: document.body.classList.contains('light') ? 'light' : 'dark',
    sound: soundMode, nextQueue, presets, warnSecs1, warnSecs2, customLabel,
  };
  for (const k in fromUrl) if (fromUrl[k]) { if (k in storedPrefs) now[k] = storedPrefs[k]; else delete now[k]; }
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(now)); } catch {}
};

const hardReset = () => { try { localStorage.removeItem(PREFS_KEY); } catch {} history.replaceState(null, '', location.pathname); location.reload(); };

// ── Audio ─────────────────────────────────────────────
let audioCtx = null;
const getCtx = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext ?? window.webkitAudioContext)();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    });
  }
  return audioCtx;
};
document.addEventListener('pointerdown', () => {
  audioCtx?.state !== 'running' && audioCtx?.resume().catch(() => {});
}, {passive:true, capture:true});

function playBell(freq=440, dur=3.0, vol=0.5, parts) {
  try {
    const ctx = getCtx();
    const go = () => {
      const t = ctx.currentTime, master = ctx.createGain();
      master.gain.setValueAtTime(vol, t); master.connect(ctx.destination);
      (parts ?? [[0.5,0.12,1.8],[1.0,0.35,1.0],[1.19,0.25,0.7],
        [1.56,0.20,0.55],[2.0,0.18,0.4],[2.75,0.10,0.3],[3.36,0.06,0.22]]
      ).forEach(([r,a,dm]) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.connect(g); g.connect(master); osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * r, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * dm);
        osc.start(t); osc.stop(t + dur * dm + 0.05);
      });
    };
    ctx.state === 'running' ? go() : ctx.resume().then(go).catch(() => {});
  } catch {}
}
const playDampBell = () => playBell(440, 0.7, 0.28);
const playOTBell   = () => playBell(220, 4.0, 0.55);
const playPing     = () => playBell(1047, 1.2, 0.35);

// ── Utilities ─────────────────────────────────────────
const COLON_RE = /:/g;
const withColons = s => s.replace(COLON_RE, '<span class="colon">:</span>');
const isTouchDev = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
// A kiosk run from a remote is started from the remote: no hint to click.
const startHint  = () => kioskByRemote || role === 'mirror' ? '' : (isTouchDev || hasTouched) ? 'tap to start' : 'click or enter to start';
const stateFor = rem => rem < 0 ? 'ot' : (warnSecs2 > 0 && rem <= warnSecs2) ? 'warn2' : (firstWarnSecs() > 0 && rem <= firstWarnSecs()) ? 'warn' : 'run';

// ── UI state machine ──────────────────────────────────
function applyState(s, transientMs) {
  uiState = s;
  // In clock mode the face belongs to the clock; toggleWatchMode() applies
  // the recorded state when it hands the face back.
  if (watchMode) return;
  labelWrap.className = 's-' + s + (editingLabel ? ' editing' : '');
  display.className   = 's-' + s;
  // Clear flash classes so they re-sync on next tick (not left over from previous state)
  display.classList.remove('flash-dim', 'flash-dim2');
  labelWrap.classList.remove('flash-off');
  if (!editingLabel) {
    labelSub.textContent = '';
    switch(s) {
      case 'idle': case 'reset': labelEl.textContent = startHint(); break;
      case 'run':  case 'warn': case 'warn2': labelEl.textContent = ''; break;
      case 'pause': labelEl.textContent = 'PAUSED'; break;
      case 'ot':    labelEl.textContent = 'OVERTIME'; break;
      case 'next':  labelEl.textContent = `\u25B6 NEXT: ${fmt(totalSecs)}`; labelSub.textContent = startHint(); break;
      case 'until': labelEl.textContent = untilLabel; labelSub.textContent = startHint(); break;
      case 'watch': labelEl.textContent = ''; break;
    }
  }
  if (transientMs) setTimeout(() => { if (uiState === s) applyState('idle'); }, transientMs);
  sessionLabelEl.textContent = (s !== 'watch') ? customLabel : '';
}

function renderSessionQueue() {
  if (watchMode) { sessionQueue.innerHTML = ''; return; }
  sessionQueue.innerHTML = '';
  // Queued items — grouped block, left-aligned within a centred container
  if (nextQueue.length) {
    // "NEXT" header row — clickable, opens queue modal
    const header = document.createElement('div');
    header.className = 'sq-item sq-next-header';
    header.textContent = 'NEXT';
    header.addEventListener('click', e => { e.stopPropagation(); openNextModal(); });
    const block = document.createElement('div');
    block.id = 'sq-queue-block';
    block.appendChild(header); // in the block, so it starts where the icons do
    queueRows(nextQueue, 'sq-item sq-queued', 'sq-item sq-more').forEach(row => {
      row.addEventListener('click', e => { e.stopPropagation(); openNextModal(); });
      block.appendChild(row);
    });
    block.addEventListener('click', e => { e.stopPropagation(); openNextModal(); });
    sessionQueue.appendChild(block);
    btnNextLbl.textContent = 'queue: ' + nextQueue.map(entryTime).join(' ');
  } else {
    btnNextLbl.textContent = 'queue: \u2014';
  }
  btnNext.classList.toggle('next-set', nextQueue.length > 0);
}

function renderUntilBtn() {
  const on = !!untilTarget;
  btnUntilAct.style.display  = on ? '' : 'none';
  btnUntilOpen.style.display = on ? 'none' : '';
  if (on) btnUntilAct.querySelector('.lbl').textContent = 'target: ' + untilLabel.replace(/^\u25B6\s*/, ''); // the icon is the triangle
}

function renderPresets() {
  const c = $('preset-buttons'); c.innerHTML = '';
  presets.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'tb-btn preset-btn' + (p.mins > 0 ? ' filled dim' : '');
    btn.textContent = p.mins > 0 ? (p.label || p.mins+'m') : '+';
    if (i === activePresetIdx) btn.style.borderColor = 'var(--fg)';
    const onLoad = e => {
      e.stopPropagation();
      if (p.mins > 0) {
        activePresetIdx = i; exitUntilMode(); exitWatchMode(); fullReset(p.mins);
        if (p.label) { customLabel = p.label; applyState(uiState); }
        renderPresets();
      } else openPresetModal(i);
    };
    btn.addEventListener('click', onLoad);
    btn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); openPresetModal(i); });
    btn.addEventListener('touchstart', e => {
      e.stopPropagation();
      longPressTid = setTimeout(() => { longPressTid = null; openPresetModal(i); }, 500);
    }, {passive:true});
    btn.addEventListener('touchend', e => {
      e.stopPropagation();
      if (longPressTid !== null) { clearTimeout(longPressTid); longPressTid = null; e.preventDefault(); onLoad(e); }
    }, {passive:false});
    btn.addEventListener('touchmove', () => { clearTimeout(longPressTid); longPressTid = null; }, {passive:true});
    c.appendChild(btn);
  });
}

// ── RAF loop ──────────────────────────────────────────
let lastSessionSec = -1, lastWallSec = -1, lastWatchMin = '', lastColonBit = -1;
;(function loop() {
  const now = absSec();

  // Session timer — write textContent only when the second changes (was: every frame)
  if (T0_ABSSEC !== null && now !== lastSessionSec) {
    lastSessionSec = now;
    sessionEl.textContent = fmt(now - T0_ABSSEC);
  }

  // Wall clock — shares Date-based clock with absSec(), ticks in sync
  if (now !== lastWallSec) {
    lastWallSec = now;
    const d = new Date(), ks = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    wallClock.textContent = ks;
    tickQueueRows(sessionQueue); // the time left to a queued time of day
  }

  // Clock mode only changes what the face shows. The countdown below runs
  // either way — bells, queue hand-over and remote updates included; it once
  // stopped here and caught up only when clock mode was left.
  if (watchMode) {
    // Clock face — only rebuild innerHTML when the displayed minute changes
    const d = new Date();
    const watchMin = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (watchMin !== lastWatchMin) {
      lastWatchMin = watchMin;
      display.innerHTML = withColons(watchMin);
    }
    // Colon blink — CSS class toggle instead of querySelectorAll + style writes
    const bit = now % 2;
    if (bit !== lastColonBit) {
      lastColonBit = bit;
      display.classList.toggle('colon-off', bit !== 0);
    }
    display.style.color = 'var(--c-watch)'; display.style.opacity = '';
  }

  if (running) {
    const rem = untilTarget ? Math.round((untilTarget - Date.now())/1000) : resumeVal - (now - resumeAbsSec);
    if (rem !== lastRenderedSec) {
      lastRenderedSec = rem; remaining = rem;
      const st = stateFor(rem); if (st !== uiState) {
        applyState(st);
        // On first OT transition, auto-advance to next queued session
        if (st === 'ot' && nextQueue.length) {
          // loadNextTimer() stops the clock, so startTimer() starts the new
          // slot from now. Keep scheduling: returning here once stopped the
          // loop, and with it every redraw, for good.
          loadNextTimer(); startTimer();
          requestAnimationFrame(loop); return;
        }
      }
      // No renderSessionQueue() here: the queue doesn't change with the
      // second, and rebuilding it every tick swapped rows out from under a
      // click, which then fell through to the stage and paused the timer.
      checkAutoSound(); renderDigits(rem);
      if (watchMode) { requestAnimationFrame(loop); return; }
      // Sync flash to countdown second — toggled on each tick so perfectly aligned
      const bit = Math.abs(rem) % 2;
      if (uiState === 'ot')    { labelWrap.classList.toggle('flash-off',  bit === 1); }
      if (uiState === 'warn2') { display.classList.toggle('flash-dim2', bit === 1); }
      if (uiState === 'warn')  { display.classList.toggle('flash-dim',  bit === 1); }
    }
  }
  requestAnimationFrame(loop);
})();

let renderDigits = rem => {
  if (watchMode) return;
  const sign = rem < 0 ? '+' : '', abs = Math.abs(rem);
  const h = Math.floor(abs/3600), m = Math.floor((abs%3600)/60), s = abs%60;
  if (h > 0) {
    display.innerHTML = // safe-markup: sign, h, m and s are numbers
      `<span class="disp-h">${sign}${h}<span class="disp-h-suf">H</span></span>` +
      `<span class="disp-ms">${withColons(pad(m)+':'+pad(s))}</span>`;
  } else {
    display.innerHTML = withColons(fmt(rem));
  }
};

function checkAutoSound() {
  if (soundMode && remaining <= 0 && bellRecord === null) { playOTBell(); bellRecord = 0; }
}

// ── Timer controls ────────────────────────────────────
function startTimer() {
  if (running) return; running = true;
  if (T0_ABSSEC === null) T0_ABSSEC = absSec();
  resumeAbsSec = absSec(); resumeVal = remaining; lastRenderedSec = null;
  applyState(stateFor(remaining)); renderSessionQueue(); renderDigits(remaining); hideToolbar();
}
function pauseTimer() {
  if (!running) return; running = false;
  if (!untilTarget) { remaining = resumeVal - (absSec() - resumeAbsSec); resumeVal = remaining; }
  lastRenderedSec = null;
  applyState('pause'); renderDigits(remaining); renderSessionQueue();
}

let tbTid;
const btnMenu     = $('btn-menu');
const btnTick     = $('btn-tick');
const menuBackdrop= $('menu-backdrop');

const hideToolbar = () => {
  clearTimeout(tbTid);
  toolbar.classList.remove('visible');
  menuBackdrop.classList.remove('open');
  btnMenu.style.display = '';
};
const showToolbar = () => {
  toolbar.classList.add('visible');
  menuBackdrop.classList.add('open');
  btnMenu.style.display = 'none';
  clearTimeout(tbTid);
  tbTid = setTimeout(hideToolbar, 5000);
};
const toggleMenu = () => toolbar.classList.contains('visible') ? hideToolbar() : showToolbar();

btnMenu.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
menuBackdrop.addEventListener('click', () => hideToolbar());
btnTick.addEventListener('click', e => { e.stopPropagation(); isManualOpen() ? closeManual() : openManual(); });

// Reset hide timer whenever pointer moves within the toolbar
toolbar.addEventListener('pointermove', () => { clearTimeout(tbTid); tbTid = setTimeout(hideToolbar, 5000); });

// Sessions that have handed over to the next one, most recent last, so the
// remote's Prev can step back. A countdown to a time of day isn't a session
// the queue could hold, so it isn't kept. In memory only, and bounded.
let prevSessions = [];
const PREV_MAX = 50;
const currentSession = () => ({label: customLabel, mins: toMins(totalSecs / 60)});

function loadNextTimer(silent) {
  if (!nextQueue.length) return false;
  if (!untilTarget && currentSession().mins) prevSessions = [...prevSessions, currentSession()].slice(-PREV_MAX);
  // A loaded slot waits in 'next' until started; callers that want it running
  // call startTimer(), which would be a no-op if the old timer still ran.
  running = false; lastRenderedSec = null;
  exitUntilMode(); const entry = nextQueue.shift();
  customLabel = entry.label || '';
  if (entry.at) {
    // "[HH:MM]": a countdown to that time of day, which runs from the start.
    const [h, m] = entry.at.split(':').map(Number);
    savePrefs(); enterUntilMode(nextUntilMs(h, m), '\u25B6 ' + entry.at);
    renderSessionQueue(); if (!silent) playPing();
    return true;
  }
  totalSecs = entry.mins*60; remaining = resumeVal = totalSecs; bellRecord = null;
  savePrefs();
  applyState('next'); renderSessionQueue(); renderDigits(remaining);
  if (!silent) playPing();
  return true;
}

// Back to the session before: it loads ready to start, as Next does, and the
// current session goes back to the front of the queue, so Next undoes Prev.
function loadPrevTimer() {
  if (!prevSessions.length) return false;
  const entry = prevSessions.at(-1);
  prevSessions = prevSessions.slice(0, -1);
  if (!untilTarget && currentSession().mins) nextQueue = [currentSession(), ...nextQueue];
  running = false; lastRenderedSec = null;
  exitUntilMode();
  totalSecs = entry.mins*60; remaining = resumeVal = totalSecs; bellRecord = null;
  customLabel = entry.label || ''; savePrefs();
  applyState('next'); renderSessionQueue(); renderDigits(remaining); playPing();
  return true;
}

function fullReset(mins) {
  running = false; lastRenderedSec = null;
  exitUntilMode();
  totalSecs = (mins||DEFAULT_MINS)*60; remaining = resumeVal = totalSecs;
  resumeAbsSec = 0; bellRecord = null; // the label is the user's; Enter/End/reset keep it
  T0_ABSSEC = null; sessionEl.textContent = '00:00';
  applyState('reset', 700); renderSessionQueue(); renderDigits(remaining);
}

function adjustMinutes(delta) {
  if (!running || untilTarget) return;
  remaining = Math.max(-(99*60+59), remaining + delta*60);
  resumeVal = remaining; resumeAbsSec = absSec(); lastRenderedSec = null;
  const d = stateFor(remaining);
  // The loop only hands over to the queue on a state change, and this sets
  // the state itself, so an adjustment past zero has to hand over here.
  if (d === 'ot' && nextQueue.length) { loadNextTimer(); startTimer(); showHint((delta>0?'+':'')+delta+' min'); return; }
  if (d !== uiState) applyState(d);
  if (remaining >= 0) bellRecord = null;
  renderDigits(remaining); showHint((delta>0?'+':'')+delta+' min');
}

// The same buttons before the start change the length itself: there is no
// running count to move, so they set what it will count down from.
const isFull = () => !running && !untilTarget && remaining === totalSecs;
function adjustLength(delta) {
  if (!isFull()) return;
  totalSecs = Math.min(999, Math.max(1, Math.round(totalSecs/60) + delta)) * 60;
  remaining = resumeVal = totalSecs; lastRenderedSec = null; bellRecord = null;
  if (uiState === 'next') applyState('next'); // its label names the length
  renderDigits(remaining); showHint((delta>0?'+':'')+delta+' min');
}
// Started: a session is under way (running, paused, or counting to a time).
const isStarted = () => running || T0_ABSSEC !== null || !!untilTarget;

// ── Until mode ────────────────────────────────────────
function enterUntilMode(targetMs, label) {
  untilTarget = targetMs; untilLabel = label; running = false; lastRenderedSec = null;
  remaining = resumeVal = untilLenSecs = Math.round((targetMs - Date.now())/1000); bellRecord = null;
  applyState('until'); renderUntilBtn(); renderSessionQueue(); renderDigits(remaining); startTimer();
}
function exitUntilMode() {
  if (!untilTarget) return; untilTarget = null; untilLabel = ''; renderUntilBtn();
}

// ── Watch mode ────────────────────────────────────────
let preWatchRunning = false;
function toggleWatchMode() {
  watchMode = !watchMode;
  btnCW.classList.toggle('watch-on', watchMode);
  // The button names where a press goes, with that face's icon: a clock, or a stopwatch.
  btnCW.querySelector('.lbl').textContent = watchMode ? 'timer' : 'clock';
  btnCW.querySelector('.ico').className = 'ico ' + (watchMode ? 'ico-timer' : 'ico-clock');
  if (watchMode) {
    preWatchRunning = running;
    display.style.color = 'var(--c-watch)'; display.className = 's-watch';
    sessionQueue.innerHTML = ''; labelEl.textContent = ''; labelSub.textContent = '';
    lastWatchMin = ''; lastColonBit = -1;
    const d = new Date(); display.innerHTML = withColons(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  } else {
    display.style.color = '';
    display.classList.remove('colon-off');
    display.className = 's-' + uiState;
    renderDigits(remaining); applyState(uiState); renderSessionQueue();
    // Restore running state — don't touch the queue or start anything new
    if (preWatchRunning && !running) startTimer();
  }
}
function exitWatchMode() {
  if (!watchMode) return;
  toggleWatchMode(); // does all the cleanup, and resumes the timer as it was
}

// ── Preset cycling ────────────────────────────────────
function loadPresetByDirection(dir) {
  const filled = presets.map((p,i) => ({...p,idx:i})).filter(p => p.mins>0);
  if (!filled.length) return;
  const cur = filled.findIndex(p => p.idx === activePresetIdx);
  const p = filled[(cur + dir + filled.length) % filled.length];
  activePresetIdx = p.idx; exitUntilMode(); exitWatchMode(); fullReset(p.mins);
  if (p.label) { customLabel = p.label; applyState(uiState); }
  renderPresets(); showHint(p.label || p.mins+' min');
}

// ── Main action ───────────────────────────────────────
function doMainAction() {
  if (watchMode) { toggleWatchMode(); return; }
  if (uiState === 'next' || (uiState === 'until' && !running)) { startTimer(); return; }
  if (uiState === 'ot' || (remaining < 0 && !running)) {
    if (nextQueue.length) { loadNextTimer(); startTimer(); } else { fullReset(); }
    return;
  }
  running ? pauseTimer() : startTimer();
}

// ── Label edit ────────────────────────────────────────
function startLabelEdit() {
  if (editingLabel) return;
  editingLabel = true; labelWrap.classList.add('editing');
  labelEl.contentEditable = 'true'; labelEl.textContent = customLabel; labelEl.focus();
  try { const sel = getSelection(), r = document.createRange(); r.selectNodeContents(labelEl); sel.removeAllRanges(); sel.addRange(r); } catch {}
}
function endLabelEdit() {
  if (!editingLabel) return; editingLabel = false; labelWrap.classList.remove('editing');
  labelEl.contentEditable = 'false'; customLabel = labelEl.textContent.trim(); setPrefOwn('customLabel');
  sessionLabelEl.textContent = customLabel;
  savePrefs(); applyState(uiState);
}

// ── Keyboard digit buffer ─────────────────────────────
let keyBuf = '', keyBufTid = null;
const clearKeyBuf = () => { keyBuf = ''; keyBufEl.textContent = ''; keyBufEl.classList.remove('show'); clearTimeout(keyBufTid); };
function kbPushDigit(d) {
  keyBuf = (keyBuf + d).slice(-3);
  keyBufEl.textContent = keyBuf + '\u00a0min'; keyBufEl.classList.add('show');
  clearTimeout(keyBufTid); keyBufTid = setTimeout(clearKeyBuf, 2500);
}
function kbCommit() {
  const mins = parseInt(keyBuf, 10); clearKeyBuf(); if (isNaN(mins)||mins<=0) return;
  const was = running; if (running) pauseTimer(); exitUntilMode();
  totalSecs = mins*60; remaining = resumeVal = totalSecs; bellRecord = null;
  renderDigits(remaining); if (was) startTimer();
}

// ── Share ─────────────────────────────────────────────
// The device's own share sheet where there is one; elsewhere the link is
// copied, as before.
function shareTimer() {
  const p = new URLSearchParams();
  p.set('mins', Math.max(1, Math.round(totalSecs/60)));
  if (customLabel) p.set('label', customLabel);
  if (nextQueue.length) {
    const nextStr = queueStr(nextQueue);
    p.set('next', nextStr);
  }
  p.set('theme', document.body.classList.contains('light') ? 'light' : 'dark');
  p.set('sound', soundMode);
  // After "#": the link's settings never reach the server that serves the page.
  const url = `${location.origin}${location.pathname}#${p}`;
  const copy = () => copyText(url).then(() => showHint('URL copied'));
  if (!navigator.share) return copy();
  // Closing the sheet without choosing (AbortError) is an answer, not a failure.
  navigator.share({title: document.title, url}).catch(e => { if (e?.name !== 'AbortError') copy(); });
}

// ── Modals ────────────────────────────────────────────
// ── Queue modal ───────────────────────────────────────
let queueEditRows = []; // working copy during modal session
let dragSrcIdx = null;

function buildQueueRow(entry, idx) {
  const row = document.createElement('div');
  row.className = 'qr-row';
  row.draggable = true;
  row.dataset.idx = idx;

  const handle = document.createElement('span');
  handle.className = 'qr-handle'; handle.textContent = '⠿';

  const labelInp = document.createElement('input');
  labelInp.type = 'text'; labelInp.className = 'modal-input qr-label';
  labelInp.placeholder = 'Label'; labelInp.maxLength = 32;
  labelInp.value = entry.label;

  const minsInp = document.createElement('input');
  // Minutes, or "[HH:MM]" for a countdown to a time of day.
  minsInp.type = 'text'; minsInp.className = 'modal-input qr-mins';
  minsInp.placeholder = 'min'; minsInp.title = 'Minutes, or [HH:MM] for a time of day';
  minsInp.autocomplete = 'off'; minsInp.spellcheck = false;
  minsInp.value = entry.mins || entry.at ? lengthStr(entry) : '';

  const del = document.createElement('button');
  del.className = 'qr-del'; del.textContent = '×';
  del.addEventListener('click', e => {
    e.stopPropagation();
    queueEditRows = collectQueueRows(); // keep edits typed into other rows
    queueEditRows.splice(idx, 1);
    rebuildQueueList();
  });

  // Drag events
  row.addEventListener('dragstart', e => {
    dragSrcIdx = idx;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', e => {
    e.preventDefault(); row.classList.remove('drag-over');
    if (dragSrcIdx === null || dragSrcIdx === idx) return;
    queueEditRows = collectQueueRows();
    const moved = queueEditRows.splice(dragSrcIdx, 1)[0];
    queueEditRows.splice(idx, 0, moved);
    dragSrcIdx = null;
    rebuildQueueList();
  });

  // Touch drag (pointer events)
  let ptSrcY = 0, ptDragTid = null, ptActive = false;
  row.addEventListener('pointerdown', e => {
    if (e.target === del || e.target === labelInp || e.target === minsInp) return;
    ptSrcY = e.clientY; ptActive = false;
    ptDragTid = setTimeout(() => { ptActive = true; row.classList.add('dragging'); dragSrcIdx = idx; }, 300);
  }, {passive:true});
  row.addEventListener('pointermove', e => {
    if (!ptActive) return;
    const list = $('queue-list');
    const rows = [...list.querySelectorAll('.qr-row')];
    rows.forEach(r => r.classList.remove('drag-over'));
    const target = rows.find(r => {
      const b = r.getBoundingClientRect();
      return e.clientY >= b.top && e.clientY <= b.bottom;
    });
    if (target) target.classList.add('drag-over');
  });
  row.addEventListener('pointerup', e => {
    clearTimeout(ptDragTid);
    if (!ptActive) { row.classList.remove('dragging'); return; }
    ptActive = false; row.classList.remove('dragging');
    const list = $('queue-list');
    const rows = [...list.querySelectorAll('.qr-row')];
    rows.forEach(r => r.classList.remove('drag-over'));
    const target = rows.find(r => {
      const b = r.getBoundingClientRect();
      return e.clientY >= b.top && e.clientY <= b.bottom;
    });
    if (target && dragSrcIdx !== null) {
      const destIdx = +target.dataset.idx;
      if (destIdx !== dragSrcIdx) {
        queueEditRows = collectQueueRows();
        const moved = queueEditRows.splice(dragSrcIdx, 1)[0];
        queueEditRows.splice(destIdx, 0, moved);
      }
    }
    dragSrcIdx = null;
    rebuildQueueList();
  });

  row.append(handle, labelInp, minsInp, del);
  return row;
}

function rebuildQueueList() {
  const list = $('queue-list');
  list.innerHTML = '';
  queueEditRows.forEach((entry, i) => list.appendChild(buildQueueRow(entry, i)));
}

function collectQueueRows() {
  return [...$('queue-list').querySelectorAll('.qr-row')].map(row => {
    const label = row.querySelector('.qr-label').value.trim().slice(0, 32);
    const v = row.querySelector('.qr-mins').value.trim();
    // As in a written queue: "[14:30]" is a time of day, "5" or "5:00" a length.
    const len = parseLength(v);
    return len ? {label, ...len} : {label, mins: Math.min(999, Math.max(1, parseInt(v, 10) || 1))};
  });
}

const openNextModal = () => {
  if (readOnly()) return;
  $('queue-current-label').value = customLabel;
  queueEditRows = nextQueue.map(e => ({...e}));
  rebuildQueueList();
  openModal('next-modal');
  $('queue-current-label').focus();
};
const closeNextModal = () => closeModal('next-modal');

function nextCommit() {
  customLabel = $('queue-current-label').value.trim();
  nextQueue = collectQueueRows().filter(e => e.mins > 0 || e.at);
  setPrefOwn('customLabel', 'nextQueue');
  closeNextModal(); savePrefs(); renderSessionQueue(); applyState(uiState);
  showHint(customLabel || (nextQueue.length ? `next: ${nextQueue.map(e=>e.label||entryTime(e)).join(', ')}` : 'queue set'));
}

wireBtn('queue-add', () => {
  queueEditRows = collectQueueRows();
  queueEditRows.push({label:'', mins:10});
  rebuildQueueList();
  // Focus the new row's label input
  const rows = $('queue-list').querySelectorAll('.qr-label');
  rows[rows.length-1]?.focus();
});
wireBtn('next-set', nextCommit);
wireBtn('next-cancel', closeNextModal);
$('queue-current-label').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); nextCommit(); }
  if (e.key === 'Escape') { e.preventDefault(); closeNextModal(); }
});
backdropClose('next-modal', closeNextModal);

// ── Until modal ───────────────────────────────────────
const untilHour = $('until-hour'), untilMin = $('until-min');
function getUntilHM() {
  const h = parseInt(untilHour.value, 10), m = parseInt(untilMin.value, 10);
  return (isNaN(h)||isNaN(m)) ? null : [Math.min(23,Math.max(0,h)), Math.min(59,Math.max(0,m))];
}
function updateUntilPreview() {
  const el = $('until-preview'), hm = getUntilHM();
  if (!hm) { el.textContent = '\u2014'; el.classList.add('dim'); return; }
  const [h,m] = hm;
  // Only the time left: the target itself is in the boxes right below.
  el.textContent = fmt(Math.round((nextUntilMs(h,m)-Date.now())/1000));
  el.classList.remove('dim');
}
function openUntilModal() {
  let h, m;
  if (untilTarget) {
    const d = new Date(untilTarget); h = d.getHours(); m = d.getMinutes();
  } else {
    // Default to next solid half-hour (:00 or :30)
    const now = new Date();
    const totalMins = now.getHours() * 60 + now.getMinutes() + 1; // +1 so current :00/:30 counts as past
    const nextHalf = Math.ceil(totalMins / 30) * 30;
    h = Math.floor(nextHalf / 60) % 24; m = nextHalf % 60;
  }
  untilHour.value = h; untilMin.value = m;
  updateUntilPreview(); openModal('until-modal'); untilHour.focus(); untilHour.select();
}
const closeUntilModal = () => closeModal('until-modal');
function untilCommit() {
  const hm = getUntilHM(); if (!hm) { closeUntilModal(); return; }
  const [h,m] = hm; closeUntilModal();
  enterUntilMode(nextUntilMs(h,m), `\u25B6 ${pad(h)}:${pad(m)}`);
}
const untilClear = () => { closeUntilModal(); exitUntilMode(); running=false; applyState('idle'); showHint('until cleared'); };
[untilHour, untilMin].forEach(inp => {
  inp.addEventListener('input', updateUntilPreview);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); untilCommit(); }
    if (e.key === 'Escape') { e.preventDefault(); closeUntilModal(); }
  });
});
// Tab from hour → min
untilHour.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); untilMin.focus(); untilMin.select(); } });
wireBtn('until-set', untilCommit); wireBtn('until-cancel', closeUntilModal); wireBtn('until-clear', untilClear);
backdropClose('until-modal', closeUntilModal);

// ── Preset modal ──────────────────────────────────────
let presetEditIdx = -1;
function openPresetModal(idx) {
  presetEditIdx = idx;
  $('preset-label-input').value = presets[idx].label ?? '';
  $('preset-mins-input').value  = presets[idx].mins || '';
  openModal('preset-modal'); $('preset-label-input').focus();
}
const closePresetModal = () => { closeModal('preset-modal'); presetEditIdx = -1; };
function presetSave() {
  const label=$('preset-label-input').value.trim(), typed=parseInt($('preset-mins-input').value,10);
  if (isNaN(typed)||typed<=0) { closePresetModal(); return; }
  const mins = Math.min(999, typed); // max="999" doesn't stop typing 1200
  presets[presetEditIdx]={label,mins}; closePresetModal(); savePrefs(); renderPresets(); showHint('preset saved');
}
function presetDelete() {
  presets[presetEditIdx]={label:'',mins:0};
  if (activePresetIdx===presetEditIdx) activePresetIdx=-1;
  closePresetModal(); savePrefs(); renderPresets(); showHint('preset deleted');
}
wireBtn('preset-save', presetSave); wireBtn('preset-cancel', closePresetModal); wireBtn('preset-delete', presetDelete);
backdropClose('preset-modal', closePresetModal);
$('preset-label-input').addEventListener('keydown', e => {
  if (e.key==='Enter')  { e.preventDefault(); $('preset-mins-input').focus(); }
  if (e.key==='Escape') { e.preventDefault(); closePresetModal(); }
});
$('preset-mins-input').addEventListener('keydown', e => {
  if (e.key==='Enter')  { e.preventDefault(); presetSave(); }
  if (e.key==='Escape') { e.preventDefault(); closePresetModal(); }
});

// ── Manual ────────────────────────────────────────────
const openManual   = () => { manual.classList.add('open'); manual.scrollTop=0; };
const closeManual  = () => manual.classList.remove('open');
const isManualOpen = () => manual.classList.contains('open');

// ── Kiosk / Fullscreen ────────────────────────────────
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
const fsEl    = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
const fsEnter = el => (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el)?.catch(()=>{});
const fsLeave = ()  => fsEl() && (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document)?.catch(()=>{});

const onFsChange = () => {
  if (fsEl()) navigator.wakeLock?.request('screen').then(wl => { wakeLock=wl; }).catch(()=>{});
  else { wakeLock?.release(); wakeLock=null; }
};
document.addEventListener('fullscreenchange',       onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

function enterKiosk() {
  kioskMode = true;
  // Kiosk hides the menu anyway; closing it too means the first Escape
  // leaves kiosk mode instead of closing a menu nobody can see.
  hideToolbar();
  document.body.classList.add('kiosk');
  if (!isIOS) fsEnter(document.documentElement);
  // Fullscreen needs a click, so a kiosk entered because a remote connected
  // doesn't get it, nor the wake lock that comes with it. Ask for that here.
  if (!wakeLock) navigator.wakeLock?.request('screen').then(wl => { wakeLock = wl; }).catch(() => {});
  $('btn-fullscreen').textContent = 'exit';
}
function exitKiosk() {
  kioskMode = false;
  document.body.classList.remove('kiosk');
  if (fsEl()) fsLeave();
  wakeLock?.release(); wakeLock = null;
  $('btn-fullscreen').textContent = 'kiosk';
}
const toggleKiosk = () => kioskMode ? exitKiosk() : enterKiosk();
const toggleFullscreen = () => fsEl() ? fsLeave() : (!isIOS && fsEnter(document.documentElement));

// ── Theme & Sound ─────────────────────────────────────
const toggleTheme = () => { document.body.classList.toggle('light'); setPrefOwn('theme'); savePrefs(); showHint(document.body.classList.contains('light') ? 'light' : 'dark'); };

// The bell icon carries the state: struck through when off.
const updateSoundBtn = () => {
  btnSound.classList.toggle('sound-on', soundMode > 0);
  btnSound.querySelector('.ico').className = 'ico ' + (soundMode ? 'ico-bell' : 'ico-bell-off');
  btnSound.setAttribute('aria-pressed', String(soundMode > 0));
};
updateSoundBtn();
function cycleSoundMode() {
  soundMode = soundMode ? 0 : 1; updateSoundBtn(); setPrefOwn('sound'); savePrefs();
  showHint(soundMode ? 'SOUND: ON' : 'SOUND: OFF');
  const preview = soundMode ? playOTBell : playDampBell;
  const ctx = getCtx(), fire = () => { try { preview(); } catch {} };
  ctx.state==='running' ? fire() : ctx.resume().then(fire).catch(()=>{});
}

// ── UI helpers ────────────────────────────────────────
let hintTid, swipeTid;
const showHint  = msg => { statusHint.textContent=msg; statusHint.classList.add('show'); clearTimeout(hintTid); hintTid=setTimeout(()=>statusHint.classList.remove('show'),1800); };
const showSwipe = icon => { swipeEl.textContent=icon; swipeEl.classList.add('show'); clearTimeout(swipeTid); swipeTid=setTimeout(()=>swipeEl.classList.remove('show'),700); };

// ── Touch ─────────────────────────────────────────────
const isUIChrome = el => !!(el.closest('#blackout')||el.closest('#session-queue')||el.closest('#toolbar')||el.closest('#top-bar')||el.closest('#manual')||el.closest('.modal-overlay')||el.closest('#btn-menu')||el.closest('#btn-tick')||el.closest('#menu-backdrop'));

document.addEventListener('touchstart', e => {
  if (readOnly()) return;
  isTouching = true;
  if (!hasTouched) { hasTouched=true; if (['idle','reset'].includes(uiState)) applyState(uiState); }
  try { audioCtx?.resume().catch(()=>{}); } catch {}
  if (isUIChrome(e.target)) return;
  touchX0=e.touches[0].clientX; touchY0=e.touches[0].clientY; touchT0=Date.now();
  if (toolbar.classList.contains('visible')) { hideToolbar(); return; }
}, {passive:true});

document.addEventListener('touchend', e => {
  // A read-only kiosk takes one gesture: a double tap fills the screen.
  if (readOnly()) {
    if (isUIChrome(e.target) && !e.target.closest('#blackout')) return;
    e.preventDefault();
    const now = Date.now();
    if (now - lastTapT < 380) { lastTapT = 0; toggleFullscreen(); } else lastTapT = now;
    return;
  }
  // Reset isTouching after the synthetic mouse-click window (~300 ms) so real
  // mouse users on hybrid devices aren't locked out permanently.
  setTimeout(() => { isTouching = false; }, 400);
  // On the cover, taps reach nothing underneath; a double tap lifts it, for a
  // kiosk with no keyboard whose remote is gone.
  if (e.target.closest('#blackout')) {
    e.preventDefault();
    const now = Date.now();
    if (now - lastCoverTap < 380) { lastCoverTap = 0; liftBlackout(); } else lastCoverTap = now;
    return;
  }
  if (isUIChrome(e.target)) return;
  e.preventDefault();
  const x=e.changedTouches[0].clientX, y=e.changedTouches[0].clientY;
  const dx=x-touchX0, dy=y-touchY0, dt=Date.now()-touchT0;
  if (Math.abs(dx)<22 && Math.abs(dy)<22 && dt<450) {
    const now=Date.now();
    if (now-lastTapT<380) { lastTapT=0; toggleKiosk(); return; }
    lastTapT=now; setTimeout(()=>{ if(lastTapT!==now) return; doMainAction(); }, 280);
    return;
  }
  if (!running||dt>700||untilTarget) return;
  const ax=Math.abs(dx), ay=Math.abs(dy);
  if (ay>ax&&ay>30)      dy<0 ? (adjustMinutes(10),showSwipe('\uD83D\uDC46')) : (adjustMinutes(-5),showSwipe('\uD83D\uDC47'));
  else if (ax>ay&&ax>30) dx<0 ? (adjustMinutes(1), showSwipe('\uD83D\uDC48')) : (adjustMinutes(-1),showSwipe('\uD83D\uDC49'));
}, {passive:false});

// ── Mouse ─────────────────────────────────────────────
const isStageTarget = e => !readOnly() && !isTouching && !editingLabel && !isUIChrome(e.target);
let clickTid=null;
app.addEventListener('click', e => {
  if (!isStageTarget(e)) return;
  if (toolbar.classList.contains('visible')) { hideToolbar(); return; }
  clearTimeout(clickTid);
  running ? (clickTid=setTimeout(doMainAction,160)) : doMainAction();
});
document.addEventListener('wheel', e => {
  // Only the stage turns the wheel into minutes; the manual, a long queue
  // and the remote pad still need to scroll.
  if (isUIChrome(e.target)) return;
  e.preventDefault(); if (readOnly()||!running||untilTarget) return; adjustMinutes(e.deltaY<0?1:-1); }, {passive:false});

// ── Keyboard ──────────────────────────────────────────
document.addEventListener('keydown', e => {
  // A modal field that handled the key (Enter to save, Escape to cancel)
  // closes its modal first, so without this the same press reached the
  // shortcuts below too: Enter in any modal restarted the timer.
  if (e.defaultPrevented) return;
  // A read-only kiosk follows another screen; the one key it takes is Escape,
  // which stops following and makes it an ordinary timer again.
  if (readOnly()) { if (e.key === 'Escape') { e.preventDefault(); leaveMirror(); } return; }
  if (isAnyModalOpen()) { if (e.key==='Escape') { e.preventDefault(); document.querySelectorAll('.modal-overlay.open').forEach(m=>closeModal(m.id)); } return; }
  if (editingLabel) { if (e.key==='Enter'||e.key==='Escape') { e.preventDefault(); endLabelEdit(); } return; }
  if (isManualOpen()) { if (e.key==='Escape') { e.preventDefault(); closeManual(); } return; }
  if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
  if (e.ctrlKey||e.metaKey) {
    if (e.key==='Enter')                         { e.preventDefault(); if(nextQueue.length){running=false;loadNextTimer();} return; }
    if (e.key==='ArrowUp')                       { e.preventDefault(); loadPresetByDirection(-1); return; }
    if (e.key==='ArrowDown'||e.key==='PageDown') { e.preventDefault(); loadPresetByDirection(1);  return; }
    return;
  }
  if (/^[nN]$/.test(e.key)&&!e.altKey) { e.preventDefault(); openNextModal();  return; }
  if (/^[uU]$/.test(e.key)&&!e.altKey) { e.preventDefault(); openUntilModal(); return; }
  if (/^[wW]$/.test(e.key)&&!e.altKey) { e.preventDefault(); openWarnModal();  return; }
  if (/^[0-9]$/.test(e.key)&&!e.altKey){ e.preventDefault(); kbPushDigit(e.key); return; }
  switch(e.key) {
    case 'Enter':     e.preventDefault(); keyBuf ? kbCommit() : (fullReset(DEFAULT_MINS),startTimer()); break;
    case ' ':         e.preventDefault(); clearKeyBuf(); remaining<0 ? (nextQueue.length ? loadNextTimer() : fullReset(DEFAULT_MINS), startTimer()) : running ? pauseTimer() : startTimer(); break;
    case 'Escape':    clearKeyBuf();
      // A blackout lifts first, so a kiosk can't be left covered if its remote is gone.
      if (blackout) { liftBlackout(); break; }
      if (toolbar.classList.contains('visible')) { hideToolbar(); break; }
      untilTarget ? (exitUntilMode(),running=false,applyState('idle')) : watchMode ? exitWatchMode() : kioskMode ? exitKiosk() : fsEl()&&fsLeave(); break;
    case 'ArrowUp':   e.preventDefault(); adjustMinutes(10);  break;
    case 'ArrowDown': e.preventDefault(); adjustMinutes(-5);  break;
    case 'ArrowLeft': e.preventDefault(); adjustMinutes(1);   break;
    case 'ArrowRight':e.preventDefault(); adjustMinutes(-1);  break;
    case 'PageUp':    e.preventDefault(); toggleKiosk(); break;
    case 'PageDown':  e.preventDefault(); toggleTheme();      break;
    case 'End':       e.preventDefault(); clearKeyBuf(); fullReset(); break;
    case 'Insert':    e.preventDefault(); cycleSoundMode(); break;
    case '`':         e.preventDefault(); playOTBell(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); clearKeyBuf(); startLabelEdit(); break;
    case 'Tab':       e.preventDefault(); btnMenu.focus(); showToolbar(); break;
    case 'Home':      e.preventDefault(); clearKeyBuf(); isManualOpen() ? closeManual() : openManual(); break;
  }
});

// ── Toolbar buttons ───────────────────────────────────
function tbBtn(id, fn, longFn) {
  const el=$(id); if (!el) return;
  el.addEventListener('touchstart', e=>e.stopPropagation(), {passive:true});
  el.addEventListener('click', e => { e.stopPropagation(); fn(); });
  if (!longFn) return;
  let tid=null, fired=false;
  const start  = () => { fired=false; tid=setTimeout(()=>{tid=null;fired=true;longFn();},800); };
  const cancel = () => { clearTimeout(tid); tid=null; };
  el.addEventListener('mousedown',  start); el.addEventListener('mouseup',    cancel);
  el.addEventListener('mouseleave', cancel); el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('touchend',   cancel, {passive:true});
  el.addEventListener('click', e => { if(fired){fired=false;e.stopImmediatePropagation();} }, true);
}

tbBtn('btn-next',         openNextModal);
tbBtn('btn-until-open',   openUntilModal);
tbBtn('btn-until-active', openUntilModal);
tbBtn('btn-reset',        ()=>fullReset(), ()=>{ showHint('full reset'); setTimeout(hardReset,600); });
tbBtn('btn-share',        shareTimer);
tbBtn('btn-fullscreen',   toggleKiosk);
tbBtn('btn-theme',        toggleTheme);
tbBtn('btn-warn',         openWarnModal);
tbBtn('btn-sound',        cycleSoundMode);
tbBtn('btn-clock-watch',  toggleWatchMode);

// Double-click on app also toggles kiosk (mouse equivalent of double-tap)
app.addEventListener('dblclick', e => { if (!isUIChrome(e.target)) readOnly() ? toggleFullscreen() : toggleKiosk(); });

;(()=>{
  const el=$('btn-sound'); let tid=null, fired=false;
  const start  = ()=>{fired=false;tid=setTimeout(()=>{tid=null;fired=true;playOTBell();},600);};
  const cancel = ()=>{clearTimeout(tid);tid=null;};
  el.addEventListener('touchstart',start,{passive:true}); el.addEventListener('mousedown',start);
  el.addEventListener('touchend',cancel,{passive:true});  el.addEventListener('mouseup',cancel);
  el.addEventListener('mouseleave',cancel);
  el.addEventListener('click',e=>{if(fired){fired=false;e.stopImmediatePropagation();}},true);
})();

toolbar.addEventListener('click',      e=>e.stopPropagation());
toolbar.addEventListener('touchstart', e=>e.stopPropagation(), {passive:true});

// btn-tick wired in showToolbar section above
tbBtn('btn-remote', openRemoteModal);
tbBtn('btn-install', installApp);
$('manual-close').addEventListener('click', closeManual);
$('manual-close').addEventListener('touchend', e=>{e.preventDefault();closeManual();}, {passive:false});
$('manual-close-float').addEventListener('click', e=>{e.stopPropagation();closeManual();});
manual.addEventListener('click', e=>{ if(e.target===manual) closeManual(); });

// ── Warn modal ────────────────────────────────────────
function openWarnModal() {
  $('warn1-input').value = warnSecs1 ?? ''; // empty shows "auto"
  $('warn2-input').value = warnSecs2;
  openModal('warn-modal');
  $('warn1-input').focus();
}
function saveWarnModal() {
  const v1 = parseInt($('warn1-input').value);
  const v2 = parseInt($('warn2-input').value) || 0;
  warnSecs1 = isNaN(v1) ? null : Math.max(0, Math.min(7200, v1)); // empty: automatic
  warnSecs2 = Math.max(0, Math.min(7200, v2));
  savePrefs();
  closeModal('warn-modal');
  showHint('WARN SAVED');
}
wireBtn('warn-save',   saveWarnModal);
wireBtn('warn-cancel', () => closeModal('warn-modal'));
backdropClose('warn-modal', () => closeModal('warn-modal'));
['warn1-input','warn2-input'].forEach(id => {
  $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); saveWarnModal(); }
    if (e.key === 'Escape') { e.preventDefault(); closeModal('warn-modal'); }
  });
});

// ── Install ───────────────────────────────────────────
// Browsers that can install the app say so with beforeinstallprompt; the
// button then opens their own install window. Elsewhere (Safari, Firefox)
// installing is in the browser's menu, and the button says where.
let installPrompt = null;
const btnInstall = $('btn-install');
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
btnInstall.hidden = isInstalled();
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; btnInstall.hidden = true; });
function installApp() {
  if (installPrompt) { installPrompt.prompt(); installPrompt = null; return; }
  showHint(isIOS ? 'Share → Add to Home Screen' : 'Install from the browser menu');
}

// ── REMOTE CONTROL ────────────────────────────────────
// A session has a six-letter code and one kiosk that holds the timer (the
// host). Any number of remote pads send it commands, and any number of other
// kiosks follow it read-only; the host tells them all its state. transport.js
// has the wiring; pad.js is the remote pad.
//
//   #remote=CODE  opens a remote pad (main.js loads pad.js instead of this)
//   #kiosk=CODE   opens a kiosk for that code: read-only while another kiosk
//                 holds the timer, and the host itself when none does

const HID = Math.random().toString(36).slice(2, 10); // this kiosk, among others
let remoteTransport = null;   // the host's transports, while hosting
let rcHostCode = '';          // the session's code
let hostSince = 0;            // when this page became the host
// A kiosk that became host with no timer of its own to offer: a pad that
// kept the timer hands it over.
let awaitingRestore = false;
let rcGeneration = 0, rcHeartbeat = null;
// Who is there: every pad and read-only kiosk says hello with an id, and then
// that it is alive. Silence for LOST_MS takes it off the list.
const clients = new Map(); // id → {role, seen}
const countRole = r => [...clients.values()].filter(c => c.role === r).length;
let everRemote = false;

// ── State snapshot sent host→clients ──────────────────────────────
function stateSnap() {
  return { type:'state', hid: HID, since: hostSince, uiState, remaining, totalSecs, customLabel, running, nextQueue: nextQueue.slice(),
    untilTarget, untilLabel, untilLen: untilLenSecs, fresh: awaitingRestore, prevCount: prevSessions.length,
    warn1: firstWarnSecs(), warn2: warnSecs2, black: blackout, watch: watchMode,
    started: isStarted(), full: isFull(), remotes: countRole('pad'), kiosks: 1 + countRole('mirror'),
    elapsed: T0_ABSSEC === null ? null : absSec() - T0_ABSSEC };
}
function broadcastState() { remoteTransport?.send(stateSnap()); }

// ── The remote window ─────────────────────────────────────────────
const btnRemote = $('btn-remote');
// The menu button says whether a session is on, and whether a remote is there.
function renderRemoteStatus() {
  const pads = countRole('pad'), mirrors = countRole('mirror');
  const st = role !== 'host' ? '' : pads ? 'connected' : 'waiting';
  btnRemote.textContent = st ? 'remote: ' + st : 'remote';
  btnRemote.classList.toggle('remote-on', st === 'connected');
  const el = $('remote-status');
  el.className = pads ? 'connected' : '';
  el.textContent = (pads ? `✓ ${pads > 1 ? pads + ' remotes' : 'remote'} connected` : 'waiting for remote…')
    + (mirrors ? ` · ${mirrors + 1} kiosks` : '');
}

function showRemoteView(view) {
  $('remote-share-view').hidden = view !== 'share';
  $('remote-join-view').hidden  = view !== 'join';
}
function openRemoteModal() {
  if (readOnly()) return;
  showRemoteView('share');
  if (role !== 'host') { rcHostCode = makeCode(); startHosting(false); }
  const url = remoteUrl(rcHostCode);
  $('remote-code-display').textContent = rcHostCode;
  // Too long for a code (it can't be, at this length): the link as text.
  const svg = qrSvg(url);
  $('remote-qr').replaceChildren(...(svg ? [svg] : []));
  $('remote-url-text').textContent = url; $('remote-url-text').hidden = !!svg;
  renderRemoteStatus();
  openModal('remote-modal');
}

// ── HOST SIDE ──────────────────────────────────────────────────────
function startHosting(fresh) {
  if (remoteTransport) return; // already running
  role = 'host'; hostSince = Date.now(); awaitingRestore = fresh;
  const gen = ++rcGeneration, code = rcHostCode;

  // BroadcastChannel — assigned at once, so a hello is answered.
  const bc = bcTransport(code);
  bc.onmessage = handleHostMessage;
  remoteTransport = { send(m){bc.send(m);}, close(){bc.close();} };
  // Announce, for clients already waiting on this code, and keep a
  // heartbeat: a client that hears nothing for a while says the kiosk is
  // gone, which it can't learn any other way over BroadcastChannel.
  bc.send({type:'hostHello'});
  clearInterval(rcHeartbeat);
  rcHeartbeat = setInterval(() => { pruneClients(); broadcastState(); }, HEARTBEAT_MS);

  // WebRTC — other devices; joins the BroadcastChannel once the broker answers.
  peerTransport(code, false,
    t => {
      // Stopped (or restarted) while PeerJS was loading: this peer belongs
      // to a code nobody is using any more.
      if (gen !== rcGeneration) { t.close(); return; }
      t.onmessage = handleHostMessage;
      remoteTransport = {
        send(m) { bc.send(m); t.send(m); },
        close() { bc.close(); t.close(); },
      };
    },
    err => {
      // The code is taken: a kiosk on another device holds the timer. A page
      // that came to be a kiosk for this code follows that one instead.
      if (gen === rcGeneration && err === 'unavailable-id' && joinedByCode) startMirror(code, true);
    }
  );
  renderRemoteStatus();
}

function stopHosting() {
  rcGeneration++; clearInterval(rcHeartbeat);
  remoteTransport?.close(); remoteTransport = null;
  clients.clear(); everRemote = false;
  if (role === 'host') role = 'solo';
  renderRemoteStatus();
}
function stopRemote() { stopHosting(); rcHostCode = ''; closeModal('remote-modal'); }

function clientsChanged() {
  // The first remote to connect turns this screen into the kiosk. Losing
  // the remote later leaves it that way: the audience screen shouldn't
  // suddenly sprout buttons because a phone went to sleep.
  if (countRole('pad') && !everRemote) {
    everRemote = true;
    closeModal('remote-modal');
    if (!kioskMode) enterKiosk();
    kioskByRemote = true; applyState(uiState); // drop the "click to start" hint
  }
  renderRemoteStatus(); broadcastState();
}
function noteClient(msg) {
  const cid = typeof msg.cid === 'string' ? msg.cid.slice(0, 16) : 'anon';
  const isNew = !clients.has(cid);
  clients.set(cid, {role: msg.role === 'mirror' ? 'mirror' : 'pad', seen: Date.now()});
  if (clients.size > 64) clients.delete(clients.keys().next().value);
  if (isNew) clientsChanged();
}
function pruneClients() {
  let gone = false;
  for (const [cid, c] of clients) if (Date.now() - c.seen >= LOST_MS) { clients.delete(cid); gone = true; }
  if (gone) renderRemoteStatus();
}

const seenCmdIds = new Set();
function handleHostMessage(msg) {
  if (!msg || typeof msg !== 'object' || role !== 'host') return;
  // Another kiosk says it holds this code (two tabs took it at once, or one
  // came back after being lost). The one that has held it longest keeps it;
  // the other follows.
  if (msg.type === 'state') {
    if (Number.isFinite(msg.since) && msg.hid !== HID &&
        (msg.since < hostSince || (msg.since === hostSince && String(msg.hid) < HID))) startMirror(rcHostCode);
    return;
  }
  if (msg.type === 'hello') { noteClient(msg); broadcastState(); return; }
  if (msg.type === 'ping')  { noteClient(msg); return; }
  if (msg.type === '_peerOpen') { broadcastState(); return; }
  if (msg.type === 'bye') { if (clients.delete(msg.cid)) { renderRemoteStatus(); broadcastState(); } return; }
  // A pad that kept the timer while it couldn't reach this kiosk (or that is
  // handing a new kiosk the timer) sends its version, and it wins.
  if (msg.type === 'sync') { applySync(msg.snap); broadcastState(); return; }
  if (msg.type === 'cmd') {
    if (typeof msg.cmd !== 'string') return;
    if (msg.id) {
      if (seenCmdIds.has(msg.id)) return;
      seenCmdIds.add(msg.id);
      if (seenCmdIds.size > 200) seenCmdIds.delete(seenCmdIds.values().next().value);
    }
    // Once a pad has driven this kiosk, a late hand-over would undo that.
    awaitingRestore = false;
    execRemoteCmd(msg.cmd);
    setTimeout(broadcastState, 50);
  }
  if (msg.type === 'opMsg') {
    const text = typeof msg.text === 'string' ? msg.text.slice(0, 40) : '';
    showOpMsg(text);
    remoteTransport?.send({type:'show', text}); // to the read-only kiosks
  }
}

// The timer as a pad holds it, adopted whole: after the kiosk was lost (the
// pad kept time meanwhile, so its version is the valid one), or by a new
// kiosk taking over. Checked like any other input from a pad.
function applySync(snap) {
  if (!snap || typeof snap !== 'object') return;
  awaitingRestore = false;
  if (Array.isArray(snap.nextQueue)) nextQueue = snap.nextQueue.map(toEntry).filter(Boolean);
  if (typeof snap.customLabel === 'string') customLabel = snap.customLabel.slice(0, 32);
  if (typeof snap.black === 'boolean') setBlackout(snap.black);
  // The session's elapsed time carries over too (a new kiosk counts on from it).
  if (Number.isFinite(snap.elapsed) && snap.elapsed >= 0) { T0_ABSSEC = absSec() - Math.floor(snap.elapsed); lastSessionSec = -1; }
  if (typeof snap.untilTarget === 'number' && snap.untilTarget > Date.now()) {
    enterUntilMode(snap.untilTarget, String(snap.untilLabel ?? '').slice(0, 12));
  } else if (Number.isFinite(snap.remaining)) {
    running = false; exitUntilMode(); bellRecord = null;
    const total = toMins(snap.totalSecs / 60); if (total) totalSecs = total * 60;
    remaining = resumeVal = Math.max(-(99*60+59), Math.min(999*60, Math.round(snap.remaining)));
    lastRenderedSec = null; bellRecord = null;
    if (snap.running) startTimer();
    else { applyState(remaining === totalSecs ? 'idle' : 'pause'); renderDigits(remaining); }
  }
  savePrefs(); renderSessionQueue(); applyState(uiState);
}

function execRemoteCmd(cmd) {
  if (cmd === 'toggle') { running ? pauseTimer() : doMainAction(); return; }
  if (cmd === 'start') { if (!running) doMainAction(); return; }
  if (cmd === 'pause') { if (running) pauseTimer(); return; }
  if (cmd === 'reset') { fullReset(); return; }
  if (cmd === 'bell')  { playOTBell(); remoteTransport?.send({type:'ring'}); return; }
  if (cmd === 'black') { setBlackout(!blackout); return; }
  if (cmd === 'next')  { if (nextQueue.length) { running=false; loadNextTimer(); } return; }
  if (cmd === 'prev')  { loadPrevTimer(); return; }
  if (cmd.startsWith('adj:')) {
    const n = parseInt(cmd.slice(4), 10);
    // Running: the time left moves. Not started: the length does.
    if (Number.isFinite(n) && Math.abs(n) <= 999) running ? adjustMinutes(n) : adjustLength(n);
    return;
  }
  if (cmd.startsWith('setQueue:')) {
    setPrefOwn('nextQueue');
    nextQueue = parseQueue(cmd.slice(9));
    savePrefs(); renderSessionQueue(); applyState(uiState);
    return;
  }
}

// ── A READ-ONLY KIOSK ──────────────────────────────────────────────
// A kiosk that joins a code another kiosk already holds follows it: it draws
// the host's timer, counts on by its own clock between updates, and takes no
// input. If the host goes quiet for good, it takes the code over and becomes
// the host — with the timer it was showing, or, if it never heard one, with
// whatever a remote pad hands it.
const joinedByCode = !!codeParam('kiosk');
let mirrorLink = null, mirrorTid = null, mirrorHeardAt = 0, mirrorSince = 0, mirrorPatience = 0;
let ownWarn = null, mirrorTicks = 0;
const FIRST_WAIT_MS = 600; // long enough for a kiosk in this browser to answer
function startMirror(code, peerTaken) {
  stopHosting(); leaveMirror(true);
  role = 'mirror'; rcHostCode = code;
  ownWarn ??= [warnSecs1, warnSecs2];
  document.body.classList.add('mirror');
  $('kiosk-tag').textContent = 'read only';
  closeModal('remote-modal'); hideToolbar();
  if (!kioskMode) enterKiosk();
  applyState(uiState); // drop the "click to start" hint
  mirrorHeardAt = 0; mirrorSince = Date.now();
  // How long to wait in silence before taking the code. Short at first: a
  // kiosk in this browser answers at once. Longer when another device is
  // known to hold the code, and with a random part, so that two read-only
  // kiosks don't both step up in the same moment.
  mirrorPatience = peerTaken ? LOST_MS : FIRST_WAIT_MS;
  mirrorLink = clientLink(code, 'mirror', msg => {
    if (msg.type === 'state') adoptSnap(msg);
    if (msg.type === 'show')  showOpMsg(typeof msg.text === 'string' ? msg.text.slice(0, 40) : '');
    if (msg.type === 'ring')  playOTBell();
  });
  mirrorTid = setInterval(() => {
    const quiet = Date.now() - (mirrorHeardAt || mirrorSince);
    if (quiet < mirrorPatience) {
      // Quiet for a while: dial the host again, now and then.
      if (quiet >= HEARTBEAT_MS * 1.5 && ++mirrorTicks % 4 === 0) mirrorLink.reconnect();
      return;
    }
    const heard = !!mirrorHeardAt;
    leaveMirror(true);
    kioskByRemote = true; rcHostCode = code;
    startHosting(!heard);
    applyState(uiState);
  }, 500);
}
// keep: stay a kiosk (it is about to host, or to follow again). Otherwise the
// page goes back to being an ordinary timer, with what it was showing.
function leaveMirror(keep) {
  if (role !== 'mirror') return;
  clearInterval(mirrorTid); mirrorLink?.close(); mirrorLink = null;
  role = 'solo';
  document.body.classList.remove('mirror');
  if (keep) return;
  rcHostCode = ''; setBlackout(false); renderUntilBtn();
  if (ownWarn) { [warnSecs1, warnSecs2] = ownWarn; ownWarn = null; }
  history.replaceState(null, '', location.pathname);
  exitKiosk(); applyState(uiState); renderRemoteStatus();
}

function adoptSnap(s) {
  if (role !== 'mirror') return;
  mirrorHeardAt = Date.now();
  mirrorPatience = LOST_MS + Math.random() * 2000;
  if (Array.isArray(s.nextQueue)) nextQueue = s.nextQueue.map(toEntry).filter(Boolean);
  if (typeof s.customLabel === 'string') customLabel = s.customLabel.slice(0, 32);
  setBlackout(!!s.black);
  if (Number.isFinite(s.warn1)) warnSecs1 = s.warn1;
  if (Number.isFinite(s.warn2)) warnSecs2 = s.warn2;
  const total = toMins(s.totalSecs / 60); if (total) totalSecs = total * 60;
  if (Number.isFinite(s.elapsed) && s.elapsed >= 0) {
    const t0 = absSec() - Math.floor(s.elapsed);
    if (T0_ABSSEC === null || Math.abs(T0_ABSSEC - t0) > 1) { T0_ABSSEC = t0; lastSessionSec = -1; }
  } else { T0_ABSSEC = null; sessionEl.textContent = '00:00'; }
  if (!!s.watch !== watchMode) toggleWatchMode();
  if (typeof s.untilTarget === 'number') {
    untilTarget = s.untilTarget; untilLabel = String(s.untilLabel ?? '').slice(0, 12);
    untilLenSecs = Number.isFinite(s.untilLen) ? s.untilLen : untilLenSecs;
  } else { untilTarget = null; untilLabel = ''; }
  if (!Number.isFinite(s.remaining)) return;
  const rem = Math.max(-(99*60+59), Math.min(999*60, Math.round(s.remaining)));
  if (s.running) {
    // Both screens count by their own clocks; the host's figure replaces this
    // one only when they disagree by more than the second a message can take.
    const mine = running ? (untilTarget ? Math.round((untilTarget - Date.now())/1000) : resumeVal - (absSec() - resumeAbsSec)) : NaN;
    if (!(Math.abs(mine - rem) <= 1)) {
      running = true; remaining = resumeVal = rem; resumeAbsSec = absSec(); lastRenderedSec = null; bellRecord = null;
      applyState(stateFor(rem)); renderDigits(rem);
    }
  } else {
    const ui = ['idle', 'reset', 'pause', 'next', 'until'].includes(s.uiState) ? s.uiState : 'pause';
    const changed = running || remaining !== rem || ui !== uiState;
    running = false; remaining = resumeVal = rem; lastRenderedSec = null;
    if (changed) { applyState(ui, ui === 'reset' ? 700 : 0); renderDigits(rem); }
  }
  sessionLabelEl.textContent = watchMode ? '' : customLabel;
  renderSessionQueue();
}

// ── Operator message ───────────────────────────────────────────────
let opMsgTid = null;
const OP_MSG_MS = 6000;
function showOpMsg(text) {
  clearTimeout(opMsgTid);
  document.body.classList.remove('op-msg-on');
  if (!text) return;
  $('op-msg').textContent = text;
  void document.body.offsetWidth; // restart the arrival flash for a new message
  document.body.classList.add('op-msg-on');
  opMsgTid = setTimeout(() => document.body.classList.remove('op-msg-on'), OP_MSG_MS);
}

// ── The remote window's buttons ────────────────────────────────────
// Join: this device takes part in another timer's session, as its remote or
// as one more screen for it. The code is checked here, so a typo says so
// instead of opening a page that waits for nobody.
const joinCode = () => {
  const inp = $('remote-join-code'), code = inp.value.trim().toUpperCase();
  if (CODE_RE.test(code)) return code;
  inp.focus(); inp.select(); showHint('Not a timer code');
  return '';
};
const joinAs = url => { const code = joinCode(); if (code) { stopRemote(); go(url(code)); } };
wireBtn('remote-join', () => joinAs(remoteUrl));
wireBtn('remote-join-kiosk', () => joinAs(kioskUrl));
// To the join view: this device is about to join another timer, so it stops
// offering a code of its own — unless a remote is already connected to it.
wireBtn('remote-to-join', () => {
  if (!countRole('pad')) { stopHosting(); rcHostCode = ''; }
  showRemoteView('join'); $('remote-join-code').focus();
});
wireBtn('remote-to-share', () => openRemoteModal());
wireBtn('remote-join-close', () => closeModal('remote-modal'));
$('remote-join-code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); joinAs(remoteUrl); } });
wireBtn('remote-stop',        stopRemote);
wireBtn('remote-modal-close', () => closeModal('remote-modal'));
wireBtn('remote-open-tab',    () => window.open(remoteUrl(rcHostCode), '_blank'));
backdropClose('remote-modal', () => closeModal('remote-modal'));

// Wrap renderDigits to broadcast state on each tick (throttled ~2/s)
const _origRenderDigits = renderDigits;
renderDigits = rem => {
  _origRenderDigits(rem);
  if (!renderDigits._throttle) {
    renderDigits._throttle = setTimeout(() => { renderDigits._throttle = null; broadcastState(); }, 500);
  }
};

$('blackout').addEventListener('dblclick', () => readOnly() ? toggleFullscreen() : liftBlackout());

// ── Init ──────────────────────────────────────────────
sessionQueue.addEventListener('click', e => { e.stopPropagation(); openNextModal(); });
renderPresets(); renderSessionQueue(); renderUntilBtn(); applyState('idle'); showToolbar(); renderDigits(remaining);
renderRemoteStatus();

// A kiosk opened for a code: it follows the kiosk that holds it, or holds it.
if (joinedByCode) startMirror(codeParam('kiosk'));
