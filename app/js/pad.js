// The remote pad: the page opened with #remote=CODE. It shows the kiosk's
// timer, sends it commands, and keeps the timer going if the kiosk is lost.
// Loaded by main.js instead of timer.js.
import { $, pad, fmt, nextUntilMs, codeParam, remoteUrl, kioskUrl, go, copyText, haptic,
  openModal, closeModal, wireBtn, backdropClose, CODE_RE } from './util.js';
import { parseQueue, queueStr, queueRow } from './queue.js';
import { clientLink, LOST_MS } from './transport.js';
import { qrSvg } from './qr.js';

// #remote=CODE opens the pad for that timer. #remote with no code, or one
// that can't be a code, still opens the pad, waiting for a code to be typed.
const CODE = codeParam('remote');

$('remote-pad').classList.add('open');
$('app').style.display = 'none';
$('toolbar').style.display = 'none';
// The kiosk's top line, elapsed time left and clock right, reused as is:
// moved into the pad under its status bar. The clock is this device's; the
// elapsed time is the kiosk's, from its snapshots.
const topBar = $('top-bar'), sessionEl = $('session-timer'), wallClock = $('wall-clock');
$('rc-preview').prepend(topBar);
topBar.classList.add('in-pad');
const tickClock = () => { const d = new Date(); wallClock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
tickClock(); setInterval(tickClock, 250);

const statusBar = $('remote-status-bar');
const stateDisp = $('remote-state-display');
const labelDisp = $('remote-label-display');

const STATE_COLORS = {
  idle:'var(--c-idle)',run:'var(--c-run)',warn:'var(--c-warn)',warn2:'var(--c-warn)',
  pause:'var(--c-pause)',ot:'var(--c-ot)',reset:'var(--c-reset)',
  next:'var(--c-next)',until:'var(--c-until)',watch:'var(--c-watch)'
};
const ADJ_BTNS = [...document.querySelectorAll('.rc-btn[data-rc^="adj:"]')];

function rcApplyState(snap) {
  stateDisp.textContent = fmt(snap.remaining);
  stateDisp.classList.toggle('local', kioskLost());
  stateDisp.style.color = STATE_COLORS[snap.uiState] ?? 'var(--fg)';
  // The colour already says running, paused or overtime; the line under
  // the time is for the session's name, and stays empty without one.
  labelDisp.textContent = snap.customLabel || '';
  // The queue, as the kiosk shows it: a NEXT heading, then one row per
  // session with its length and name. Built from text nodes only — names
  // come from whoever set the queue.
  const qd = $('rc-queue-display');
  qd.replaceChildren();
  if (Array.isArray(snap.nextQueue) && snap.nextQueue.length) {
    const head = document.createElement('div'); head.className = 'rc-q-head'; head.textContent = 'Next';
    qd.append(head);
    for (const e of snap.nextQueue) {
      qd.append(queueRow(e, 'rc-q-row'));
    }
  }
  // The queue box: written in the same form the box reads (and a share
  // link uses), unless it is being edited.
  if (!rcQueueDirty && document.activeElement !== rcQueueInput && Array.isArray(snap.nextQueue))
    rcQueueInput.value = queueStr(snap.nextQueue);
  // Black is lit while the kiosk is covered.
  $('rc-black').classList.toggle('on', !!snap.black);
  $('rc-black').setAttribute('aria-pressed', String(!!snap.black));
  // Prev and Next are greyed out when there's nowhere to go.
  $('rc-prev').disabled = !snap.prevCount || kioskLost(); // the history lives on the kiosk
  $('rc-next').disabled = !(snap.nextQueue?.length);
  // Nothing to reset before the start; and the minute buttons work on a
  // running count, or on the length of one that hasn't started.
  $('rc-reset').disabled = !snap.started;
  for (const b of ADJ_BTNS) b.disabled = !!snap.untilTarget || !(snap.running || snap.full);
  // Start and pause share one button, which says what a press will do.
  const tg = $('rc-toggle');
  tg.querySelector('.ico').className = 'ico ' + (snap.running ? 'ico-pause' : 'ico-play');
  tg.querySelector('.lbl').textContent = snap.running ? 'Pause' : 'Start';
  tg.classList.toggle('hi-pause', !!snap.running);
  tg.classList.toggle('hi-start', !snap.running);
  // Other remotes on the same timer, as a number: "+1" is one besides this.
  const others = kioskLost() ? 0 : Math.max(0, (snap.remotes | 0) - 1);
  const badge = $('rc-others');
  badge.hidden = !others;
  badge.textContent = '+' + others;
  badge.title = others === 1 ? '1 other remote' : others + ' other remotes';
  badge.setAttribute('aria-label', badge.title);
}

function rcSetStatus(s, msg) {
  statusBar.textContent = msg;
  statusBar.className   = s === 'conn' ? 'conn' : s === 'err' ? 'err' : '';
}

let link = null;

// Commands go over every open transport (WebRTC and BroadcastChannel), so
// a pad in the same browser reaches the kiosk twice; the id lets it run once.
let rcCmdSeq = 0;
const rcCmdBase = Math.random().toString(36).slice(2, 8);
function sendCmd(cmd) {
  // While the kiosk is lost, this pad's copy is the timer: commands act on it.
  if (kioskLost()) { localCmd(cmd); return; }
  link?.send({type:'cmd', cmd, id: `${rcCmdBase}-${++rcCmdSeq}`});
}

document.querySelectorAll('.rc-btn[data-rc]').forEach(btn => {
  btn.addEventListener('click', () => { haptic(); sendCmd(btn.dataset.rc); });
});

// The queue box follows the kiosk's queue until someone starts editing it;
// Set sends it back, and an empty box clears the queue.
const rcQueueSend = $('rc-queue-send'), rcQueueInput = $('rc-queue-input');
let rcQueueDirty = false;
rcQueueInput.addEventListener('input', () => { rcQueueDirty = true; });
const sendQueue = () => {
  haptic(); sendCmd('setQueue:' + rcQueueInput.value.trim());
  rcQueueDirty = false; rcQueueInput.blur();
};
rcQueueSend.addEventListener('click', sendQueue);
rcQueueInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendQueue(); } });

// Operator message: typed here, shown on the kiosk for the presenter.
const rcMsgInput = $('rc-msg-input');
const rcMsgSend = $('rc-msg-send'), rcMsgClear = $('rc-msg-clear'), rcMsgPreview = $('rc-msg-preview');
const sendMsg = text => { haptic(); link?.send({type:'opMsg', text}); };
// Send has something to send only with text in the box, and then takes the
// message band's orange. Clear has something to clear with text in the box
// or a message still up on the kiosk.
const msgButtons = () => {
  const typed = !!rcMsgInput.value.trim();
  rcMsgSend.disabled = !typed;
  rcMsgSend.classList.toggle('hi-warn', typed);
  rcMsgClear.disabled = !typed && rcMsgPreview.hidden;
};
// The message as the kiosk shows it, for as long as it shows it there. The
// kiosk says when it puts one up (to every pad, so all of them see it).
let msgTid = null;
const MSG_MS = 6000; // as long as the kiosk shows it
function previewMsg(text) {
  clearTimeout(msgTid);
  rcMsgPreview.textContent = text; rcMsgPreview.hidden = !text;
  if (text) msgTid = setTimeout(() => previewMsg(''), MSG_MS);
  msgButtons();
}
rcMsgInput.addEventListener('input', msgButtons);
rcMsgSend.addEventListener('click', () => {
  const text = rcMsgInput.value.trim(); if (!text) return;
  sendMsg(text); rcMsgInput.value = ''; msgButtons();
});
rcMsgClear.addEventListener('click', () => { rcMsgInput.value = ''; sendMsg(''); msgButtons(); });
msgButtons();
rcMsgInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('rc-msg-send').click(); } });

// The code field: shows this pad's code; Enter on another code switches to
// that timer (a fresh page, so nothing of the old connection lingers).
const codeInput = $('rc-code-input');
codeInput.value = CODE;
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  codeInput.classList.toggle('bad', codeInput.value.length === 6 && !CODE_RE.test(codeInput.value));
});
codeInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const code = codeInput.value.trim().toUpperCase();
  if (!CODE_RE.test(code)) { codeInput.classList.add('bad'); return; }
  if (code !== CODE) go(remoteUrl(code));
});

// Another kiosk: a link and QR code that open one more screen for this
// timer. It follows the kiosk that is there, or takes over from one that is
// lost and carries on with the timer this pad hands it.
const newKioskUrl = kioskUrl(CODE);
$('rc-new-kiosk').disabled = !CODE;
if (CODE) { const mini = qrSvg(newKioskUrl); if (mini) $('rc-new-kiosk').append(mini); }
$('rc-new-kiosk').addEventListener('click', () => {
  haptic();
  const svg = qrSvg(newKioskUrl);
  $('rc-kiosk-qr').replaceChildren(...(svg ? [svg] : []));
  $('rc-kiosk-url').textContent = newKioskUrl; // shown with the QR, for copying by eye
  openModal('rc-kiosk-modal');
});
wireBtn('rc-kiosk-close', () => closeModal('rc-kiosk-modal'));
wireBtn('rc-kiosk-open', () => window.open(newKioskUrl, '_blank'));
wireBtn('rc-kiosk-copy', () => copyText(newKioskUrl));
backdropClose('rc-kiosk-modal', () => closeModal('rc-kiosk-modal'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal('rc-kiosk-modal'); });

// ── The pad's copy of the timer ──────────────────────────────────
// The last state the kiosk sent (model) and when (modelAt); a running count
// moves on from there by the clock. While the kiosk answers, it is a view
// of the kiosk. While the kiosk is lost, it is the timer: it keeps counting,
// the buttons act on it, and when the kiosk answers again it is sent over
// and wins — the kiosk was the one out of touch. Except when this pad knows
// it was itself offline: then the kiosk's timer wins, and the pad adopts it.
let model = null, modelAt = 0, lastHeardAt = 0, padWasOffline = false, rcHeard = false;
const kioskLost = () => rcHeard && Date.now() - lastHeardAt >= LOST_MS;
const modelRemaining = () => !model ? 0
  : model.untilTarget ? Math.round((model.untilTarget - Date.now()) / 1000)
  : model.running ? model.remaining - Math.floor((Date.now() - modelAt) / 1000)
  : model.remaining;
const rebase = () => {
  const moved = Math.floor((Date.now() - modelAt) / 1000);
  model = {...model, remaining: modelRemaining(), elapsed: Number.isFinite(model.elapsed) ? model.elapsed + moved : model.elapsed};
  modelAt = Date.now();
};
// What the kiosk would say of the copy, worked out here while it can't.
const localUi = rem => model.untilTarget ? (rem < 0 ? 'ot' : 'until')
  : rem < 0 ? 'ot'
  : !model.running ? (rem === model.totalSecs ? 'idle' : 'pause')
  : (model.warn2 > 0 && rem <= model.warn2) ? 'warn2'
  : (model.warn1 > 0 && rem <= model.warn1) ? 'warn' : 'run';
const localFlags = rem => ({
  started: !!model.running || Number.isFinite(model.elapsed) || !!model.untilTarget,
  full: !model.running && !model.untilTarget && rem === model.totalSecs,
});
// The next session taken into the pad's copy, as the kiosk would load it.
const loadLocal = (m, e) => {
  const [h, mm] = (e.at ?? '').split(':').map(Number);
  return e.at
    ? Object.assign(m, {customLabel: e.label || '', untilTarget: nextUntilMs(h, mm), untilLabel: '▶ ' + e.at, running: true})
    : Object.assign(m, {customLabel: e.label || '', totalSecs: e.mins*60, remaining: e.mins*60, untilTarget: null, untilLabel: ''});
};
function localCmd(cmd) {
  if (!model) return;
  rebase();
  const m = model, untilOn = !!m.untilTarget;
  if (cmd === 'toggle' || cmd === 'start' || cmd === 'pause') {
    if (!untilOn) m.running = cmd === 'start' ? true : cmd === 'pause' ? false : !m.running;
    if (m.running && !Number.isFinite(m.elapsed)) m.elapsed = 0; // a first start begins the session
  } else if (cmd.startsWith('adj:')) {
    const n = parseInt(cmd.slice(4), 10);
    if (!Number.isFinite(n) || untilOn) { /* nothing to move */ }
    else if (m.running) m.remaining = Math.max(-(99*60+59), m.remaining + n*60);
    // Not started: the buttons change the length, as they do on the kiosk.
    else if (m.remaining === m.totalSecs) m.remaining = m.totalSecs = Math.min(999, Math.max(1, Math.round(m.totalSecs/60) + n)) * 60;
  } else if (cmd === 'reset') {
    Object.assign(m, {running: false, remaining: m.totalSecs, untilTarget: null, untilLabel: '', elapsed: null});
  } else if (cmd === 'next' && m.nextQueue?.length) {
    const [e, ...rest] = m.nextQueue;
    Object.assign(m, {nextQueue: rest, running: false, uiState: 'next'});
    loadLocal(m, e);
  } else if (cmd.startsWith('setQueue:')) {
    m.nextQueue = parseQueue(cmd.slice(9));
  } else if (cmd === 'black') {
    m.black = !m.black; // takes effect on the kiosk with the sync when it's back
  }
  rcRender();
}
// Drawn from the copy four times a second, so the count runs smoothly and
// carries on by itself when the kiosk stops answering.
function rcRender() {
  if (!model) return;
  let rem = modelRemaining();
  const lost = kioskLost();
  if (lost && model.running && !model.untilTarget && rem < 0 && model.nextQueue?.length) {
    // Time ran out with the kiosk away: hand over to the next session here,
    // as the kiosk would have.
    const [e, ...rest] = model.nextQueue;
    model = loadLocal({...model, nextQueue: rest}, e);
    modelAt = Date.now(); rem = modelRemaining();
  }
  rcApplyState({...model, remaining: rem, ...(lost ? {uiState: localUi(rem), ...localFlags(rem)} : {})});
  // Elapsed time since the session started, moved on by the clock like the count.
  sessionEl.textContent = Number.isFinite(model.elapsed) ? fmt(model.elapsed + Math.floor((Date.now() - modelAt) / 1000)) : '00:00';
}
setInterval(rcRender, 250);

function rcOnState(msg) {
  const wasLost = kioskLost();
  // Hand our copy over instead of taking the kiosk's: to a new kiosk taking
  // over (fresh), or to a kiosk that was lost while this pad stayed online.
  if (model && ((msg.fresh && !model.fresh) || (wasLost && !padWasOffline))) {
    rebase();
    link?.send({type:'sync', snap: model});
    lastHeardAt = Date.now(); padWasOffline = false;
    rcSetStatus('conn', 'Connected'); rcRender();
    return; // the kiosk answers with its new state, which is ours
  }
  padWasOffline = false;
  model = msg; modelAt = lastHeardAt = Date.now();
  rcHeard = true; rcSetStatus('conn', 'Connected'); rcRender();
}
// This pad's own connection. Offline, it says so; whatever it does then is
// overruled by the kiosk once both can talk again.
window.addEventListener('offline', () => { padWasOffline = true; rcSetStatus('err', '⚠️ Offline'); });
function rcOnMessage(msg) {
  if (msg.type === 'state') rcOnState(msg);
  if (msg.type === 'show') previewMsg(typeof msg.text === 'string' ? msg.text.slice(0, 40) : '');
  if (msg.type === '_peerOpen') { lastHeardAt = Date.now(); rcHeard = true; rcSetStatus('conn', 'Connected'); }
}
setInterval(() => {
  if (!kioskLost()) return;
  rcSetStatus('err', padWasOffline ? '⚠️ Offline' : '⚠️ Kiosk lost');
  link?.reconnect();
}, 1000);

// A remote in the hand shouldn't go dark mid-session. The lock is dropped by
// the browser whenever the page is hidden, so it is asked for again each time
// the page comes back, and on a first touch where a gesture is needed.
let wakeLock = null;
const keepAwake = () => {
  if (wakeLock || document.hidden) return;
  navigator.wakeLock?.request('screen').then(wl => { wakeLock = wl; wl.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
};
keepAwake();
document.addEventListener('visibilitychange', keepAwake);
document.addEventListener('pointerdown', keepAwake, {passive: true});

if (CODE) {
  rcSetStatus('', 'connecting…');
  // WebRTC failed: BroadcastChannel only, so only this browser's tabs.
  link = clientLink(CODE, 'pad', rcOnMessage, () => { if (!rcHeard) rcSetStatus('', 'This browser only'); });
  setTimeout(() => { if (!rcHeard) rcSetStatus('err', '⚠️ No connection'); }, 8000);
} else {
  rcSetStatus('', 'Enter a code'); codeInput.focus();
}
