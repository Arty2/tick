// ── Queue notation ──────────────────────────────────
// A queue entry is {label, mins} or {label, at:'HH:MM'} — label may be ''.
// Written as sessions separated by "|": "name:minutes", "minutes",
// "name@HH:MM" or "@HH:MM" (a countdown to that time of day). Minutes follow
// the last colon, so names may hold colons and commas; a "|" in a name is
// written "\|". This is the one reader and the one writer: links, the queue
// window and the remote's queue box all go through them.

// Whole minutes, 1–999, or 0 for "not a duration". Every source of minutes
// goes through this — links, saved data, the remote's queue — so none of them
// can produce a fractional, infinite or NaN countdown.
export const toMins = v => { const n = Math.floor(+v); return n >= 1 && n <= 999 ? n : 0; };

const p2 = n => String(n).padStart(2, '0');
const AT_RE = /@\s*(\d{1,2}):(\d{2})\s*$/;

export const parseEntry = raw => {
  const s = raw.trim(); if (!s) return null;
  const at = s.match(AT_RE);
  if (at) {
    const h = +at[1], m = +at[2];
    return h <= 23 && m <= 59 ? {label: s.slice(0, at.index).trim().slice(0, 32), at: `${p2(h)}:${p2(m)}`} : null;
  }
  const col = s.lastIndexOf(':');
  if (col > 0) { const mins = toMins(s.slice(col+1)); return mins ? {label: s.slice(0, col).trim().slice(0, 32), mins} : null; }
  const mins = toMins(s); return mins ? {label: '', mins} : null;
};
export const parseQueue = str =>
  str.split(/(?<!\\)\|/).map(x => parseEntry(x.replaceAll('\\|', '|'))).filter(Boolean);
const entryStr = e => (e.label ? String(e.label).replaceAll('|', '\\|') : '') + (e.at ? '@' + e.at : (e.label ? ':' : '') + e.mins);
export const queueStr = q => q.map(entryStr).join('|');
// How a queued session's length reads in a list: minutes, or "@HH:MM".
export const entryTime = e => e.at ? '@' + e.at : p2(e.mins) + ':00';

// An entry from saved data or from another device: checked field by field,
// and dropped (null) when it can't be a session.
export const toEntry = e =>
  e && typeof e === 'object' && typeof e.at === 'string' ? parseEntry((typeof e.label === 'string' ? e.label.replaceAll('@', '') : '') + '@' + e.at)
  : e && typeof e === 'object' && toMins(e.mins) ? {label: typeof e.label === 'string' ? e.label.slice(0,32) : '', mins: toMins(e.mins)} : null;
