import { test, expect, open, digits, settle } from './fixtures';

test('URL parameters set duration, label, queue, theme and sound', async ({ page, errors }) => {
	await open(page, '?mins=25&label=Keynote&next=Break:5,10&theme=light&sound=2');
	await expect(digits(page)).toHaveText('25:00');
	await expect(page.locator('#session-label')).toHaveText('Keynote');
	await expect(page.locator('.sq-queued')).toHaveCount(2);
	await expect(page.locator('body')).toHaveClass(/light/);
	await expect(page.locator('#btn-sound')).toHaveText('sound: min');
	void errors;
});

test('preferences survive a reload; URL parameters do not overwrite them', async ({ page, errors }) => {
	await open(page);
	await page.keyboard.press('PageDown'); // theme → light, saved
	await expect(page.locator('body')).toHaveClass(/light/);
	await page.goto('/tick.html?theme=dark');
	await expect(page.locator('body')).not.toHaveClass(/light/);
	await page.goto('/tick.html');
	await expect(page.locator('body')).toHaveClass(/light/);
	void errors;
});

test('a queue saved by an older version (plain minutes) still loads', async ({ page, errors }) => {
	await page.addInitScript(() => {
		if (!sessionStorage.getItem('seeded')) {
			localStorage.setItem('tick_prefs', JSON.stringify({ nextQueue: [5, 15] }));
			sessionStorage.setItem('seeded', '1');
		}
	});
	await open(page);
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 05:00', '▶ 15:00']);
	void errors;
});

test('unreadable saved preferences fall back to defaults instead of breaking the page', async ({ page, errors }) => {
	await page.addInitScript(() => localStorage.setItem('tick_prefs', '{not json'));
	await open(page);
	await expect(digits(page)).toHaveText('10:00');
	void errors;
});

test('share copies a URL that restores the same timer', async ({ page, context, errors }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await open(page, '?mins=12&label=Panel&next=QA:8');
	await page.locator('#btn-menu').click();
	await page.locator('#btn-share').click();
	const url = await page.evaluate(() => navigator.clipboard.readText());
	expect(new URL(url).searchParams.get('next')).toBe('QA:8');

	const other = await context.newPage();
	await other.goto(url);
	await expect(other.locator('#timer-display')).toHaveText('12:00');
	await expect(other.locator('#session-label')).toHaveText('Panel');
	await expect(other.locator('.sq-queued')).toHaveText(['▶ 08:00 QA']);
	void errors;
});

test('the manual opens with the version CHANGELOG.md heads with', async ({ page, errors }) => {
	const { readFileSync } = await import('node:fs');
	const top = readFileSync('CHANGELOG.md', 'utf8').match(/^## (\d+\.\d+\.\d+) /m)?.[1];
	await open(page);
	await settle(page);
	await page.keyboard.press('Home');
	await expect(page.locator('#manual')).toHaveClass(/open/);
	await expect(page.locator('#manual-version')).toHaveText('v' + top);
	void errors;
});
