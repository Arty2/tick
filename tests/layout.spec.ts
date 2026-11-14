import { test, expect, open, menu } from './fixtures';

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

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 700 }, hasTouch: true });

	test('a menu row too long for the screen scrolls, from its first button to its last', async ({ page }) => {
		await open(page, '?next=Talk:10');
		await page.keyboard.press('u');
		await page.locator('#until-hour').press('Enter'); // "target: ▶ 10:30" makes the row long
		await menu(page);
		const row = page.locator('.tb-group', { has: page.locator('#btn-reset') });
		const edges = () =>
			row.evaluate((g) => {
				const shown = [...g.children].filter((c) => (c as HTMLElement).offsetParent);
				const box = g.getBoundingClientRect();
				return { overflow: g.scrollWidth > g.clientWidth, first: shown[0].getBoundingClientRect().left - box.left, last: box.right - shown.at(-1)!.getBoundingClientRect().right };
			});
		const start = await edges();
		expect(start.overflow).toBe(true);
		expect(start.first).toBeGreaterThanOrEqual(0); // nothing hidden off the left
		await row.evaluate((g) => (g.scrollLeft = g.scrollWidth));
		expect((await edges()).last).toBeGreaterThanOrEqual(0); // and the end is reachable
	});

	test('a short menu row still sits on the right', async ({ page }) => {
		await open(page);
		await menu(page);
		const gap = await page.locator('.tb-group', { has: page.locator('#btn-theme') }).evaluate((g) => {
			const box = g.getBoundingClientRect();
			return box.right - g.lastElementChild!.getBoundingClientRect().right;
		});
		expect(gap).toBeLessThan(20);
	});

	test('the open menu covers the ? button', async ({ page }) => {
		await open(page);
		await menu(page);
		const box = (await page.locator('#btn-tick').boundingBox())!;
		const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)!.closest('#toolbar, #btn-tick')?.id, [box.x + box.width / 2, box.y + box.height / 2]);
		expect(top).toBe('toolbar');
	});

	test("the manual's title bar holds only the title; name and version are below", async ({ page }) => {
		await open(page);
		await page.keyboard.press('Home');
		await expect(page.locator('#manual-h1-fixed h1')).toHaveText('Manual');
		await expect(page.locator('#manual .manual-app')).toContainText('/tick v');
		const title = (await page.locator('#manual-h1-fixed h1').boundingBox())!;
		const text = await page.locator('#manual-h1-fixed h1').evaluate((h) => {
			const r = document.createRange();
			r.selectNodeContents(h);
			return r.getBoundingClientRect().right;
		});
		const close = (await page.locator('#manual-close').boundingBox())!;
		expect(text).toBeLessThan(close.x);
		void title;
	});
});

test('the target-time preview shows only the time left', async ({ page }) => {
	await open(page, '', '2026-11-14T10:12:00');
	await page.keyboard.press('u');
	await expect(page.locator('#until-preview')).toHaveText('18:00');
});

// The operator message is sent from a pad; here it is shown the way the
// kiosk shows one, through the same BroadcastChannel message.
async function sendOpMsg(page: import('@playwright/test').Page, text: string) {
	await menu(page);
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	await page.evaluate(([code, text]) => new BroadcastChannel('tick-rc-' + code).postMessage({ type: 'opMsg', text }), [code, text]);
}

for (const [width, height] of [[1280, 720], [390, 844], [844, 390], [320, 568]] as const) {
	test(`an operator message is solid and fits beside the shrunken time on ${width}×${height}`, async ({ page }) => {
		await page.setViewportSize({ width, height });
		await open(page, '?mins=25&label=Keynote&next=Break:5,QA:10');
		await page.keyboard.press('Space');
		const before = await page.locator('#timer-display').evaluate((d) => parseFloat(getComputedStyle(d).fontSize));
		await sendOpMsg(page, 'Please wrap up in two minutes'); // near the 40-character limit
		await page.keyboard.press('Escape');
		const msg = page.locator('#op-msg');
		await expect(msg).toBeVisible();
		await page.clock.runFor(1_000); // past the arrival flash
		const look = await msg.evaluate((m) => ({ opacity: getComputedStyle(m).opacity, bg: getComputedStyle(m).backgroundColor }));
		expect(look.opacity).toBe('1');
		expect(look.bg).not.toMatch(/rgba\(.*, 0\.\d+\)|transparent/); // a solid colour
		await page.waitForTimeout(400); // let the shrink finish before measuring
		const after = await page.locator('#timer-display').evaluate((d) => parseFloat(getComputedStyle(d).fontSize));
		expect(after).toBeLessThan(before);
		// Element boxes: the time's box is its line (line-height 1), which holds
		// the digits; its text range also counts the font's ascent above them.
		const boxes = await page.evaluate(() =>
			['op-msg', 'timer-display'].map((id) => {
				const b = document.getElementById(id)!.getBoundingClientRect();
				return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
			})
		);
		const [m, t] = boxes;
		expect(m.bottom).toBeLessThanOrEqual(t.top + 1); // the message doesn't cover the time
		for (const b of boxes) {
			expect(b.top).toBeGreaterThanOrEqual(0);
			expect(b.bottom).toBeLessThanOrEqual(height);
			expect(b.left).toBeGreaterThanOrEqual(0);
			expect(b.right).toBeLessThanOrEqual(width);
		}
		await page.clock.runFor(6_000);
		await expect(msg).toBeHidden();
		// The size eases back over 0.3 s of real time (CSS transitions don't follow the fake clock).
		await expect.poll(() => page.locator('#timer-display').evaluate((d) => parseFloat(getComputedStyle(d).fontSize))).toBe(before);
	});
}
