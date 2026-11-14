import { test, expect, open } from './fixtures';

// The counter is sized by both width and height, so it should never leave
// the screen: not on a portrait phone, not on a short landscape one, and not
// with hours, the widest thing it draws ("16H 39:00").
const screens = [
	[1280, 720],
	[390, 844],
	[320, 568],
	[844, 390],
	[1024, 600]
] as const;

for (const [width, height] of screens) {
	test(`the counter fits on one line on a ${width}×${height} screen`, async ({ page }) => {
		await page.setViewportSize({ width, height });
		for (const query of ['?mins=25&label=Keynote&next=Break:5,QA:10', '?mins=999']) {
			await open(page, query);
			const box = await page.evaluate(() => {
				const d = document.getElementById('timer-display')!;
				const r = document.createRange();
				r.selectNodeContents(d);
				const t = r.getBoundingClientRect();
				return { left: t.left, right: t.right, top: t.top, bottom: t.bottom, lines: r.getClientRects().length, line: parseFloat(getComputedStyle(d).fontSize) };
			});
			expect(box.left, query).toBeGreaterThanOrEqual(0);
			expect(box.right, query).toBeLessThanOrEqual(width);
			expect(box.top, query).toBeGreaterThanOrEqual(0);
			expect(box.bottom, query).toBeLessThanOrEqual(height);
			expect(box.bottom - box.top, `${query} wrapped`).toBeLessThan(box.line * 1.5);
		}
	});
}

test('the counter is regular weight', async ({ page }) => {
	await open(page);
	await expect(page.locator('#timer-display')).toHaveCSS('font-weight', '400');
});

test("the manual's title starts on the text's left edge", async ({ page }) => {
	await open(page);
	await page.keyboard.press('Home');
	const [title, text] = await page.evaluate(() => {
		const r = document.createRange();
		r.selectNodeContents(document.querySelector('#manual-h1-fixed h1')!);
		return [r.getBoundingClientRect().left, document.querySelector('#manual-inner p')!.getBoundingClientRect().left];
	});
	expect(Math.abs(title - text)).toBeLessThan(1);
});

test('the version shows at the top middle of the screen, and not in kiosk mode', async ({ page }) => {
	const { readFileSync } = await import('node:fs');
	const top = readFileSync('CHANGELOG.md', 'utf8').match(/^## (\d+\.\d+\.\d+) /m)?.[1];
	await open(page);
	const version = page.locator('#app-version');
	await expect(version).toHaveText('v' + top);
	const box = (await version.boundingBox())!;
	expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(1); // 1280 / 2
	expect(box.y).toBeLessThan(48);
	await page.keyboard.press('PageUp');
	await expect(version).toBeHidden();
});

test('the manual opens with the links and the credit', async ({ page }) => {
	await open(page);
	await page.keyboard.press('Home');
	const links = page.locator('#manual .manual-links a');
	await expect(links).toHaveText(['acari.vercel.app', 'github.com/Arty2/tick', 'heracl.es/tick']);
	await expect(links.nth(1)).toHaveAttribute('href', 'https://github.com/Arty2/tick');
	await expect(page.locator('#manual .manual-credit')).toHaveText('Dialectic Acheiropoieton of Heracles Papatheodorou and Claude');
	await expect(page.locator('#manual .manual-credit')).toBeInViewport();
});
