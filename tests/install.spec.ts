import { readFileSync, readdirSync } from 'node:fs';
import { test, expect, open, visit, menu, freezeAt } from './fixtures';

// An installable web app: a manifest a browser accepts, icons it can use, and
// a service worker that lets the app open with no network.

test('the manifest names the app, starts at its own folder, and its icons are there', async ({ page }) => {
	await open(page);
	const href = await page.locator('link[rel="manifest"]').getAttribute('href');
	const res = await page.request.get('/' + href);
	expect(res.headers()['content-type']).toContain('application/manifest+json');
	const m = await res.json();
	expect(m.name).toBe('/tick');
	expect(m.display).toBe('standalone');
	expect(m.start_url).toBe('./');
	// What a browser asks for before it offers to install: a 192 and a 512 px icon.
	expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
	for (const icon of m.icons) {
		const got = await page.request.get('/' + icon.src);
		expect(got.status(), icon.src).toBe(200);
		expect(got.headers()['content-type'], icon.src).toContain(icon.type);
	}
	const png = readFileSync('app/icons/icon-512.png');
	expect(png.readUInt32BE(16)).toBe(512); // the PNG is the size it says
	expect(png.readUInt32BE(20)).toBe(512);
});

test('Install sits in the menu right after Share, on the left of the last row', async ({ page }) => {
	await open(page);
	await menu(page);
	await expect(page.locator('.tb-last .tb-btn')).toHaveText(['share', 'install', 'remote', 'kiosk']);
	const [row, share, install, remote, kiosk] = await Promise.all(
		['.tb-last', '#btn-share', '#btn-install', '#btn-remote', '#btn-fullscreen'].map(async (s) => (await page.locator(s).boundingBox())!)
	);
	expect(share.x - row.x).toBeLessThan(12); // share against the row's left edge
	expect(install.x).toBeGreaterThan(share.x);
	expect(install.x - (share.x + share.width)).toBeLessThan(12); // install right beside it
	expect(row.x + row.width - (kiosk.x + kiosk.width)).toBeLessThan(12); // kiosk against the right edge
	expect(remote.x - (install.x + install.width)).toBeGreaterThan(100); // and the row's width between the pairs
	// The last row is the menu's widest: nothing in the rows above starts left of Share.
	const lefts = await page.locator('.tb-group').evaluateAll((gs) => gs.map((g) => g.getBoundingClientRect().left));
	expect(Math.min(...lefts)).toBe(row.x);
	const help = (await page.locator('#btn-tick').boundingBox())!;
	expect(row.x).toBeGreaterThan(help.x + help.width); // clear of the ? button
});

test("where the browser has no install window to open, Install says where the browser's own is", async ({ page }) => {
	await open(page);
	await menu(page);
	await page.locator('#btn-install').click();
	await expect(page.locator('#status-hint')).toHaveText(/install from the browser menu/i);
});

test('Install opens the browser’s install window when it has offered one', async ({ page }) => {
	await open(page);
	await page.evaluate(() => {
		const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
			prompt: () => { (window as unknown as { prompted: boolean }).prompted = true; }
		});
		window.dispatchEvent(e);
	});
	await menu(page);
	await page.locator('#btn-install').click();
	expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
	await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
	await expect(page.locator('#btn-install')).toBeHidden(); // nothing left to install
});

test('the service worker lists every file of the app', () => {
	// The gates check this too; here it fails beside the offline test it explains.
	const listed = [...readFileSync('app/sw.js', 'utf8').match(/const FILES = \[([^\]]*)\]/)![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
	const shipped = (readdirSync('app', { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
		.filter((d) => d.isFile() && d.name !== 'sw.js' && !d.name.endsWith('.LICENSE'))
		.map((d) => (d.parentPath + '/' + d.name).replace(/^app\//, '').replace(/^index\.html$/, './'))
		.sort();
	expect(listed).toEqual(shipped);
});

test.describe('with the service worker on', () => {
	test.use({ serviceWorkers: 'allow' });

	test('once visited, the app opens with no network: the timer, and a remote pad', async ({ page, context }) => {
		await freezeAt(page, '2026-11-14T10:12:00');
		await visit(page, '/#mins=7');
		// The worker has taken its copy and taken charge of the page.
		await page.evaluate(() => navigator.serviceWorker.ready.then(() => new Promise<void>((done) => {
			if (navigator.serviceWorker.controller) return done();
			navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true });
		})));
		const cached = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).length);
		expect(cached).toBe(15);

		await context.setOffline(true);
		await visit(page, '/#mins=25&label=Offline');
		await expect(page.locator('#timer-display')).toHaveText('25:00');
		await expect(page.locator('#session-label')).toHaveText('Offline');
		await page.keyboard.press('Space');
		await expect(page.locator('#timer-display')).toHaveClass(/s-run/);

		// The pad's module was never fetched by this page; it comes from the copy.
		await visit(page, '/#remote=ABCDEF');
		await expect(page.locator('#remote-pad')).toBeVisible();
		await expect(page.locator('#rc-code-input')).toHaveValue('ABCDEF');
	});
});
