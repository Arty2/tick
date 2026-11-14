import { test, expect, open, digits, settle, letStorageSettle, menu, freezeAt } from './fixtures';

test('URL parameters set duration, label, queue, theme and sound', async ({ page }) => {
	await open(page, '?mins=25&label=Keynote&next=Break:5,10&theme=light&sound=2');
	await expect(digits(page)).toHaveText('25:00');
	await expect(page.locator('#session-label')).toHaveText('Keynote');
	await expect(page.locator('.sq-queued')).toHaveCount(2);
	await expect(page.locator('body')).toHaveClass(/light/);
	await expect(page.locator('#btn-sound')).toHaveText('sound: min');
});

test('preferences survive a reload; URL parameters do not overwrite them', async ({ page }) => {
	await open(page);
	await page.keyboard.press('PageDown'); // theme → light, saved
	await expect(page.locator('body')).toHaveClass(/light/);
	await letStorageSettle(page);
	await page.goto('/tick.html?theme=dark');
	await expect(page.locator('body')).not.toHaveClass(/light/);
	await page.goto('/tick.html');
	await expect(page.locator('body')).toHaveClass(/light/);
});

test('a queue saved by an older version (plain minutes) still loads', async ({ page }) => {
	await page.addInitScript(() => {
		if (!sessionStorage.getItem('seeded')) {
			localStorage.setItem('tick_prefs', JSON.stringify({ nextQueue: [5, 15] }));
			sessionStorage.setItem('seeded', '1');
		}
	});
	await open(page);
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 05:00', '▶ 15:00']);
});

test('unreadable saved preferences fall back to defaults instead of breaking the page', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('tick_prefs', '{not json'));
	await open(page);
	await expect(digits(page)).toHaveText('10:00');
});

test('share copies a URL that restores the same timer', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await open(page, '?mins=12&label=Panel&next=QA:8');
	await menu(page);
	await page.locator('#btn-share').click();
	const url = await page.evaluate(() => navigator.clipboard.readText());
	expect(new URL(url).searchParams.get('next')).toBe('QA:8');

	const other = await context.newPage();
	await other.goto(url);
	await expect(other.locator('#timer-display')).toHaveText('12:00');
	await expect(other.locator('#session-label')).toHaveText('Panel');
	await expect(other.locator('.sq-queued')).toHaveText(['▶ 08:00 QA']);
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
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 05:00 QA']);
	await expect(page.locator('.preset-btn')).toHaveText(['+', 'Talk', '+', '+', '+']);
	await expect(page.locator('#btn-sound')).toHaveText('sound: off');
});

test('the bare domain redirects to tick.html and keeps the timer in the query', async ({ page }) => {
	await freezeAt(page, '2026-11-14T10:12:00');
	await page.goto('/?mins=7&label=Short');
	await expect(page).toHaveURL(/\/tick\.html\?mins=7&label=Short$/);
	await expect(page.locator('#timer-display')).toHaveText('07:00');
});

test('the page is served with the security policy from vercel.json', async ({ page }) => {
	const res = await page.goto('/tick.html');
	const csp = res!.headers()['content-security-policy'];
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("object-src 'none'");
	// The remote's third parties, and only those (see README § What leaves this machine).
	expect(csp).toContain('https://cdn.jsdelivr.net');
	expect(csp).toContain('https://api.qrserver.com');
	expect(res!.headers()['x-frame-options']).toBe('DENY');
});

test("a share link's settings don't replace the user's own when something saves", async ({ page }) => {
	await page.addInitScript(() => {
		if (!sessionStorage.getItem('seeded')) {
			localStorage.setItem('tick_prefs', JSON.stringify({ theme: 'dark', sound: 0, nextQueue: [{ label: 'Mine', mins: 5 }] }));
			sessionStorage.setItem('seeded', '1');
		}
	});
	await open(page, '?mins=1&next=Talk:2&theme=light&sound=2&label=Linked');
	await page.keyboard.press('Space');
	await page.clock.fastForward(62_000); // the hand-over saves
	await letStorageSettle(page);
	await page.goto('/tick.html');
	await expect(page.locator('body')).not.toHaveClass(/light/);
	await expect(page.locator('#btn-sound')).toHaveText('sound: off');
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 05:00 Mine']);
});

test('deleting a queue row keeps what was typed into the others', async ({ page }) => {
	await open(page, '?next=A:5,B:10');
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
	await other.goto(url);
	await expect(other.locator('.sq-queued')).toHaveText(['▶ 10:00 Q&A: panel, part 2']);
});

test("a hand-over saves the new slot's label with the shortened queue", async ({ page }) => {
	await page.addInitScript(() => {
		if (!sessionStorage.getItem('seeded')) {
			localStorage.setItem('tick_prefs', JSON.stringify({ customLabel: 'Intro', nextQueue: [{ label: 'Talk', mins: 20 }, { label: 'QA', mins: 10 }] }));
			sessionStorage.setItem('seeded', '1');
		}
	});
	await open(page, '?mins=1');
	await page.keyboard.press('Space');
	await page.clock.fastForward(61_500); // overtime starts at −1 s
	await page.clock.runFor(100);
	await expect(page.locator('#session-label')).toHaveText('Talk');
	await letStorageSettle(page);
	await page.reload();
	await expect(page.locator('#session-label')).toHaveText('Talk');
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 10:00 QA']);
});

test('a first warning saved as the old fixed default becomes automatic', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('tick_prefs', JSON.stringify({ warnSecs1: 120 })));
	await open(page);
	await page.keyboard.press('w');
	await expect(page.locator('#warn1-input')).toHaveValue('');
});
