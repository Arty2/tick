import { test, expect, open, digits, menu, visit } from './fixtures';

// Queue notation: sessions separated by "|"; "name@minutes", "minutes",
// "name>HH:MM" or ">HH:MM".
const q = (s: string) => '&next=' + encodeURIComponent(s);
const rows = (page: import('@playwright/test').Page) => page.locator('.sq-queued');

test('a pipe-separated queue reads, with commas and colons free in names', async ({ page }) => {
	await open(page, '#mins=20' + q('Break@5|Q&A, panel@10|Panel>10:30|15'), '2026-11-14T10:12:00');
	await expect(rows(page)).toHaveText(['05:00 Break', '10:00 Q&A, panel', /^10:30\s\d\d:\d\d\sPanel$/, '15:00']);
});

test('a >HH:MM session counts down to that time of day when it loads', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('tick_prefs', '{}'));
	await open(page, '#mins=1&label=Talk' + q('Panel>10:30'), '2026-11-14T10:12:00');
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
	await open(page, '#mins=20' + q('Q&A, panel@10'));
	await expect(rows(page)).toHaveText(['10:00\u2002Q&A, panel']);
	await open(page, '#mins=20&next=Break@5,QA@10'); // one session, named "Break@5,QA"
	await expect(rows(page)).toHaveText(['10:00\u2002Break@5,QA']);
});

test('share writes the queue with pipes, and a "|" in a name survives the trip', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await open(page, '#mins=20' + q('Break@5|Panel>10:30'), '2026-11-14T10:12:00');
	await page.keyboard.press('n');
	await page.locator('.qr-label').first().fill('A|B');
	await page.locator('#next-set').click();
	await menu(page);
	await page.locator('#btn-share').click();
	const url = await page.evaluate(() => navigator.clipboard.readText());
	expect(new URLSearchParams(new URL(url).hash.slice(1)).get('next')).toBe('A\\|B@5|Panel>10:30');
	const other = await context.newPage();
	await visit(other, url);
	await expect(rows(other)).toHaveText(['05:00 A|B', /^10:30\s\d\d:\d\d\sPanel$/]);
});

test('the queue window takes >HH:MM in the minutes box', async ({ page }) => {
	await open(page, '#mins=20' + q('Break@5'), '2026-11-14T10:12:00');
	await page.keyboard.press('n');
	await page.locator('.qr-label').first().fill('Lunch');
	await page.locator('.qr-mins').first().fill('>12:30');
	await page.locator('#next-set').click();
	await expect(rows(page)).toHaveText([/^12:30\s2:1[78]:\d\d\sLunch$/]);
	await page.keyboard.press('n');
	await expect(page.locator('.qr-mins').first()).toHaveValue('>12:30');
});

test("the remote's queue box writes and reads the same notation", async ({ page, context }) => {
	await open(page, '#mins=20' + q('Break@5|Panel>10:30'), '2026-11-14T10:12:00');
	await menu(page);
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	const pad = await context.newPage();
	await visit(pad, '/#remote=' + code);
	await pad.clock.runFor(200);
	const box = pad.locator('#rc-queue-input');
	await expect(box).toHaveValue('Break@5|Panel>10:30');
	await expect(pad.locator('#rc-queue-display .rc-q-row')).toHaveText(['05:00 Break', /^10:30\s\d\d:\d\d\sPanel$/]);
	await box.fill('Wrap>11:00|QA@10');
	await box.press('Enter');
	await expect(rows(page)).toHaveText([/^11:00\s\d\d:\d\d\sWrap$/, '10:00 QA']);
});

test('in the list, a length has the queue triangle; a time of day has its time, a triangle with a bar, and the time left', async ({ page, context }) => {
	await open(page, '#mins=20' + q('Break@5|Panel>10:30'), '2026-11-14T10:12:00');
	const [length, timed] = [rows(page).nth(0), rows(page).nth(1)];
	await expect(length.locator('.ico')).toHaveClass(/ico-play/);
	await expect(timed.locator('.ico')).toHaveClass(/ico-target/);
	await expect(timed).toHaveText(/^10:30\s1[78]:\d\d\sPanel$/);
	// Left to right: the target time, the icon, the time left.
	const order = await timed.evaluate((row) => [...row.childNodes].map((n) => (n.nodeType === 3 ? 'text' : (n as Element).className)));
	expect(order).toEqual(['text', 'ico ico-target', 'q-left', 'text']);
	// The same triangle as the menu's queue button, level with the figures beside it.
	await menu(page);
	const shape = (sel: string) => page.locator(sel).first().evaluate((i) => getComputedStyle(i).clipPath);
	expect(await shape('.sq-queued .ico-play')).toBe(await shape('#btn-next .ico-play'));
	const m = await length.evaluate((row) => {
		const ico = row.querySelector('.ico')!.getBoundingClientRect();
		const probe = document.createElement('span');
		probe.style.cssText = 'display:inline-block;width:0;height:1cap;vertical-align:baseline';
		row.append(probe);
		const cap = probe.getBoundingClientRect();
		probe.remove();
		return Math.abs((ico.top + ico.bottom) / 2 - (cap.top + cap.bottom) / 2);
	});
	expect(m).toBeLessThan(0.5);

	// The time left moves with the clock, without the row being rebuilt.
	await timed.evaluate((row) => ((row as unknown as { mark: number }).mark = 1));
	await page.clock.runFor(60_000);
	await expect(timed).toHaveText(/^10:30\s1[67]:\d\d\sPanel$/);
	expect(await timed.evaluate((row) => (row as unknown as { mark?: number }).mark)).toBe(1);
	await expect(page.locator('#btn-next')).toHaveText('queue: 05:00 >10:30');

	// The pad lists it the same way.
	await menu(page);
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	const pad = await context.newPage();
	await visit(pad, '/#remote=' + code);
	await pad.clock.runFor(200);
	await expect(pad.locator('.rc-q-row').nth(1)).toHaveText(/^10:30\s1[67]:\d\d\sPanel$/);
	await expect(pad.locator('.rc-q-row').nth(1).locator('.ico')).toHaveClass(/ico-target/);
});

test('"@" before the minutes, ">" before a time of day; colons and "@" are free in names', async ({ page }) => {
	await open(page, '#mins=20' + q('Q&A: part 2@15|me@example@5|>10:30|@7|12'), '2026-11-14T10:12:00');
	await expect(rows(page)).toHaveText(['15:00 Q&A: part 2', '05:00 me@example', /^10:30\s1[78]:\d\d$/, '07:00', '12:00']);
});

test.describe('on a narrow screen', () => {
	test.use({ viewport: { width: 320, height: 568 } });
	test('a long session name is cut with an ellipsis, on one line, on the kiosk and the pad', async ({ page, context }) => {
		const name = 'An extraordinarily long session';
		await open(page, '#mins=20&label=' + encodeURIComponent(name) + q('Another extraordinarily long name@5'));
		const cut = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => {
			const s = getComputedStyle(el);
			return { cut: el.scrollWidth > el.clientWidth, lines: Math.round(el.getBoundingClientRect().height / parseFloat(s.lineHeight) || 1), right: el.getBoundingClientRect().right, overflow: s.textOverflow, wrap: s.whiteSpace };
		});
		for (const loc of [page.locator('#session-label'), rows(page).first()]) {
			const m = await cut(loc);
			expect(m.overflow).toBe('ellipsis');
			expect(m.wrap).toBe('nowrap');
			expect(m.cut).toBe(true); // too long for 320 px, and cut
			expect(m.right).toBeLessThanOrEqual(320);
		}
		await menu(page);
		await page.locator('#btn-remote').click();
		const code = (await page.locator('#remote-code-display').textContent())!.trim();
		const pad = await context.newPage();
		await pad.setViewportSize({ width: 320, height: 568 });
		await visit(pad, '/#remote=' + code);
		await pad.clock.runFor(200);
		const frame = (await pad.locator('#rc-preview').boundingBox())!;
		for (const loc of [pad.locator('#remote-label-display'), pad.locator('.rc-q-row').first()]) {
			await expect(loc).toContainText('extraordinarily');
			const m = await cut(loc);
			expect(m.overflow).toBe('ellipsis');
			expect(m.cut).toBe(true);
			expect(m.right).toBeLessThanOrEqual(frame.x + frame.width); // inside the frame
		}
	});
});
