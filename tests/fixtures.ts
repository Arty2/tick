import { test as base, expect, type Page } from '@playwright/test';

/*
 * Every test runs with the outside world switched off and watched. tick.html
 * is meant to work from file:// with no network, so a test that only passes
 * because some third-party host answered is a test of that host. Anything
 * off-origin is aborted and recorded; `offsite` lets a test assert on it.
 * Console errors and uncaught exceptions are collected the same way, and a
 * test fails at the end if there were any it didn't expect — a test that
 * expects one removes it from `errors` after asserting on it.
 */
export const test = base.extend<{ offsite: string[]; errors: string[] }>({
	offsite: [async ({ context }, use) => {
		const hits: string[] = [];
		await context.route(
			(url) => url.hostname !== 'localhost',
			(route) => {
				hits.push(route.request().url());
				return route.abort();
			}
		);
		// context.route sees HTTP only; PeerJS's broker is a WebSocket.
		await context.routeWebSocket(
			(url) => url.hostname !== 'localhost',
			(ws) => {
				hits.push(ws.url());
				return ws.close();
			}
		);
		await use(hits);
	}, { auto: true }],
	// auto: set up for every test, not only those that name the fixture —
	// Playwright skips a fixture nobody asks for, which once left most of
	// the suite with the network open and console errors unchecked.
	errors: [async ({ page }, use) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		page.on('console', (m) => {
			// An aborted off-site request logs a console error by design.
			if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text());
		});
		await use(errors);
		expect(errors, 'console errors or uncaught exceptions').toEqual([]);
	}, { auto: true }]
});
export { expect };

/**
 * Pauses the page's clock at `time`. An installed clock otherwise keeps
 * flowing in real time, and on a loaded machine a few real seconds leaked
 * into every countdown. Installed a second early because pauseAt refuses a
 * time the clock has already passed, and a few real milliseconds do pass.
 */
export async function freezeAt(page: Page, time: string) {
	await page.clock.install({ time: new Date(+new Date(time) - 1000) });
	await page.clock.pauseAt(new Date(time));
}

/** Opens tick.html with a paused clock, so time only moves when a test says so. */
export async function open(page: Page, query = '', time = '2026-11-14T10:12:00') {
	await freezeAt(page, time);
	await page.goto('/tick.html' + query);
	await page.clock.runFor(50);
}

export const digits = (page: Page) => page.locator('#timer-display');
export const label = (page: Page) => page.locator('#label-text');

/** The toolbar opens itself on load and hides after a few seconds; skip that. */
export async function settle(page: Page) {
	await page.clock.runFor(6000);
}

/**
 * Chromium commits localStorage writes to the browser process asynchronously;
 * a reload within milliseconds of a write can read the old value. No user
 * reloads that fast, so tests wait a moment of real time before reloading.
 */
export const letStorageSettle = (page: Page) => page.waitForTimeout(250);

/**
 * Opens the toolbar menu if it isn't open already. On load it is open, and
 * with the clock paused its 5-second auto-hide never runs; tests that once
 * waited for that in real time leaked those seconds into their countdowns.
 */
export async function menu(page: Page) {
	if (!(await page.locator('#toolbar').evaluate((t) => t.classList.contains('visible'))))
		await page.locator('#btn-menu').click();
}
