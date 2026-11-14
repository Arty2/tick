// ── Queue notation ──────────────────────────────────
// A queue entry is {label, mins} or {label, at:'HH:MM'} — label may be ''.
// Written as sessions separated by "|", each "name>length":
//   Break>5   or  Break>5:00    a length, in minutes or as minutes:seconds
//   Wrap>[23:30]                a countdown to that time of day
//   15  or  [23:30]             the same with no name
// The length follows the last ">", so names may hold colons, commas, "@" and
// ">"; a "|" in a name is written "\|". Lengths are whole minutes: seconds
// round to the nearest minute. This is the one reader and the one writer:
// links, the queue window and the remote's queue box all go through them.
import { fmt, nextUntilMs } from './util.js';

// Whole minutes, 1–999, or 0 for "not a duration". Every source of minutes
// goes through this — links, saved data, the remote's queue — so none of them
// can produce a fractional, infinite or NaN countdown.
export const toMins = v => { const n = Math.floor(+v); return n >= 1 && n <= 999 ? n : 0; };

const p2 = n => String(n).padStart(2, '0');
const AT_RE = /^\[\s*(\d{1,2}):(\d{2})\s*\]$/;
// "5", or "5:00" (minutes:seconds) rounded to whole minutes.
const lengthMins = v => {
  const m = v.trim().match(/^(\d{1,3}):([0-5]\d)$/);
  return m ? toMins(Math.max(1, Math.round(+m[1] + m[2] / 60))) : toMins(v);
};
// The part after the name: a time of day in brackets, or a length.
export const parseLength = v => {
  const at = v.trim().match(AT_RE);
  if (at) { const h = +at[1], m = +at[2]; return h <= 23 && m <= 59 ? {at: `${p2(h)}:${p2(m)}`} : null; }
  const mins = lengthMins(v); return mins ? {mins} : null;
};
export const parseEntry = raw => {
  const s = raw.trim(); if (!s) return null;
  const sep = s.lastIndexOf('>');
  const len = parseLength(s.slice(sep + 1));
  return len ? {label: sep > 0 ? s.slice(0, sep).trim().slice(0, 32) : '', ...len} : null;
};
export const parseQueue = str =>
  str.split(/(?<!\\)\|/).map(x => parseEntry(x.replaceAll('\\|', '|'))).filter(Boolean);
// A session's length as it is written: minutes, or "[HH:MM]".
export const lengthStr = e => e.at ? `[${e.at}]` : String(e.mins);
const entryStr = e => (e.label ? String(e.label).replaceAll('|', '\\|') + '>' : '') + lengthStr(e);
export const queueStr = q => q.map(entryStr).join('|');
// How it reads in a line of text: "05:00", or "[HH:MM]".
export const entryTime = e => e.at ? `[${e.at}]` : p2(e.mins) + ':00';

// An entry from saved data or from another device: checked field by field,
// and dropped (null) when it can't be a session.
export const toEntry = e => {
  if (!e || typeof e !== 'object') return null;
  const label = typeof e.label === 'string' ? e.label.trim().slice(0, 32) : '';
  if (typeof e.at === 'string') { const t = parseLength('[' + e.at + ']'); return t ? {label, at: t.at} : null; }
  return toMins(e.mins) ? {label, mins: toMins(e.mins)} : null;
};

// ── A queue row, as the kiosk and the remote pad both list it ─────────
//       BREAK [triangle] 05:00
//        WRAP [triangle and bar] 30:00 [23:30]   — the time left, then the target
// Three cells: the name, the icon, the time. The list lays them out in
// columns (see .sq-queued in tick.css) with the icon in the middle of the
// page: names end against it, times start from it. Built from text nodes:
// names come from links and pads.
const secsUntil = at => { const [h, m] = at.split(':').map(Number); return Math.round((nextUntilMs(h, m) - Date.now()) / 1000); };
const el = (cls, text = '') => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
const icon = cls => { const i = el('ico ' + cls); i.setAttribute('aria-hidden', 'true'); return i; };
export function queueRow(entry, className) {
  const row = document.createElement('div');
  row.className = className;
  const rest = el('q-rest');
  if (entry.at) {
    const left = el('q-left', fmt(secsUntil(entry.at)));
    left.dataset.at = entry.at;
    rest.append(left, ` [${entry.at}]`);
  } else {
    rest.append(entryTime(entry));
  }
  // A space between the cells, for the row read as text.
  row.append(el('q-name', entry.label), ' ', icon(entry.at ? 'ico-target' : 'ico-play'), rest);
  return row;
}
export const tickQueueRows = root => root.querySelectorAll('.q-left').forEach(el => {
  const t = fmt(secsUntil(el.dataset.at)); if (el.textContent !== t) el.textContent = t;
});
