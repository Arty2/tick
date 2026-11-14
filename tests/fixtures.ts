import { test as base, expect, type Page } from '@playwright/test';

/*
 * Every test runs with the outside world switched off and watched. tick.html
 * is meant to work from file:// with no network, so a test that only passes
 * because some third-party host answered is a test of that host. Anything
 * off-origin is aborted and recorded; `offsite` lets a test assert on it.
 * Console errors and uncaught exceptions are collected the same way, and a
 * test fails at the end if there were any it didn't expect.
 */
export const test = base.extend<{ offsite: string[]; errors: string[] }>({
	offsite: async ({ context }, use) => {
		const hits: string[] = [];
		await context.route(
			(url) => url.hostname !== 'localhost',
			(route) => {
				hits.push(route.request().url());
				return route.abort();
			}
		);
		await use(hits);
	},
	errors: async ({ page }, use) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		page.on('console', (m) => {
			// An aborted off-site request logs a console error by design.
			if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text());
		});
		await use(errors);
		expect(errors, 'console errors or uncaught exceptions').toEqual([]);
	}
});
export { expect };

/** Opens tick.html with a frozen clock, so time only moves when a test says so. */
export async function open(page: Page, query = '', time = '2026-11-14T10:12:00') {
	await page.clock.install({ time: new Date(time) });
	await page.goto('/tick.html' + query);
	await page.clock.runFor(50);
}

export const digits = (page: Page) => page.locator('#timer-display');
export const label = (page: Page) => page.locator('#label-text');

/** The toolbar opens itself on load and hides after a few seconds; skip that. */
export async function settle(page: Page) {
	await page.clock.runFor(6000);
}
