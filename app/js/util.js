// What the timer and the remote pad both need: element lookup, time
// formatting, the settings in the link, and the small window helpers.

export const $ = id => document.getElementById(id);
export const pad = n => String(n).padStart(2, '0');
export const absSec = () => Math.floor(Date.now() / 1000);

export function fmt(secs) {
  const sign = secs < 0 ? '+' : '', abs = Math.abs(secs);
  const h = Math.floor(abs/3600), m = Math.floor((abs%3600)/60), s = abs%60;
  return h > 0 ? `${sign}${h}:${pad(m)}:${pad(s)}` : `${sign}${pad(m)}:${pad(s)}`;
}
// The next time the clock reads h:m — today, or tomorrow if that has passed.
export const nextUntilMs = (h, m) => { const t = new Date(); t.setHours(h, m, 0, 0); if (t <= new Date()) t.setDate(t.getDate() + 1); return t.getTime(); };

// ── Settings in the link ──────────────────────────────
// After "#", not "?": a browser never sends the fragment to the server, so a
// session's name, its queue and a remote code stay on the device.
export const params = new URLSearchParams(location.hash.slice(1));
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const codeParam = name => { const v = (params.get(name) ?? '').toUpperCase(); return CODE_RE.test(v) ? v : ''; };
export const makeCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
export const baseUrl = location.origin + location.pathname;
export const remoteUrl = code => `${baseUrl}#remote=${code}`;
export const kioskUrl  = code => `${baseUrl}#kiosk=${code}`;
// A change of fragment alone doesn't load the page again, so say so.
// (The ready mark comes off first: this page is on its way out.)
export const go = url => { delete document.documentElement.dataset.ready; location.href = url; location.reload(); };

export const copyText = text => (navigator.clipboard?.writeText(text) ?? Promise.reject()).catch(() => {
  const inp = Object.assign(document.createElement('input'), {value: text});
  document.body.append(inp); inp.select(); document.execCommand('copy'); inp.remove();
});
export const haptic = () => { try { navigator.vibrate?.(50); } catch {} };

// ── Saved settings ────────────────────────────────────
// Saved data is migrated, not trusted: it may be an older version's shape,
// hand-edited, or garbage. Whoever reads a field checks it.
export const PREFS_KEY = 'tick_prefs';
export const loadPrefs = () => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {}; } catch {}
  return p && typeof p === 'object' ? p : {};
};

// ── Windows ───────────────────────────────────────────
export const openModal = id => $(id).classList.add('open');
// Closing a window also takes the cursor out of it: a hidden field that
// kept focus swallowed every shortcut until the page was clicked.
export const closeModal = id => {
  const m = $(id);
  if (m.contains(document.activeElement)) document.activeElement.blur();
  m.classList.remove('open');
};
export const isAnyModalOpen = () => !!document.querySelector('.modal-overlay.open');
export const wireBtn = (id, fn) => $(id)?.addEventListener('click', e => { e.stopPropagation(); fn(); });
export const backdropClose = (id, fn) => $(id).addEventListener('click', e => { if (e.target === $(id)) fn(); });
