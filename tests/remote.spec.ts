import { test, expect, open, digits, menu } from './fixtures';

async function hostWithRemote(page: import('@playwright/test').Page, query = '?mins=20') {
	await open(page, query);
	await menu(page);
	await page.locator('#btn-remote').click();
	return (await page.locator('#remote-code-display').textContent())!.trim();
}

// Same-browser remote control runs over BroadcastChannel and needs no
// network. The cross-device path (PeerJS) is aborted by the fixture, which
// is also the honest test of "works offline in the same browser".
test('a remote pad in another tab starts, pauses and adjusts the host', async ({ page, context }) => {
	await open(page, '?mins=20');
	await menu(page);
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	expect(code).toMatch(/^[A-Z2-9]{6}$/);

	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200); // the pad says hello after 100 ms
	await expect(pad.locator('#remote-status-bar')).toContainText(/connected/i);
	await expect(page.locator('#remote-status')).toContainText(/connected/i);

	await pad.locator('#rc-toggle').click();
	await expect(digits(page)).toHaveClass(/s-run/);
	await pad.locator('[data-rc="adj:10"]').click();
	await page.clock.runFor(100);
	await expect(digits(page)).toHaveText('30:00');
	await expect(pad.locator('#rc-toggle')).toHaveText('Pause'); // the start button became pause
	await pad.locator('#rc-toggle').click();
	await expect(page.locator('#label-text')).toHaveText('PAUSED');
	await page.clock.runFor(600); // the kiosk's next update
	await expect(pad.locator('#rc-toggle')).toHaveText('Start');
});

test('a command delivered twice (WebRTC and BroadcastChannel) runs once', async ({ page, context }) => {
	await open(page, '?mins=20');
	await menu(page);
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	await page.keyboard.press('Space'); // the modal is open; start from the pad instead
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200); // the pad says hello after 100 ms
	await pad.locator('#rc-toggle').click();
	await expect(digits(page)).toHaveClass(/s-run/);
	await pad.evaluate((code) => {
		const ch = new BroadcastChannel('tick-rc-' + code);
		const msg = { type: 'cmd', cmd: 'adj:10', id: 'same-id' };
		ch.postMessage(msg);
		ch.postMessage(msg);
	}, code);
	await page.clock.runFor(100);
	await expect(digits(page)).toHaveText('30:00');
});

test("the pad's queue field takes typing instead of treating it as shortcuts", async ({ page }) => {
	await page.goto('/tick.html?rc=ABCDEF');
	await page.locator('#rc-queue-input').click();
	await page.keyboard.type('Talk:25, QA:10');
	await page.keyboard.press('Backspace');
	await expect(page.locator('#rc-queue-input')).toHaveValue('Talk:25, QA:1');
});

const PEER_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';

test('PeerJS loads when its bytes match the pinned hash', async ({ page }) => {
	// Served from the npm package so the hash in tick.html is checked against
	// the real published file on every run, without the network.
	await page.route(PEER_URL, (r) => r.fulfill({ path: 'node_modules/peerjs/dist/peerjs.min.js', headers: { 'access-control-allow-origin': '*' } }));
	await open(page);
	await menu(page);
	await page.locator('#btn-remote').click();
	await expect.poll(() => page.evaluate(() => typeof (window as unknown as { Peer?: unknown }).Peer)).toBe('function');
});

test('a tampered PeerJS is refused by the browser', async ({ page, errors }) => {
	await page.route(PEER_URL, (r) =>
		r.fulfill({ body: 'window.Peer = function () {}', contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } })
	);
	await open(page);
	await menu(page);
	await page.locator('#btn-remote').click();
	await expect.poll(() => errors.some((e) => /integrity/i.test(e))).toBe(true);
	expect(await page.evaluate(() => typeof (window as unknown as { Peer?: unknown }).Peer)).toBe('undefined');
	errors.length = 0;
});

test.describe('on a touch screen', () => {
	test.use({ hasTouch: true });
	test('tapping the pad sends the command', async ({ page, context }) => {
		const code = await hostWithRemote(page);
		const pad = await context.newPage();
		await pad.goto('/tick.html?rc=' + code);
		await pad.clock.runFor(200); // the pad says hello after 100 ms
	await pad.clock.runFor(200); // the pad says hello after 100 ms
		await expect(pad.locator('#remote-status-bar')).toContainText(/connected/i);
		await pad.locator('#rc-toggle').tap();
		await expect(digits(page)).toHaveClass(/s-run/);
	});
});

test('a pad whose code nobody answers says so', async ({ page }) => {
	await open(page, '?rc=ZZZZZ2');
	await page.clock.runFor(8_500);
	await expect(page.locator('#remote-status-bar')).toContainText(/no connection/i);
});

test('reopening the remote while a pad is connected still says connected', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200); // the pad says hello after 100 ms
	await expect(page.locator('#remote-status')).toContainText(/connected/i);
	// Connecting closed the window and turned on kiosk mode; leave it to reopen.
	await expect(page.locator('#remote-modal')).not.toHaveClass(/open/);
	await page.keyboard.press('Escape');
	await menu(page);
	await page.locator('#btn-remote').click();
	await expect(page.locator('#remote-status')).toContainText(/connected/i);
});

test("the broker's WebSocket is blocked like any other off-site request", async ({ page, offsite }) => {
	await page.route(PEER_URL, (r) => r.fulfill({ path: 'node_modules/peerjs/dist/peerjs.min.js', headers: { 'access-control-allow-origin': '*' } }));
	await hostWithRemote(page);
	await expect.poll(() => offsite.some((u) => u.startsWith('wss://'))).toBe(true);
});

test('a malformed adjustment from a pad is ignored', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200); // the pad says hello after 100 ms
	await pad.locator('#rc-toggle').click();
	await expect(digits(page)).toHaveClass(/s-run/);
	await pad.evaluate((code) => new BroadcastChannel('tick-rc-' + code).postMessage({ type: 'cmd', cmd: 'adj:x', id: 'bad' }), code);
	await page.clock.runFor(100);
	await expect(digits(page)).toHaveText('20:00');
});

test('the first remote to connect turns the timer into a kiosk, which stays after it leaves', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	await expect(page.locator('body')).not.toHaveClass(/kiosk/);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await expect(page.locator('body')).toHaveClass(/kiosk/);
	await expect(page.locator('#remote-modal')).not.toHaveClass(/open/);
	await pad.close();
	await page.clock.runFor(10_000);
	await expect(page.locator('body')).toHaveClass(/kiosk/);
});

test('the pad says Connected, shows no state name, and has a red reset', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('#rc-toggle').click();
	await pad.clock.runFor(600);
	await expect(pad.locator('#remote-status-bar')).toHaveText('Connected');
	// Reset is red (the overtime colour), not the green it used to share with the reset flash.
	const [reset, red] = await pad.evaluate(() => [getComputedStyle(document.querySelector('[data-rc="reset"]')!).color, getComputedStyle(document.body).getPropertyValue('--c-ot')]);
	expect(reset).toBe(await pad.evaluate((c) => { const d = document.createElement('div'); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, red.trim()));
	await expect(pad.locator('#remote-label-display')).toHaveText('');
});

test('an operator message typed on the pad shows on the kiosk, not the pad', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('#rc-msg-input').fill('Two minutes');
	await pad.locator('#rc-msg-input').press('Enter');
	await expect(page.locator('#op-msg')).toBeVisible();
	await expect(page.locator('#op-msg')).toHaveText('Two minutes');
	await expect(pad.locator('#op-msg')).toBeHidden();
	await expect(page.locator('#op-msg-input')).toHaveCount(0); // no longer on the timer
	await pad.locator('#rc-msg-clear').click();
	await expect(page.locator('#op-msg')).toBeHidden();
});

test('a lost kiosk is reported, and a new kiosk from the pad carries on the timer', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&label=Keynote&next=QA:10');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('#rc-toggle').click();
	await pad.clock.runFor(3_000); // 19:57 left, and the pad has heard so
	await page.close();
	await pad.clock.runFor(7_000); // three heartbeats missed
	await expect(pad.locator('#remote-status-bar')).toHaveText('\u26A0\uFE0F Kiosk lost');

	await pad.locator('#rc-new-kiosk').click();
	await expect(pad.locator('#rc-kiosk-modal')).toHaveClass(/open/);
	const link = (await pad.locator('#rc-kiosk-url').textContent())!;
	expect(new URL(link).searchParams.get('host')).toBe(code);

	const kiosk = await context.newPage();
	await kiosk.goto(link);
	await kiosk.clock.runFor(500);
	await expect(pad.locator('#remote-status-bar')).toContainText(/connected/i);
	await expect(kiosk.locator('body')).toHaveClass(/kiosk/);
	await expect(kiosk.locator('#session-label')).toHaveText('Keynote');
	await expect(kiosk.locator('#timer-display')).toHaveClass(/s-run/);
	// 20:00 started, 3 s before the old kiosk went, 7 s more until the new one.
	await expect(kiosk.locator('#timer-display')).toHaveText(/^19:5\d$/);
	await expect(kiosk.locator('.sq-queued')).toHaveText(['\u25B6 10:00\u2002QA']);
});

for (const width of [320, 390]) {
	test.describe(`the pad on a ${width}px phone`, () => {
		test.use({ viewport: { width, height: 844 } });
		test('has buttons twice the old size, each label on one line and inside its button', async ({ page }) => {
			await page.goto('/tick.html?rc=ABCDEF');
			const size = await page.locator('.rc-btn').first().evaluate((b) => parseFloat(getComputedStyle(b).fontSize));
			expect(size).toBeGreaterThanOrEqual(22); // was 12px at this width
			await page.locator('#rc-new-kiosk').click(); // its window's buttons too
			const bad = await page.locator('#remote-pad .rc-btn, #remote-pad .modal-btn').evaluateAll((bs) =>
				bs.filter((b) => {
					// Lines of text only: a drawn icon is a box of its own, not a line.
					const tops: number[] = [];
					const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
					for (let n = walk.nextNode(); n; n = walk.nextNode()) {
						if (!n.textContent!.trim()) continue;
						const r = document.createRange();
						r.selectNodeContents(n);
						for (const x of r.getClientRects()) tops.push(Math.round(x.bottom));
					}
					const lines = new Set(tops).size;
					return lines > 1 || b.scrollWidth > b.clientWidth + 1;
				}).map((b) => b.textContent)
			);
			expect(bad).toEqual([]);
		});
	});
}

test('the pad lays out reset then start, and the message box on its own line over clear then send', async ({ page }) => {
	await page.goto('/tick.html?rc=ABCDEF');
	const grid = await page.locator('.rc-grid > .rc-btn').evaluateAll((bs) => bs.slice(0, 2).map((b) => [b.textContent, Math.round(b.getBoundingClientRect().top), Math.round(b.getBoundingClientRect().left)]));
	expect(grid[0][0]).toContain('Reset');
	expect(grid[1][0]).toContain('Start');
	expect(grid[0][1]).toBe(grid[1][1]); // same row
	expect(grid[0][2]).toBeLessThan(grid[1][2] as number); // reset on the left
	const box = (id: string) => page.locator(id).boundingBox();
	const [input, clear, send] = [await box('#rc-msg-input'), await box('#rc-msg-clear'), await box('#rc-msg-send')];
	expect(clear!.y).toBeGreaterThanOrEqual(input!.y + input!.height); // buttons below the box
	expect(clear!.y).toBe(send!.y);
	expect(clear!.x).toBeLessThan(send!.x); // clear, then send
});

test('the pad shows the queue with each session’s length and name', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&next=Break:5|QA:10|15');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await expect(pad.locator('#rc-queue-display .rc-q-head')).toHaveText('Next');
	await expect(pad.locator('#rc-queue-display .rc-q-row')).toHaveText(['\u25B6\uFE0E 05:00\u2002Break', '\u25B6\uFE0E 10:00\u2002QA', '\u25B6\uFE0E 15:00']);
	// Next and Prev use the same solid triangles as the list, pointing each way.
	await expect(pad.locator('#rc-next')).toHaveText('\u25B6\uFE0E Next');
	await expect(pad.locator('#rc-prev')).toHaveText('\u25C0\uFE0E Prev');
});

test('the pad reads top to bottom: status and kiosk icon, time, queue, controls, queue box and set, prev and next, black and bell', async ({ page }) => {
	await page.goto('/tick.html?rc=ABCDEF');
	const top = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
	const order = ['#remote-status-bar', '#remote-state-display', '#remote-label-display', '#rc-queue-display', '#rc-toggle', '[data-rc="adj:10"]', '#rc-queue-input', '#rc-queue-send', '[data-rc="bell"]', '#rc-msg-input', '#rc-msg-send'];
	const ys = [];
	for (const sel of order) ys.push((await top(sel)).y);
	expect(ys).toEqual([...ys].sort((a, b) => a - b));
	const [status, icon] = [await top('#remote-status-bar'), await top('#rc-new-kiosk')];
	expect(Math.abs(status.y + status.height / 2 - (icon.y + icon.height / 2))).toBeLessThan(4); // same line
	expect(icon.width).toBeLessThan(60); // a small icon, not a big button
	const code = await top('#rc-code-input');
	expect(Math.abs(code.height - icon.height)).toBeLessThan(0.5); // the code box and the kiosk button match
	expect(Math.abs(code.y - icon.y)).toBeLessThan(0.5);
	const [input, set, prev, next, bell, reset] = [await top('#rc-queue-input'), await top('#rc-queue-send'), await top('#rc-prev'), await top('#rc-next'), await top('[data-rc="bell"]'), await top('[data-rc="reset"]')];
	expect(Math.abs(set.y + set.height / 2 - (input.y + input.height / 2))).toBeLessThan(4); // set on the queue's line
	expect(set.x).toBeGreaterThan(input.x); // to its right
	const plus10 = await top('[data-rc="adj:10"]');
	expect(Math.abs(set.x - plus10.x)).toBeLessThan(1); // on the grid: the same column as +10m
	expect(Math.abs(set.width - plus10.width)).toBeLessThan(1);
	expect(Math.abs(input.x - (await top('[data-rc="adj:-1"]')).x)).toBeLessThan(1);
	expect(prev.y).toBe(next.y);
	expect(prev.x).toBeLessThan(next.x); // prev on the left, next on the right
	expect(prev.y).toBeGreaterThan(set.y);
	const black = await top('#rc-black');
	expect(black.y).toBe(bell.y); // Black and Bell share the row below Prev | Next
	expect(black.x).toBeLessThan(bell.x); // Black on the left
	expect(Math.abs(black.width - bell.width)).toBeLessThan(1);
	expect(bell.y).toBeGreaterThan(next.y);
	expect(reset.x).toBeLessThan((await top('#rc-toggle')).x);
});

test('the queue box holds the current queue, so an edit and Set changes it, and empty clears it', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&next=Break:5|QA:10|15');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	const box = pad.locator('#rc-queue-input');
	await expect(box).toHaveValue('Break:5|QA:10|15'); // written with pipes
	await box.fill('Break:5|Q&A, panel:20');
	await pad.clock.runFor(2_500); // a heartbeat arrives while editing: the edit survives
	await expect(box).toHaveValue('Break:5|Q&A, panel:20');
	await pad.locator('#rc-queue-send').click();
	await expect(page.locator('.sq-queued')).toHaveText(['\u25B6 05:00\u2002Break', '\u25B6 20:00\u2002Q&A, panel']);
	await box.fill('');
	await box.press('Enter');
	await expect(page.locator('.sq-queued')).toHaveCount(0);
});

test('Prev steps back to the session before, and Next steps forward again', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&label=Talk&next=Break:5|QA:10');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await expect(pad.locator('#rc-prev')).toBeDisabled(); // nothing has run before
	await pad.locator('#rc-next').click();
	await expect(page.locator('#session-label')).toHaveText('Break');
	await page.clock.runFor(600);
	await expect(pad.locator('#rc-prev')).toBeEnabled();
	await pad.locator('#rc-prev').click();
	await expect(page.locator('#session-label')).toHaveText('Talk');
	await expect(digits(page)).toHaveText('20:00');
	await expect(digits(page)).toHaveClass(/s-next/); // loaded, waiting to start
	await expect(page.locator('.sq-queued')).toHaveText(['\u25B6 05:00\u2002Break', '\u25B6 10:00\u2002QA']);
	await page.clock.runFor(600);
	await expect(pad.locator('#rc-prev')).toBeDisabled();
	await pad.locator('#rc-next').click();
	await expect(page.locator('#session-label')).toHaveText('Break');
});

test('the queue box shows the queue itself; its hint appears only when there is no queue', async ({ page, context }) => {
	await page.addInitScript(() => localStorage.setItem('tick_prefs', JSON.stringify({ nextQueue: [] })));
	const code = await hostWithRemote(page, '?mins=20');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	const box = pad.locator('#rc-queue-input');
	await expect(box).toHaveValue('');
	await expect(box).toHaveAttribute('placeholder', /^No queue/);
	await box.fill('Talk:25');
	await box.press('Enter');
	await page.clock.runFor(600);
	await expect(box).toHaveValue('Talk:25');
	await expect(pad.locator('#rc-next')).toBeEnabled();
});

test.describe('the pad on a 390×844 phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });
	test('has a status bar on the top edge and a larger time, and fits without scrolling', async ({ page }) => {
		await page.goto('/tick.html?rc=ABCDEF');
		const bar = (await page.locator('#rc-top').boundingBox())!;
		expect(bar.y).toBe(0);
		expect(bar.width).toBe(390); // edge to edge
		const [status, icon] = [(await page.locator('#remote-status-bar').boundingBox())!, (await page.locator('#rc-new-kiosk').boundingBox())!];
		expect(status.x).toBeLessThan(40); // status on the left
		expect(icon.x + icon.width).toBeGreaterThan(350); // kiosk button on the right
		const size = await page.locator('#remote-state-display').evaluate((d) => parseFloat(getComputedStyle(d).fontSize));
		expect(size).toBeGreaterThan(100); // was 62px at this width
		await expect(page.locator('#remote-state-display')).toHaveCSS('font-weight', '400'); // regular, as on the kiosk
		const [scroll, client] = await page.locator('#remote-pad').evaluate((p) => [p.scrollHeight, p.clientHeight]);
		expect(scroll).toBeLessThanOrEqual(client);
	});
});

test('a pad opened without a code asks for one, and a code typed in its bar connects it', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=');
	await expect(pad.locator('#remote-status-bar')).toHaveText(/enter a code/i);
	await expect(pad.locator('#rc-code-input')).toBeFocused();
	await expect(pad.locator('#rc-new-kiosk')).toBeDisabled();
	await pad.keyboard.type(code.toLowerCase()); // typed in any case
	await expect(pad.locator('#rc-code-input')).toHaveValue(code);
	await pad.keyboard.press('Enter');
	await expect(pad).toHaveURL(new RegExp('\\?rc=' + code + '$'));
	await pad.clock.runFor(200);
	await expect(pad.locator('#remote-status-bar')).toContainText(/connected/i);
	await expect(pad.locator('#rc-code-input')).toHaveValue(code); // the bar shows the code in use
});

test('a code that cannot be one is refused in the bar', async ({ page }) => {
	await page.goto('/tick.html?rc=ABCDEF');
	const box = page.locator('#rc-code-input');
	await box.fill('');
	await box.pressSequentially('OOO111'); // O and 1 are never used in codes
	await box.press('Enter');
	await expect(box).toHaveClass(/bad/);
	await expect(page).toHaveURL(/\?rc=ABCDEF$/);
});

test("another timer's remote window can turn that device into this timer's remote", async ({ page, context }) => {
	const code = await hostWithRemote(page);
	const other = await context.newPage();
	await open(other);
	await menu(other);
	await other.locator('#btn-remote').click();
	// The window opens on sharing; joining is one step away, and shows no code of its own.
	await expect(other.locator('#remote-join-view')).toBeHidden();
	await other.locator('#remote-to-join').click();
	await expect(other.locator('#remote-code-display')).toBeHidden();
	await expect(other.locator('#remote-qr')).toBeHidden();
	await expect(other.locator('#remote-join-code')).toBeFocused();
	await other.locator('#remote-join-code').fill('nope');
	await other.locator('#remote-join').click();
	await expect(other).toHaveURL(/\/tick\.html$/); // a typo stays put
	await other.locator('#remote-join-code').fill(code.toLowerCase());
	await other.locator('#remote-join-code').press('Enter');
	await expect(other).toHaveURL(new RegExp('\\?rc=' + code + '$'));
	await other.clock.runFor(200);
	await expect(other.locator('#remote-status-bar')).toContainText(/connected/i);
	await expect(page.locator('body')).toHaveClass(/kiosk/); // and the timer became the kiosk
});

test('the pad status stays on one line at 320 px, even when the kiosk is lost', async ({ page, context }) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	const code = await hostWithRemote(page);
	const pad = await context.newPage();
	await pad.setViewportSize({ width: 320, height: 568 });
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	const lines = () => pad.locator('#remote-status-bar').evaluate((el) => {
		const r = document.createRange(); r.selectNodeContents(el);
		return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
	});
	expect(await lines()).toBe(1);
	await page.close();
	await pad.clock.runFor(7_000);
	await expect(pad.locator('#remote-status-bar')).toHaveText('\u26A0\uFE0F Kiosk lost');
	expect(await lines()).toBe(1);
	const clipped = await pad.locator('#remote-status-bar').evaluate((el) => el.scrollWidth > el.clientWidth);
	expect(clipped).toBe(false); // short enough to need no ellipsis
});

test('a timer run from a remote drops the "click to start" hint', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	await expect(page.locator('#label-text')).toHaveText(/to start/i);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await expect(page.locator('body')).toHaveClass(/kiosk/);
	await expect(page.locator('#label-text')).toHaveText('');
	await page.keyboard.press('End'); // a reset brings the idle state back
	await page.clock.runFor(1_000);
	await expect(page.locator('#label-text')).toHaveText('');
});

test('leaving for the join view stops offering this timer’s code, unless a remote is connected', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	await page.locator('#remote-to-join').click();
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(9_000);
	await expect(pad.locator('#remote-status-bar')).toHaveText('\u26A0\uFE0F No connection'); // nobody answers that code now
	await page.locator('#remote-to-share').click(); // back: a fresh code is offered again
	await expect(page.locator('#remote-code-display')).toBeVisible();
	await expect(page.locator('#remote-code-display')).not.toHaveText(code);
});

// ── When the kiosk is lost, the pad keeps the timer ─────────────────────────
// A stand-in kiosk: a page on the same origin that speaks the kiosk's side of
// the BroadcastChannel, so a test can stop it, bring it back, and read what
// the pad sends it.
type Page = import('@playwright/test').Page;
const kioskState = (o: Record<string, unknown> = {}) => ({
	type: 'state', uiState: 'run', remaining: 600, totalSecs: 600, customLabel: 'Talk', running: true,
	nextQueue: [{ label: 'QA', mins: 5 }], untilTarget: null, untilLabel: '', fresh: false, prevCount: 0, warn1: 120, warn2: 60, ...o
});
async function fakeKiosk(context: import('@playwright/test').BrowserContext, code: string) {
	const k = await context.newPage();
	await k.goto('/README.md');
	await k.evaluate((code) => {
		const w = window as unknown as { ch: BroadcastChannel; got: { type: string }[] };
		w.ch = new BroadcastChannel('tick-rc-' + code);
		w.got = [];
		w.ch.onmessage = (e) => w.got.push(e.data);
	}, code);
	return {
		send: (msg: object) => k.evaluate((m) => (window as unknown as { ch: BroadcastChannel }).ch.postMessage(m), msg),
		got: () => k.evaluate(() => (window as unknown as { got: { type: string; snap?: { remaining: number } }[] }).got),
		clear: () => k.evaluate(() => ((window as unknown as { got: unknown[] }).got = []))
	};
}
async function padWithFakeKiosk(page: Page, context: import('@playwright/test').BrowserContext) {
	await open(page, '?rc=ABCDEF');
	const kiosk = await fakeKiosk(context, 'ABCDEF');
	await page.clock.runFor(200); // the pad says hello
	await kiosk.send(kioskState());
	await page.clock.runFor(1_000);
	await expect(page.locator('#remote-state-display')).toHaveText('09:59');
	return kiosk;
}

test('with the kiosk lost, the pad keeps counting, and its buttons work on its own copy', async ({ page, context }) => {
	const kiosk = await padWithFakeKiosk(page, context);
	await page.clock.runFor(7_000); // nothing from the kiosk: lost
	await expect(page.locator('#remote-status-bar')).toHaveText('⚠️ Kiosk lost');
	await expect(page.locator('#remote-state-display')).toHaveText('09:52'); // still counting
	await expect(page.locator('#remote-state-display')).toHaveClass(/local/);
	await kiosk.clear();
	await page.locator('#rc-toggle').click(); // pause, here
	await expect(page.locator('#rc-toggle')).toHaveText('Start');
	await page.clock.runFor(3_000);
	await expect(page.locator('#remote-state-display')).toHaveText('09:52');
	await page.locator('#rc-toggle').click(); // and on again
	await page.locator('[data-rc="adj:10"]').click();
	await expect(page.locator('#remote-state-display')).toHaveText('19:52');
	expect((await kiosk.got()).filter((m) => m.type === 'cmd')).toEqual([]); // nothing sent to a kiosk that isn't there
	await expect(page.locator('#rc-prev')).toBeDisabled();
});

test('with the kiosk lost, time running out hands over to the next session on the pad', async ({ page, context }) => {
	const kiosk = await padWithFakeKiosk(page, context);
	await kiosk.send(kioskState({ remaining: 3 }));
	await page.clock.runFor(8_000); // lost, and past zero
	await expect(page.locator('#remote-label-display')).toHaveText('QA');
	await expect(page.locator('#remote-state-display')).toHaveText(/^0[45]:\d\d$/);
	await expect(page.locator('#rc-queue-display .rc-q-row')).toHaveCount(0);
});

test('when the lost kiosk answers again, the pad sends its timer over, and it wins', async ({ page, context }) => {
	const kiosk = await padWithFakeKiosk(page, context);
	await page.clock.runFor(7_000);
	await page.locator('[data-rc="adj:10"]').click(); // 19:52 on the pad
	await kiosk.clear();
	await kiosk.send(kioskState({ remaining: 300 })); // the kiosk is back with its own idea: 05:00
	await page.clock.runFor(300);
	const sync = (await kiosk.got()).find((m) => m.type === 'sync');
	expect(sync, 'the pad sends its timer').toBeTruthy();
	expect(sync!.snap!.remaining).toBe(1192); // 19:52
	await expect(page.locator('#remote-state-display')).toHaveText('19:52'); // not 05:00
	await expect(page.locator('#remote-status-bar')).toHaveText('Connected');
});

test('when the pad itself was offline, the kiosk’s timer wins instead', async ({ page, context }) => {
	const kiosk = await padWithFakeKiosk(page, context);
	await context.setOffline(true);
	await page.clock.runFor(7_000);
	await expect(page.locator('#remote-status-bar')).toHaveText('⚠️ Offline');
	await page.locator('[data-rc="adj:10"]').click(); // a change made while offline...
	await context.setOffline(false);
	await kiosk.clear();
	await kiosk.send(kioskState({ remaining: 300 }));
	await page.clock.runFor(300);
	expect((await kiosk.got()).filter((m) => m.type === 'sync')).toEqual([]); // ...is not pushed
	await expect(page.locator('#remote-state-display')).toHaveText('05:00'); // the kiosk's timer
	await expect(page.locator('#remote-status-bar')).toHaveText('Connected');
});

test('a kiosk adopts the timer a pad syncs to it', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20');
	const pad = await context.newPage();
	await pad.goto('/README.md');
	await pad.evaluate((code) => new BroadcastChannel('tick-rc-' + code).postMessage({
		type: 'sync', snap: { remaining: 123, running: false, totalSecs: 600, customLabel: 'Panel', nextQueue: [{ label: 'QA', mins: 5 }] }
	}), code);
	await page.clock.runFor(100);
	await expect(digits(page)).toHaveText('02:03');
	await expect(page.locator('#session-label')).toHaveText('Panel');
	await expect(page.locator('#label-text')).toHaveText('PAUSED');
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 05:00 QA']);
});

test('Black covers the kiosk in the theme colour; the timer runs on under it, and Black or Esc lifts it', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('#rc-toggle').click();
	await pad.locator('#rc-black').click();
	const cover = page.locator('#blackout');
	await expect(cover).toBeVisible();
	const [bg, body] = await page.evaluate(() => [getComputedStyle(document.getElementById('blackout')!).backgroundColor, getComputedStyle(document.body).backgroundColor]);
	expect(bg).toBe(body); // black in the dark theme, white in the light one
	const box = (await cover.boundingBox())!;
	expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 1280, 720]); // the whole screen
	const top = await page.evaluate(() => document.elementFromPoint(640, 360)!.id);
	expect(top).toBe('blackout'); // over the time, and everything else
	await page.clock.runFor(600);
	await expect(pad.locator('#rc-black')).toHaveClass(/\bon\b/); // lit on the pad
	await pad.locator('[data-rc="adj:10"]').click(); // a change made under the cover...
	await page.clock.runFor(1_000);
	await expect(cover).toBeVisible();
	await pad.locator('#rc-black').click(); // ...shows when it lifts
	await expect(cover).toBeHidden();
	await expect(digits(page)).toHaveText(/^29:5\d$/);
	await pad.locator('#rc-black').click();
	await expect(cover).toBeVisible();
	await page.keyboard.press('Escape'); // on the kiosk itself
	await expect(cover).toBeHidden();
	await expect(page.locator('body')).toHaveClass(/kiosk/); // Esc lifted the cover only
});

test('in the light theme Black is a white-out', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&theme=light');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('#rc-black').click();
	const bg = await page.locator('#blackout').evaluate((el) => getComputedStyle(el).backgroundColor);
	const [r, g, b] = bg.match(/\d+/g)!.map(Number);
	expect(Math.min(r, g, b)).toBeGreaterThan(200); // light
});

test('the cover lifts with a double click on the kiosk; single clicks reach nothing under it', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('#rc-black').click();
	await expect(page.locator('#blackout')).toBeVisible();
	await page.mouse.click(640, 360); // a single click: no start, no pause
	await page.clock.runFor(500);
	await expect(page.locator('#blackout')).toBeVisible();
	await expect(digits(page)).not.toHaveClass(/s-run/);
	await page.mouse.dblclick(640, 360);
	await expect(page.locator('#blackout')).toBeHidden();
	await expect(page.locator('body')).toHaveClass(/kiosk/); // only the cover lifted
	await page.clock.runFor(2_500); // the next heartbeat tells the pad
	await expect(pad.locator('#rc-black')).not.toHaveClass(/\bon\b/);
});

test.describe('on a touch screen', () => {
	test.use({ hasTouch: true });
	test('the cover lifts with a double tap on the kiosk; a single tap reaches nothing under it', async ({ page, context }) => {
		const code = await hostWithRemote(page, '?mins=20');
		const pad = await context.newPage();
		await pad.goto('/tick.html?rc=' + code);
		await pad.clock.runFor(200);
		await pad.locator('#rc-black').click();
		await expect(page.locator('#blackout')).toBeVisible();
		await page.touchscreen.tap(640, 360);
		await page.clock.runFor(500);
		await expect(page.locator('#blackout')).toBeVisible();
		await expect(digits(page)).not.toHaveClass(/s-run/);
		await page.touchscreen.tap(640, 360);
		await page.clock.runFor(100);
		await page.touchscreen.tap(640, 360);
		await expect(page.locator('#blackout')).toBeHidden();
		await expect(page.locator('body')).toHaveClass(/kiosk/);
	});
});

test('reset, start and pause icons are as tall as a capital in their labels, on the same baseline', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20');
	const pad = await context.newPage();
	await pad.setViewportSize({ width: 390, height: 844 });
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	const measure = (sel: string) => pad.locator(sel).evaluate((btn) => {
		const ico = btn.querySelector('.ico')!.getBoundingClientRect();
		// A capital's height and baseline in this button's font, measured, not assumed.
		const probe = document.createElement('span');
		probe.style.cssText = 'display:inline-block;width:0;height:1cap;vertical-align:baseline';
		btn.append(probe);
		const cap = probe.getBoundingClientRect();
		probe.remove();
		return { h: ico.height, bottom: ico.bottom, capH: cap.height, capBottom: cap.bottom };
	});
	const reset = await measure('[data-rc="reset"]');
	const start = await measure('#rc-toggle');
	await pad.locator('#rc-toggle').click();
	await pad.clock.runFor(600);
	await expect(pad.locator('#rc-toggle')).toHaveText('Pause');
	const pause = await measure('#rc-toggle');
	for (const m of [reset, start, pause]) {
		expect(Math.abs(m.h - m.capH)).toBeLessThan(0.5);
		expect(Math.abs(m.bottom - m.capBottom)).toBeLessThan(0.5);
	}
	expect(reset.capH).toBeGreaterThan(14); // a real size, not zero
});

test("the pad shows the kiosk's elapsed time on the left and the clock on the right, under its status bar", async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20');
	const pad = await context.newPage();
	await pad.setViewportSize({ width: 390, height: 844 });
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('#rc-toggle').click();
	await pad.clock.runFor(12_000);
	const [elapsed, clock, bar] = [pad.locator('#remote-pad #session-timer'), pad.locator('#remote-pad #wall-clock'), pad.locator('#rc-top')];
	await expect(elapsed).toHaveText(await page.locator('#session-timer').textContent() as string); // the kiosk's, same figure
	await expect(elapsed).toHaveText(/^00:1[12]$/);
	await expect(clock).toHaveText(/^\d\d:\d\d:\d\d$/);
	const [e, c, b] = [(await elapsed.boundingBox())!, (await clock.boundingBox())!, (await bar.boundingBox())!];
	expect(e.y).toBeGreaterThan(b.y + b.height - 1); // under the status bar
	expect(e.x).toBeLessThan(40); // left
	expect(c.x + c.width).toBeGreaterThan(350); // right
	expect(Math.abs(e.y - c.y)).toBeLessThan(2); // one line
	await expect(pad.locator('#remote-pad #app-version')).toBeHidden();
	const [scroll, client] = await pad.locator('#remote-pad').evaluate((p) => [p.scrollHeight, p.clientHeight]);
	expect(scroll).toBeLessThanOrEqual(client); // still fits a 390×844 phone
});

test('the bell is drawn in CSS like the other icons, a capital tall, on the baseline', async ({ page }) => {
	await page.goto('/tick.html?rc=ABCDEF');
	const bell = page.locator('[data-rc="bell"]');
	await expect(bell).toHaveText('Bell'); // no emoji left in the label
	const m = await bell.evaluate((btn) => {
		const ico = btn.querySelector('.ico-bell')!;
		const r = ico.getBoundingClientRect();
		const probe = document.createElement('span');
		probe.style.cssText = 'display:inline-block;width:0;height:1cap;vertical-align:baseline';
		btn.append(probe);
		const cap = probe.getBoundingClientRect();
		probe.remove();
		return { h: r.height, bottom: r.bottom, capH: cap.height, capBottom: cap.bottom, mask: getComputedStyle(ico).maskImage };
	});
	expect(m.mask).toContain('data:image/svg+xml');
	expect(Math.abs(m.h - m.capH)).toBeLessThan(0.5);
	expect(Math.abs(m.bottom - m.capBottom)).toBeLessThan(0.5);
});

test("the session's name sits right under the time, on the pad and on the kiosk", async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&label=Keynote');
	const pad = await context.newPage();
	await pad.setViewportSize({ width: 390, height: 844 });
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	const under = async (p: typeof page, time: string, name: string) => {
		const [t, n] = [(await p.locator(time).boundingBox())!, (await p.locator(name).boundingBox())!];
		expect(n.y).toBeGreaterThanOrEqual(t.y + t.height - 1); // below the time
		expect(n.y - (t.y + t.height)).toBeLessThan(40); // and close under it
	};
	await expect(pad.locator('#remote-label-display')).toHaveText('Keynote');
	await under(pad, '#remote-state-display', '#remote-label-display');
	await expect(page.locator('#session-label')).toHaveText('Keynote');
	await under(page, '#timer-display', '#session-label');
});

test('with the kiosk lost, Next on the pad loads an @HH:MM session as a countdown to that time', async ({ page, context }) => {
	const kiosk = await padWithFakeKiosk(page, context); // 10:12:01 by the pad's clock
	await kiosk.send(kioskState({ nextQueue: [{ label: 'Panel', at: '10:30' }] }));
	await page.clock.runFor(7_000); // lost
	await page.locator('#rc-next').click();
	await expect(page.locator('#remote-label-display')).toHaveText('Panel');
	await expect(page.locator('#remote-state-display')).toHaveText(/^17:5\d$/); // to 10:30
	await expect(page.locator('#rc-queue-display .rc-q-row')).toHaveCount(0);
});

test("the session's name is the size of the queue rows, on the pad and on the kiosk", async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&label=Keynote&next=Break:5');
	const pad = await context.newPage();
	await pad.setViewportSize({ width: 390, height: 844 });
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	const fs = (p: typeof page, sel: string) => p.locator(sel).first().evaluate((el) => getComputedStyle(el).fontSize);
	expect(await fs(pad, '#remote-label-display')).toBe(await fs(pad, '#rc-queue-display .rc-q-row'));
	expect(await fs(page, '#session-label')).toBe(await fs(page, '.sq-queued'));
});

test('the pad’s fields are as tall as its buttons, on the page colour rather than the buttons’', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/tick.html?rc=ABCDEF');
	const h = (sel: string) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().height);
	const button = await h('#rc-queue-send');
	for (const field of ['#rc-queue-input', '#rc-msg-input']) expect(Math.abs((await h(field)) - button)).toBeLessThan(0.5);
	expect(Math.abs((await h('[data-rc="reset"]')) - button)).toBeLessThan(0.5);
	const bg = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
	const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	for (const field of ['#rc-queue-input', '#rc-msg-input', '#rc-code-input']) expect(await bg(field)).toBe(pageBg);
	expect(await bg('#rc-queue-send')).not.toBe(pageBg);
});
