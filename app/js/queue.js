// ── Queue notation ──────────────────────────────────
// A queue entry is {label, mins} or {label, at:'HH:MM'} — label may be ''.
// Written as sessions separated by "|": "name@minutes", "minutes",
// "name>HH:MM" or ">HH:MM" (a countdown to that time of day). Minutes follow
// the last "@", so names may hold colons, commas and "@"; a "|" in a name is
// written "\|". This is the one reader and the one writer: links, the queue
// window and the remote's queue box all go through them.
import { fmt, nextUntilMs } from './util.js';

// Whole minutes, 1–999, or 0 for "not a duration". Every source of minutes
// goes through this — links, saved data, the remote's queue — so none of them
// can produce a fractional, infinite or NaN countdown.
export const toMins = v => { const n = Math.floor(+v); return n >= 1 && n <= 999 ? n : 0; };

const p2 = n => String(n).padStart(2, '0');
const AT_RE = />\s*(\d{1,2}):(\d{2})\s*$/;

export const parseEntry = raw => {
  const s = raw.trim(); if (!s) return null;
  const at = s.match(AT_RE);
  if (at) {
    const h = +at[1], m = +at[2];
    return h <= 23 && m <= 59 ? {label: s.slice(0, at.index).trim().slice(0, 32), at: `${p2(h)}:${p2(m)}`} : null;
  }
  const sep = s.lastIndexOf('@');
  if (sep > 0) { const mins = toMins(s.slice(sep+1)); return mins ? {label: s.slice(0, sep).trim().slice(0, 32), mins} : null; }
  const mins = toMins(s.replace(/^@/, '')); return mins ? {label: '', mins} : null;
};
export const parseQueue = str =>
  str.split(/(?<!\\)\|/).map(x => parseEntry(x.replaceAll('\\|', '|'))).filter(Boolean);
const entryStr = e => (e.label ? String(e.label).replaceAll('|', '\\|') : '') + (e.at ? '>' + e.at : (e.label ? '@' : '') + e.mins);
export const queueStr = q => q.map(entryStr).join('|');
// How a queued session's length reads in a line of text: minutes, or ">HH:MM".
export const entryTime = e => e.at ? '>' + e.at : p2(e.mins) + ':00';

// An entry from saved data or from another device: checked field by field,
// and dropped (null) when it can't be a session.
export const toEntry = e => {
  if (!e || typeof e !== 'object') return null;
  const label = typeof e.label === 'string' ? e.label.trim().slice(0, 32) : '';
  if (typeof e.at === 'string') { const t = parseEntry('>' + e.at); return t ? {label, at: t.at} : null; }
  return toMins(e.mins) ? {label, mins: toMins(e.mins)} : null;
};

// ── A queue row, as the kiosk and the remote pad both list it ─────────
// A length:        [triangle] 05:00  Name
// A time of day:   14:30 [triangle and bar] 17:59  Name   — the target, and
//                  the time left until it (kept current by tickQueueRows).
// Built from text nodes: names come from links and from remote pads.
const secsUntil = at => { const [h, m] = at.split(':').map(Number); return Math.round((nextUntilMs(h, m) - Date.now()) / 1000); };
const icon = cls => { const i = document.createElement('span'); i.className = 'ico ' + cls; i.setAttribute('aria-hidden', 'true'); return i; };
export function queueRow(entry, className) {
  const row = document.createElement('div');
  row.className = className;
  const name = entry.label ? '\u2002' + entry.label : '';
  if (entry.at) {
    const left = document.createElement('span');
    left.className = 'q-left'; left.dataset.at = entry.at; left.textContent = fmt(secsUntil(entry.at));
    row.append(entry.at + ' ', icon('ico-target'), left, name);
  } else {
    row.append(icon('ico-play'), entryTime(entry) + name);
  }
  return row;
}
export const tickQueueRows = root => root.querySelectorAll('.q-left').forEach(el => {
  const t = fmt(secsUntil(el.dataset.at)); if (el.textContent !== t) el.textContent = t;
});
