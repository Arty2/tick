import { test, expect, open, digits, menu, visit, settle } from './fixtures';

// Queue notation: sessions separated by "|", each "name>length": minutes
// ("Break>5", "Break>5:00") or a time of day in brackets ("Wrap>[23:30]");
// "15" and "[23:30]" alone have no name.
const q = (s: string) => '&next=' + encodeURIComponent(s);
const rows = (page: import('@playwright/test').Page) => page.locator('.sq-queued');

test('a pipe-separated queue reads, with commas and colons free in names', async ({ page }) => {
	await open(page, '#mins=20' + q('Break>5|Q&A, panel>10|Panel>[10:30]|15'), '2026-11-14T10:12:00');
	await expect(rows(page)).toHaveText(['Break 05:00', 'Q&A, panel 10:00', /^Panel\s\d\d:\d\d\s\[10:30\]$/]); // the list shows three
	await expect(page.locator('#btn-next')).toHaveText('queue: 05:00 10:00 [10:30] 15:00'); // the queue holds all four
});

test('a >HH:MM session counts down to that time of day when it loads', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('tick_prefs', '{}'));
	await open(page, '#mins=1&label=Talk' + q('Panel>[10:30]'), '2026-11-14T10:12:00');
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
	await open(page, '#mins=20' + q('Q&A, panel>10'));
	await expect(rows(page)).toHaveText(['Q&A, panel 10:00']);
	await open(page, '#mins=20&next=Break>5,QA>10'); // one session, named "Break>5,QA"
	await expect(rows(page)).toHaveText(['Break>5,QA 10:00']);
});

test('share writes the queue with pipes, and a "|" in a name survives the trip', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await open(page, '#mins=20' + q('Break>5|Panel>[10:30]'), '2026-11-14T10:12:00');
	await page.keyboard.press('n');
	await page.locator('.qr-label').first().fill('A|B');
	await page.locator('#next-set').click();
	await menu(page);
	await page.locator('#btn-share').click();
	const url = await page.evaluate(() => navigator.clipboard.readText());
	expect(new URLSearchParams(new URL(url).hash.slice(1)).get('next')).toBe('A\\|B>5|Panel>[10:30]');
	const other = await context.newPage();
	await visit(other, url);
	await expect(rows(other)).toHaveText(['A|B 05:00', /^Panel\s\d\d:\d\d\s\[10:30\]$/]);
});

test('the queue window takes >HH:MM in the minutes box', async ({ page }) => {
	await open(page, '#mins=20' + q('Break>5'), '2026-11-14T10:12:00');
	await page.keyboard.press('n');
	await page.locator('.qr-label').first().fill('Lunch');
	await page.locator('.qr-mins').first().fill('[12:30]');
	await page.locator('#next-set').click();
	await expect(rows(page)).toHaveText([/^Lunch\s2:1[78]:\d\d\s\[12:30\]$/]);
	await page.keyboard.press('n');
	await expect(page.locator('.qr-mins').first()).toHaveValue('[12:30]');
});

test("the remote's queue box writes and reads the same notation", async ({ page, context }) => {
	await open(page, '#mins=20' + q('Break>5|Panel>[10:30]'), '2026-11-14T10:12:00');
	await menu(page);
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	const pad = await context.newPage();
	await visit(pad, '/#remote=' + code);
	await pad.clock.runFor(200);
	const box = pad.locator('#rc-queue-input');
	await expect(box).toHaveValue('Break>5|Panel>[10:30]');
	await expect(pad.locator('#rc-queue-display .rc-q-row')).toHaveText(['Break 05:00', /^Panel\s\d\d:\d\d\s\[10:30\]$/]);
	await box.fill('Wrap>[11:00]|QA>10');
	await box.press('Enter');
	await expect(rows(page)).toHaveText([/^Wrap\s\d\d:\d\d\s\[11:00\]$/, 'QA 10:00']);
});

test('in the list: the name, the icon, the time; a time of day has a triangle with a bar, the time left, then the target in brackets', async ({ page, context }) => {
	await open(page, '#mins=20' + q('Break>5|Q&A>15|Wrap>[10:30]|7'), '2026-11-14T10:12:00');
	const [length, timed] = [rows(page).nth(0), rows(page).nth(2)];
	await expect(rows(page)).toHaveText(['Break 05:00', 'Q&A 15:00', /^Wrap\s1[78]:\d\d\s\[10:30\]$/]);
	// Three sessions are listed; an ellipsis under the icons stands for the rest.
	const more = page.locator('.sq-more');
	await expect(more).toHaveText('\u2026');
	const mb = (await more.boundingBox())!;
	expect(Math.abs(mb.x + mb.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2);
	expect(mb.y).toBeGreaterThan((await rows(page).nth(2).boundingBox())!.y);
	await expect(length.locator('.ico')).toHaveClass(/ico-play/);
	await expect(timed.locator('.ico')).toHaveClass(/ico-target/);
	// Left to right in a row: the name, then the icon, the time, and the target.
	const order = await timed.evaluate((row) => [...row.querySelectorAll('.q-name, .ico, .q-left')].map((n) => [n.className, Math.round(n.getBoundingClientRect().left)] as const));
	expect(order.map((o) => o[0])).toEqual(['q-name', 'ico ico-target', 'q-left']);
	expect(order.map((o) => o[1])).toEqual([...order.map((o) => o[1])].sort((a, b) => a - b));
	// Every icon stands in one column in the middle of the page, under a
	// centred NEXT; names end against the icons, whatever their lengths.
	const boxes = (sel: string) => page.locator(sel).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, mid: (r.left + r.right) / 2 }; }));
	const width = page.viewportSize()!.width;
	const icons = await boxes('.sq-queued .ico');
	expect(icons).toHaveLength(3);
	for (const i of icons) expect(Math.abs(i.mid - width / 2)).toBeLessThan(1);
	const names = (await boxes('.sq-queued .q-name')).slice(0, 3);
	expect(Math.max(...names.map((n) => n.right)) - Math.min(...names.map((n) => n.right))).toBeLessThan(0.5); // right-aligned
	expect(new Set(names.map((n) => Math.round(n.left))).size).toBe(3); // so their starts differ
	expect(names[0].right).toBeLessThan(icons[0].left);
	const times = await boxes('.sq-queued .q-rest');
	expect(Math.max(...times.map((t) => t.left)) - Math.min(...times.map((t) => t.left))).toBeLessThan(4); // times start after the icons
	const head = await page.locator('.sq-next-header').evaluate((h) => { const r = document.createRange(); r.selectNodeContents(h); const b = r.getBoundingClientRect(); return (b.left + b.right) / 2; });
	// (The heading's letter-spacing trails its last letter, so its ink sits a hair left of centre.)
	expect(Math.abs(head - width / 2)).toBeLessThan(2);
	// The space either side of the list still starts and pauses the timer.
	await settle(page); // the menu closes itself; a click while it is open only closes it
	await page.mouse.click(120, (await rows(page).first().boundingBox())!.y + 4);
	await expect(digits(page)).toHaveClass(/s-run/);
	await expect(page.locator('#next-modal')).not.toHaveClass(/open/);
	await rows(page).first().locator('.q-name').click(); // the words open the queue
	await expect(page.locator('#next-modal')).toHaveClass(/open/);
	await page.locator('#next-cancel').click();
	// The same triangle as the menu's queue button, level with the figures beside it.
	await menu(page);
	const shape = (sel: string) => page.locator(sel).first().evaluate((i) => getComputedStyle(i).clipPath);
	expect(await shape('.sq-queued .ico-play')).toBe(await shape('#btn-next .ico-play'));
	const m = await length.evaluate((row) => {
		const ico = row.querySelector('.ico')!.getBoundingClientRect();
		const probe = document.createElement('span');
		probe.style.cssText = 'display:inline-block;width:0;height:1cap;vertical-align:baseline';
		row.querySelector('.q-rest')!.append(probe);
		const cap = probe.getBoundingClientRect();
		probe.remove();
		return Math.abs((ico.top + ico.bottom) / 2 - (cap.top + cap.bottom) / 2);
	});
	expect(m).toBeLessThan(0.5);

	// The time left moves with the clock, without the row being rebuilt.
	await timed.evaluate((row) => ((row as unknown as { mark: number }).mark = 1));
	await page.clock.runFor(60_000);
	await expect(timed).toHaveText(/^Wrap\s1[67]:\d\d\s\[10:30\]$/);
	expect(await timed.evaluate((row) => (row as unknown as { mark?: number }).mark)).toBe(1);
	await expect(page.locator('#btn-next')).toHaveText('queue: 05:00 15:00 [10:30] 07:00');

	// The pad lists it the same way.
	await menu(page);
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	const pad = await context.newPage();
	await visit(pad, '/#remote=' + code);
	await pad.clock.runFor(200);
	await expect(pad.locator('.rc-q-row').nth(2)).toHaveText(/^Wrap\s1[67]:\d\d\s\[10:30\]$/);
	await expect(pad.locator('.rc-q-row')).toHaveCount(3);
	await expect(pad.locator('.rc-q-more')).toHaveText('\u2026');
	await expect(pad.locator('.rc-q-row').nth(2).locator('.ico')).toHaveClass(/ico-target/);
	const padIcons = await pad.locator('.rc-q-row .ico').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return (r.left + r.right) / 2; }));
	const frame = (await pad.locator('#rc-preview').boundingBox())!;
	for (const mid of padIcons) expect(Math.abs(mid - (frame.x + frame.width / 2))).toBeLessThan(1); // the middle of the preview
});

test('the length follows the last ">": minutes, minutes:seconds, or a time of day in brackets; names keep colons, "@" and ">"', async ({ page }) => {
	await open(page, '#mins=20' + q('Q&A: part 2>15|me@example>5:00|a>b>90|Long>7:40|[10:30]|7|12'), '2026-11-14T10:12:00');
	await expect(rows(page)).toHaveText(['Q&A: part 2 15:00', 'me@example 05:00', 'a>b 90:00']);
	await expect(page.locator('#btn-next')).toHaveText('queue: 15:00 05:00 90:00 08:00 [10:30] 07:00 12:00');
});

test.describe('on a narrow screen', () => {
	test.use({ viewport: { width: 320, height: 568 } });
	test('a long session name is cut with an ellipsis, on one line, on the kiosk and the pad', async ({ page, context }) => {
		const name = 'An extraordinarily long session';
		await open(page, '#mins=20&label=' + encodeURIComponent(name) + q('Another extraordinarily long name>5'));
		const cut = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => {
			const s = getComputedStyle(el);
			return { cut: el.scrollWidth > el.clientWidth, lines: Math.round(el.getBoundingClientRect().height / parseFloat(s.lineHeight) || 1), right: el.getBoundingClientRect().right, overflow: s.textOverflow, wrap: s.whiteSpace };
		});
		for (const loc of [page.locator('#session-label'), rows(page).first().locator('.q-name')]) {
			const m = await cut(loc);
			expect(m.overflow).toBe('ellipsis');
			expect(m.wrap).toBe('nowrap');
			expect(m.cut).toBe(true); // too long for 320 px, and cut
			expect(m.right).toBeLessThanOrEqual(320);
		}
		// The icon and the time are never the part that is cut.
		const rest = (await rows(page).first().locator('.q-rest').boundingBox())!;
		await expect(rows(page).first().locator('.q-rest')).toHaveText('05:00');
		expect(rest.x + rest.width).toBeLessThanOrEqual(320);
		await menu(page);
		await page.locator('#btn-remote').click();
		const code = (await page.locator('#remote-code-display').textContent())!.trim();
		const pad = await context.newPage();
		await pad.setViewportSize({ width: 320, height: 568 });
		await visit(pad, '/#remote=' + code);
		await pad.clock.runFor(200);
		const frame = (await pad.locator('#rc-preview').boundingBox())!;
		for (const loc of [pad.locator('#remote-label-display'), pad.locator('.rc-q-row').first().locator('.q-name')]) {
			await expect(loc).toContainText('extraordinarily');
			const m = await cut(loc);
			expect(m.overflow).toBe('ellipsis');
			expect(m.right).toBeLessThanOrEqual(frame.x + frame.width); // inside the frame
		}
	});
});
