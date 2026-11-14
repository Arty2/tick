// The entry point. One page plays one of two parts, chosen by its link: the
// timer (timer.js), or a remote pad for another timer (pad.js). What both
// need first is done here.
import { $, params, loadPrefs } from './util.js';

// Theme: the link's for this visit, else the saved one.
const theme = params.get('theme') ?? '';
if (theme === 'light' || (!theme && loadPrefs().theme === 'light')) document.body.classList.add('light');

// <meta name="version"> is the version; sw.js repeats it only to name its
// cache, and scripts/gates.sh checks the two agree.
const version = 'v' + (document.querySelector('meta[name="version"]')?.content ?? '');
$('manual-version').textContent = version;
$('app-version').textContent = version;

// The settings are in the fragment, and a change of fragment alone (a pasted
// link, a typed code) doesn't load the page again: do it, so the link in the
// address bar is always the one in effect.
window.addEventListener('hashchange', () => { delete document.documentElement.dataset.ready; location.reload(); });

await import(params.has('remote') ? './pad.js' : './timer.js');
// The part is loaded and has drawn itself: the page can be used. (The load
// event comes too early to say so — it doesn't wait for the import above.)
document.documentElement.dataset.ready = '';

// The service worker keeps a copy of the app, so it opens with no network.
// Registered last: a page that failed to start shouldn't be the one cached.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
