import { test, expect, open, menu, visit, settled } from './fixtures';

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
		for (const query of ['#mins=25&label=Keynote&next=Break@5|QA@10', '#mins=999']) {
			await open(page, query);
			await settled(page);
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
		await open(page, '#next=Talk@10');
		await page.keyboard.press('u');
		await page.locator('#until-hour').press('Enter'); // "target: 10:30" makes the row long
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
		await expect(page.locator('#manual .manual-app')).toContainText('Acari v');
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
		await open(page, '#mins=25&label=Keynote&next=Break@5|QA@10');
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

test('in overtime, OVERTIME stays on screen and steady while a message shows', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('tick_prefs', JSON.stringify({ nextQueue: [] })));
	await open(page, '#mins=1');
	await page.keyboard.press('Space');
	await page.clock.fastForward(64_000);
	await page.clock.runFor(100);
	await expect(page.locator('#label-text')).toHaveText('OVERTIME');
	await sendOpMsg(page, 'Please wrap up');
	await page.keyboard.press('Escape');
	for (let i = 0; i < 3; i++) {
		await page.clock.runFor(1_000); // through both beats of the blink
		await expect(page.locator('#label-wrap')).toHaveCSS('opacity', '1');
		await expect(page.locator('#label-wrap')).toBeInViewport();
	}
	await expect(page.locator('#op-msg')).toBeVisible();
});

// The QR codes are drawn by the app, with nothing asked of the network.
for (const [width, height, want] of [[1280, 720, 320], [390, 844, 0], [844, 390, 320]] as const) {
	test(`the remote window's QR code is 320 px where there's room, and fits, at ${width}×${height}`, async ({ page, offsite }) => {
		await page.setViewportSize({ width, height });
		await open(page);
		await menu(page);
		await page.locator('#btn-remote').click();
		const qr = page.locator('#remote-qr svg');
		await expect(qr).toBeVisible();
		const [q, box] = [(await qr.boundingBox())!, (await page.locator('#remote-modal .modal-box').boundingBox())!];
		if (want) expect(Math.round(q.width)).toBe(want); // the full 320 where there's room
		else expect(q.width).toBeGreaterThan(250); // as big as the phone allows
		expect(Math.abs(q.width - q.height)).toBeLessThan(1); // square
		expect(q.x).toBeGreaterThanOrEqual(box.x);
		expect(q.x + q.width).toBeLessThanOrEqual(box.x + box.width);
		expect(box.y + box.height).toBeLessThanOrEqual(height); // the window stays on screen (it scrolls inside)
		expect(offsite.filter((u) => /qr/i.test(u))).toEqual([]); // no QR service
	});
}

test("the pad's add-a-kiosk QR code fits a phone", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await visit(page, '/#remote=ABCDEF');
	await page.locator('#rc-new-kiosk').click();
	const qr = page.locator('#rc-kiosk-qr svg');
	await expect(qr).toBeVisible();
	const [q, box] = [(await qr.boundingBox())!, (await page.locator('#rc-kiosk-modal .modal-box').boundingBox())!];
	expect(q.width).toBeGreaterThan(250);
	expect(q.x + q.width).toBeLessThanOrEqual(box.x + box.width);
});

for (const width of [1280, 390, 320]) {
	test(`the remote window's buttons each fit on one line at ${width} px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });
		await open(page);
		await menu(page);
		await page.locator('#btn-remote').click();
		const bad = await page.locator('#remote-modal .modal-actions .modal-btn').evaluateAll((bs) =>
			bs.filter((b) => (b as HTMLElement).offsetParent).filter((b) => {
				const r = document.createRange();
				r.selectNodeContents(b);
				const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.bottom))).size;
				return lines > 1 || b.scrollWidth > b.clientWidth + 1;
			}).map((b) => b.textContent)
		);
		expect(bad).toEqual([]);
		await expect(page.locator('#remote-modal .modal-actions .modal-btn:visible')).toHaveText(['Open', 'Join', 'Stop', 'Close']);
		await expect(page.locator('#remote-copy-url')).toHaveCount(0); // copying the link is gone
		await page.locator('#remote-to-join').click(); // the other view's buttons too
		await expect(page.locator('#remote-modal .modal-actions .modal-btn:visible')).toHaveText(['Remote', 'Kiosk', 'Back', 'Close']);
	});
}

test("the queue button's triangle is drawn in CSS, a capital tall, close to its label", async ({ page }) => {
	await open(page, '#next=Talk@10');
	await menu(page);
	const btn = page.locator('#btn-next');
	await expect(btn).toHaveText('queue: 10:00'); // no triangle character in the text
	const m = await btn.evaluate((b) => {
		const ico = b.querySelector('.ico')!.getBoundingClientRect();
		const lbl = b.querySelector('.lbl')!.getBoundingClientRect();
		const probe = document.createElement('span');
		probe.style.cssText = 'display:inline-block;width:0;height:1cap;vertical-align:baseline';
		b.append(probe);
		const cap = probe.getBoundingClientRect();
		probe.remove();
		return { h: ico.height, bottom: ico.bottom, capH: cap.height, capBottom: cap.bottom, gap: lbl.left - ico.right, fs: parseFloat(getComputedStyle(b).fontSize) };
	});
	expect(Math.abs(m.h - m.capH)).toBeLessThan(0.5); // as tall as the capitals beside it
	expect(Math.abs(m.bottom - m.capBottom)).toBeLessThan(0.5); // on their baseline
	expect(m.gap).toBeLessThan(m.fs * 0.5); // closer than the space a character took
	expect(m.gap).toBeGreaterThan(1);
});

test('in the manual, keys are keycaps: page colour on ink', async ({ page }) => {
	for (const theme of ['dark', 'light']) {
		await open(page, '#theme=' + theme);
		await page.keyboard.press('Home');
		const kbd = page.locator('#manual kbd').first();
		await expect(kbd).toHaveText('Enter');
		const [bg, fg, ink, paper] = await kbd.evaluate((k) => {
			const s = getComputedStyle(k), b = getComputedStyle(document.body);
			return [s.backgroundColor, s.color, b.color, b.backgroundColor];
		});
		expect(bg, theme).toBe(ink);
		expect(fg, theme).toBe(paper);
	}
	// Keys only: things to type stay in the grey of code.
	expect(await page.locator('#manual kbd').count()).toBeGreaterThan(25);
	await expect(page.locator('#manual code', { hasText: 'Talk@25|Break@5|Panel>14:30' })).toHaveCount(1);
	await expect(page.locator('#manual td code', { hasText: 'Title@25|10' })).toHaveCount(1); // the queue example, with a pipe
	await expect(page.locator('#manual')).not.toContainText('Title@25,10');
});

test('a window button that throws something away has a red border, like its label', async ({ page }) => {
	await open(page);
	const red = await page.evaluate(() => {
		const d = document.createElement('div'); d.style.color = 'var(--c-ot)'; document.body.append(d);
		const v = getComputedStyle(d).color; d.remove(); return v;
	});
	const danger = page.locator('.modal-btn.danger');
	expect(await danger.count()).toBe(3); // Clear, Delete, Stop
	for (const b of await danger.all()) {
		const [color, border] = await b.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).borderTopColor]);
		expect(color).toBe(red);
		expect(border).toBe(red);
	}
});

// Icons are drawn in CSS at the height of a capital, on the label's baseline.
const capFit = (btn: import('@playwright/test').Locator) => btn.evaluate((b) => {
	const ico = b.querySelector('.ico')!, r = ico.getBoundingClientRect();
	const probe = document.createElement('span');
	probe.style.cssText = 'display:inline-block;width:0;height:1cap;vertical-align:baseline';
	b.append(probe);
	const cap = probe.getBoundingClientRect();
	probe.remove();
	const s = getComputedStyle(ico);
	return { dh: Math.abs(r.height - cap.height), db: Math.abs(r.bottom - cap.bottom), w: r.width, h: r.height, radius: s.borderTopLeftRadius, mask: s.maskImage, clip: s.clipPath };
});

test('the menu: reset has two triangles pointing back, then clock, then target with a triangle and bar', async ({ page }) => {
	await open(page);
	await menu(page);
	await expect(page.locator('#btn-reset').locator('xpath=..').locator('.tb-btn:visible')).toHaveText(['reset', 'clock', 'target', /^queue/]);
	const reset = await capFit(page.locator('#btn-reset'));
	await expect(page.locator('#btn-reset .ico')).toHaveClass(/ico-rewind/);
	expect(reset.clip.replace(/\b0px/g, '0%')).toContain('polygon(50% 0%, 0% 50%, 50% 100%, 50% 50%, 100% 100%, 100% 0%, 50% 50%)'); // two triangles, pointing left
	expect(reset.w / reset.h).toBeCloseTo(1.5, 1);
	const target = await capFit(page.locator('#btn-until-open'));
	expect(target.clip).toContain('polygon'); // triangle and bar, one shape
	const clock = await capFit(page.locator('#btn-clock-watch'));
	expect(clock.mask).toContain('data:image/svg+xml');
	for (const m of [reset, target, clock]) { expect(m.dh).toBeLessThan(0.5); expect(m.db).toBeLessThan(0.5); }

	// In clock mode the button offers the timer, with a stopwatch.
	await expect(page.locator('#btn-clock-watch .ico')).toHaveClass(/ico-clock/);
	await page.locator('#btn-clock-watch').click();
	await expect(page.locator('#btn-clock-watch')).toHaveText('timer');
	await expect(page.locator('#btn-clock-watch .ico')).toHaveClass(/ico-timer/);
	const timer = await capFit(page.locator('#btn-clock-watch'));
	expect(timer.dh).toBeLessThan(0.5);
	expect(timer.mask).not.toBe(clock.mask);
});

test('sound is one switch: a bell, struck through when off', async ({ page }) => {
	await open(page);
	await menu(page);
	const btn = page.locator('#btn-sound');
	await expect(btn).toHaveText('sound');
	await expect(btn).toHaveAttribute('aria-pressed', 'false');
	await expect(btn.locator('.ico')).toHaveClass(/ico-bell-off/);
	const off = await capFit(btn);
	await btn.click();
	await expect(btn).toHaveAttribute('aria-pressed', 'true');
	await expect(btn.locator('.ico')).toHaveClass(/ico-bell(?!-)/);
	await expect(btn).toHaveClass(/sound-on/);
	const on = await capFit(btn);
	expect(on.mask).not.toBe(off.mask); // a different drawing...
	expect(Math.abs(on.w - off.w)).toBeLessThan(0.01); // ...in the same box, so nothing shifts
	expect(on.dh).toBeLessThan(0.5);
	await btn.click(); // and off again: there is no third setting
	await expect(btn).toHaveAttribute('aria-pressed', 'false');
	await page.keyboard.press('Insert');
	await expect(btn).toHaveAttribute('aria-pressed', 'true');
});

test('on the pad, Reset has the two triangles and Black has the square', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await visit(page, '/#remote=ABCDEF');
	await expect(page.locator('#rc-reset .ico')).toHaveClass(/ico-rewind/);
	await expect(page.locator('#rc-black .ico')).toHaveClass(/ico-stop/);
	const [reset, black] = [await capFit(page.locator('#rc-reset')), await capFit(page.locator('#rc-black'))];
	expect(reset.clip).toContain('polygon');
	expect(Math.abs(black.w - black.h)).toBeLessThan(0.01); // a square
	for (const m of [reset, black]) { expect(m.dh).toBeLessThan(0.5); expect(m.db).toBeLessThan(0.5); }
});

test('a QR code has a white margin of six modules on every side', async ({ page }) => {
	await open(page);
	await menu(page);
	await page.locator('#btn-remote').click();
	const m = await page.locator('#remote-qr svg').evaluate((svg) => {
		const size = +svg.getAttribute('viewBox')!.split(' ')[2];
		const box = (svg.querySelector('path') as SVGPathElement).getBBox();
		return { size, left: box.x, top: box.y, right: size - box.x - box.width, bottom: size - box.y - box.height, bg: svg.querySelector('rect')!.getAttribute('fill') };
	});
	expect([m.left, m.top, m.right, m.bottom]).toEqual([6, 6, 6, 6]);
	expect(m.size).toBe(29 + 12); // the 29-module code for a remote link
	expect(m.bg).toBe('#fff');
});
