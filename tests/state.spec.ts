import { test, expect, open, reopen, digits, settle, letStorageSettle, menu, freezeAt, visit } from './fixtures';

test('settings in the link set duration, label, queue, theme and sound', async ({ page }) => {
	await open(page, '#mins=25&label=Keynote&next=Break@5|10&theme=light&sound=1');
	await expect(digits(page)).toHaveText('25:00');
	await expect(page.locator('#session-label')).toHaveText('Keynote');
	await expect(page.locator('.sq-queued')).toHaveCount(2);
	await expect(page.locator('body')).toHaveClass(/light/);
	await expect(page.locator('#btn-sound')).toHaveAttribute('aria-pressed', 'true');
});

test('preferences survive a reload; settings in a link do not overwrite them', async ({ page }) => {
	await open(page);
	await page.keyboard.press('PageDown'); // theme → light, saved
	await expect(page.locator('body')).toHaveClass(/light/);
	await letStorageSettle(page);
	await reopen(page, '#theme=dark');
	await expect(page.locator('body')).not.toHaveClass(/light/);
	await reopen(page);
	await expect(page.locator('body')).toHaveClass(/light/);
});

test('unreadable saved preferences fall back to defaults instead of breaking the page', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('tick_prefs', '{not json'));
	await open(page);
	await expect(digits(page)).toHaveText('10:00');
});

test('share copies a URL that restores the same timer', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await open(page, '#mins=12&label=Panel&next=QA@8');
	await menu(page);
	await page.locator('#btn-share').click();
	const url = await page.evaluate(() => navigator.clipboard.readText());
	expect(url).not.toContain('?'); // nothing a server would be sent
	expect(new URLSearchParams(new URL(url).hash.slice(1)).get('next')).toBe('QA@8');

	const other = await context.newPage();
	await visit(other, url);
	await expect(other.locator('#timer-display')).toHaveText('12:00');
	await expect(other.locator('#session-label')).toHaveText('Panel');
	await expect(other.locator('.sq-queued')).toHaveText(['08:00 QA']);
});

test('the manual opens with the version CHANGELOG.md heads with', async ({ page }) => {
	const { readFileSync } = await import('node:fs');
	const top = readFileSync('CHANGELOG.md', 'utf8').match(/^## (\d+\.\d+\.\d+) /m)?.[1];
	await open(page);
	await settle(page);
	await page.keyboard.press('Home');
	await expect(page.locator('#manual')).toHaveClass(/open/);
	await expect(page.locator('#manual-version')).toHaveText('v' + top);
});

test('a queue emptied on purpose stays empty after a reload', async ({ page }) => {
	await open(page);
	await expect(page.locator('.sq-queued')).toHaveCount(1); // first-visit default
	await page.keyboard.press('n');
	await page.locator('.qr-del').click();
	await page.locator('#next-set').click();
	await letStorageSettle(page);
	await page.reload();
	await page.clock.runFor(50);
	await expect(page.locator('.sq-queued')).toHaveCount(0);
});

test('malformed saved presets and queue entries are dropped, not fatal', async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'tick_prefs',
			JSON.stringify({
				presets: [null, { label: 'Talk', mins: 20 }, 'x', { mins: -3 }, {}],
				nextQueue: [null, { label: 'QA', mins: 5 }, { mins: 'lots' }],
				warnSecs1: 'soon',
				sound: 9
			})
		)
	);
	await open(page);
	await expect(digits(page)).toHaveText('10:00');
	await expect(page.locator('.sq-queued')).toHaveText(['05:00 QA']);
	await expect(page.locator('.preset-btn')).toHaveText(['+', 'Talk', '+', '+', '+']);
	await expect(page.locator('#btn-sound')).toHaveAttribute('aria-pressed', 'false');
});

test("the app is at the root of the site, and the link's settings are not sent to the server", async ({ page }) => {
	await freezeAt(page, '2026-11-14T10:12:00');
	const asked: string[] = [];
	page.on('request', (r) => asked.push(r.url()));
	await visit(page, '/#mins=7&label=Short');
	await expect(page.locator('#timer-display')).toHaveText('07:00');
	await expect(page.locator('#session-label')).toHaveText('Short');
	await expect(page).toHaveURL(/\/#mins=7&label=Short$/);
	expect(asked.length).toBeGreaterThan(3); // the page, its style and its modules
	expect(asked.filter((u) => /mins|Short|[?#]/.test(u))).toEqual([]);
});

test('the page is served with the security policy from vercel.json', async ({ page }) => {
	const res = await page.goto('/');
	const csp = res!.headers()['content-security-policy'];
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("object-src 'none'");
	// Scripts from this origin only, none written into the page; and the one
	// outside host is the remote's broker (see README § External services).
	expect(csp).toContain("script-src 'self';");
	expect(csp.match(/(https?|wss):\/\/[^\s;]+/g)).toEqual(['https://0.peerjs.com', 'wss://0.peerjs.com']);
	expect(res!.headers()['x-frame-options']).toBe('DENY');
});

test("a share link's settings don't replace the user's own when something saves", async ({ page }) => {
	await page.addInitScript(() => {
		if (!sessionStorage.getItem('seeded')) {
			localStorage.setItem('tick_prefs', JSON.stringify({ theme: 'dark', sound: 0, nextQueue: [{ label: 'Mine', mins: 5 }] }));
			sessionStorage.setItem('seeded', '1');
		}
	});
	await open(page, '#mins=1&next=Talk@2&theme=light&sound=1&label=Linked');
	await page.keyboard.press('Space');
	await page.clock.fastForward(62_000); // the hand-over saves
	await letStorageSettle(page);
	await reopen(page);
	await expect(page.locator('body')).not.toHaveClass(/light/);
	await expect(page.locator('#btn-sound')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('.sq-queued')).toHaveText(['05:00 Mine']);
});

test('deleting a queue row keeps what was typed into the others', async ({ page }) => {
	await open(page, '#next=A@5|B@10');
	await page.keyboard.press('n');
	await page.locator('.qr-label').first().fill('Keynote');
	await page.locator('.qr-del').nth(1).click();
	await expect(page.locator('.qr-label')).toHaveCount(1);
	await expect(page.locator('.qr-label')).toHaveValue('Keynote');
});

test('minutes typed past 999 are kept at 999, not lost on reload', async ({ page }) => {
	await open(page);
	await menu(page);
	await page.locator('.preset-btn').nth(3).click(); // an empty slot opens its editor
	await page.locator('#preset-mins-input').fill('1200');
	await page.locator('#preset-mins-input').press('Enter');
	await letStorageSettle(page);
	await page.reload();
	await expect(page.locator('.preset-btn').nth(3)).toHaveText('999m');
});

test('labels with colons and commas survive a share link', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await open(page);
	await page.keyboard.press('n');
	await page.locator('.qr-label').first().fill('Q&A: panel, part 2');
	await page.locator('#next-set').click();
	await menu(page);
	await page.locator('#btn-share').click();
	const url = await page.evaluate(() => navigator.clipboard.readText());
	const other = await context.newPage();
	await visit(other, url);
	await expect(other.locator('.sq-queued')).toHaveText(['10:00 Q&A: panel, part 2']);
});

test("a hand-over saves the new slot's label with the shortened queue", async ({ page }) => {
	await page.addInitScript(() => {
		if (!sessionStorage.getItem('seeded')) {
			localStorage.setItem('tick_prefs', JSON.stringify({ customLabel: 'Intro', nextQueue: [{ label: 'Talk', mins: 20 }, { label: 'QA', mins: 10 }] }));
			sessionStorage.setItem('seeded', '1');
		}
	});
	await open(page, '#mins=1');
	await page.keyboard.press('Space');
	await page.clock.fastForward(61_500); // overtime starts at −1 s
	await page.clock.runFor(100);
	await expect(page.locator('#session-label')).toHaveText('Talk');
	await letStorageSettle(page);
	await page.reload();
	await expect(page.locator('#session-label')).toHaveText('Talk');
	await expect(page.locator('.sq-queued')).toHaveText(['10:00 QA']);
});


test("share opens the device's share window with the link, where there is one", async ({ page }) => {
	await open(page, '#mins=12&label=Panel');
	await page.evaluate(() => {
		const w = window as unknown as { shared: unknown };
		Object.defineProperty(navigator, 'share', { configurable: true, value: (data: unknown) => { w.shared = data; return Promise.resolve(); } });
	});
	await menu(page);
	await page.locator('#btn-share').click();
	const shared = await page.evaluate(() => (window as unknown as { shared: { title: string; url: string } }).shared);
	expect(shared.title).toBe('Acari');
	expect(new URLSearchParams(new URL(shared.url).hash.slice(1)).get('label')).toBe('Panel');
	await expect(page.locator('#status-hint')).not.toHaveText(/copied/i); // shared, not copied
});

test('a share window that fails falls back to copying; one that is closed does nothing', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await open(page, '#mins=12');
	const stub = (name: string) => page.evaluate((name) => {
		Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new DOMException('no', name)) });
	}, name);
	await stub('AbortError');
	await menu(page);
	await page.locator('#btn-share').click();
	await page.clock.runFor(100);
	await expect(page.locator('#status-hint')).not.toHaveClass(/show/);
	await stub('NotAllowedError');
	await page.locator('#btn-share').click();
	await expect(page.locator('#status-hint')).toHaveText(/copied/i);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('#mins=12');
});

test('with sound on, the bell rings once when the time runs out, and not again each minute', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem('tick_prefs', JSON.stringify({ nextQueue: [] })); // nothing to hand over to
		const w = window as unknown as { rings: number };
		w.rings = 0;
		const start = OscillatorNode.prototype.start;
		let last = -1;
		OscillatorNode.prototype.start = function (when?: number) {
			// One bell is several oscillators started at the same instant.
			if (when !== last) { last = when ?? 0; w.rings++; }
			return start.call(this, when);
		};
	});
	await open(page, '#mins=1&sound=1');
	await page.keyboard.press('Space');
	await page.clock.fastForward(61_000);
	await page.clock.runFor(200);
	await expect(page.locator('#label-text')).toHaveText('OVERTIME');
	const rings = () => page.evaluate(() => (window as unknown as { rings: number }).rings);
	const atEnd = await rings();
	expect(atEnd).toBeGreaterThan(0);
	await page.clock.fastForward(185_000); // three more minutes of overtime
	await page.clock.runFor(200);
	expect(await rings()).toBe(atEnd);
});
