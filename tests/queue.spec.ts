import { test, expect, open, digits, menu, visit } from './fixtures';

// Queue notation: sessions separated by "|"; "name:minutes", "minutes",
// "name@HH:MM" or "@HH:MM".
const q = (s: string) => '&next=' + encodeURIComponent(s);
const rows = (page: import('@playwright/test').Page) => page.locator('.sq-queued');

test('a pipe-separated queue reads, with commas and colons free in names', async ({ page }) => {
	await open(page, '#mins=20' + q('Break:5|Q&A, panel:10|Panel@10:30|15'), '2026-11-14T10:12:00');
	await expect(rows(page)).toHaveText(['▶ 05:00 Break', '▶ 10:00 Q&A, panel', '▶ @10:30 Panel', '▶ 15:00']);
});

test('an @HH:MM session counts down to that time of day when it loads', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('tick_prefs', '{}'));
	await open(page, '#mins=1&label=Talk' + q('Panel@10:30'), '2026-11-14T10:12:00');
	await page.keyboard.press('Space');
	await page.clock.fastForward(61_500); // Talk runs out at 10:13:01
	await page.clock.runFor(100);
	await expect(page.locator('#session-label')).toHaveText('Panel');
	await expect(digits(page)).toHaveText(/^16:5\d$/); // 10:13:01 → 10:30
	await page.clock.fastForward(60_000);
	await page.clock.runFor(100);
	await expect(digits(page)).toHaveText(/^15:5\d$/); // and it runs
});

test('commas are part of a name, never a separator', async ({ page }) => {
	await open(page, '#mins=20' + q('Q&A, panel:10'));
	await expect(rows(page)).toHaveText(['\u25B6 10:00\u2002Q&A, panel']);
	await open(page, '#mins=20&next=Break:5,QA:10'); // one session, named "Break:5,QA"
	await expect(rows(page)).toHaveText(['\u25B6 10:00\u2002Break:5,QA']);
});

test('share writes the queue with pipes, and a "|" in a name survives the trip', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await open(page, '#mins=20' + q('Break:5|Panel@10:30'), '2026-11-14T10:12:00');
	await page.keyboard.press('n');
	await page.locator('.qr-label').first().fill('A|B');
	await page.locator('#next-set').click();
	await menu(page);
	await page.locator('#btn-share').click();
	const url = await page.evaluate(() => navigator.clipboard.readText());
	expect(new URLSearchParams(new URL(url).hash.slice(1)).get('next')).toBe('A\\|B:5|Panel@10:30');
	const other = await context.newPage();
	await visit(other, url);
	await expect(rows(other)).toHaveText(['▶ 05:00 A|B', '▶ @10:30 Panel']);
});

test('the queue window takes @HH:MM in the minutes box', async ({ page }) => {
	await open(page, '#mins=20' + q('Break:5'), '2026-11-14T10:12:00');
	await page.keyboard.press('n');
	await page.locator('.qr-label').first().fill('Lunch');
	await page.locator('.qr-mins').first().fill('@12:30');
	await page.locator('#next-set').click();
	await expect(rows(page)).toHaveText(['▶ @12:30 Lunch']);
	await page.keyboard.press('n');
	await expect(page.locator('.qr-mins').first()).toHaveValue('@12:30');
});

test("the remote's queue box writes and reads the same notation", async ({ page, context }) => {
	await open(page, '#mins=20' + q('Break:5|Panel@10:30'), '2026-11-14T10:12:00');
	await menu(page);
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	const pad = await context.newPage();
	await visit(pad, '/#remote=' + code);
	await pad.clock.runFor(200);
	const box = pad.locator('#rc-queue-input');
	await expect(box).toHaveValue('Break:5|Panel@10:30');
	await expect(pad.locator('#rc-queue-display .rc-q-row')).toHaveText(['▶︎ 05:00 Break', '▶︎ @10:30 Panel']);
	await box.fill('Wrap@11:00|QA:10');
	await box.press('Enter');
	await expect(rows(page)).toHaveText(['▶ @11:00 Wrap', '▶ 10:00 QA']);
});
