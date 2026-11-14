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
	await expect(pad.locator('#rc-toggle')).toHaveText('\u23F8 Pause'); // the start button became pause
	await pad.locator('#rc-toggle').click();
	await expect(page.locator('#label-text')).toHaveText('PAUSED');
	await page.clock.runFor(600); // the kiosk's next update
	await expect(pad.locator('#rc-toggle')).toHaveText('\u25B6 Start');
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
					const r = document.createRange();
					r.selectNodeContents(b);
					const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
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
	const code = await hostWithRemote(page, '?mins=20&next=Break:5,QA:10,15');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await expect(pad.locator('#rc-queue-display .rc-q-head')).toHaveText('Next');
	await expect(pad.locator('#rc-queue-display .rc-q-row')).toHaveText(['\u25B6\uFE0E 05:00\u2002Break', '\u25B6\uFE0E 10:00\u2002QA', '\u25B6\uFE0E 15:00']);
	// Next and Prev use the same solid triangles as the list, pointing each way.
	await expect(pad.locator('#rc-next')).toHaveText('\u25B6\uFE0E Next');
	await expect(pad.locator('#rc-prev')).toHaveText('\u25C0\uFE0E Prev');
});

test('the pad reads top to bottom: status and kiosk icon, time, queue, controls, queue box and set, prev and next, bell', async ({ page }) => {
	await page.goto('/tick.html?rc=ABCDEF');
	const top = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
	const order = ['#remote-status-bar', '#remote-state-display', '#rc-queue-display', '#rc-toggle', '[data-rc="adj:10"]', '#rc-queue-input', '#rc-queue-send', '[data-rc="bell"]', '#rc-msg-input', '#rc-msg-send'];
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
	expect(bell.width).toBeGreaterThan(next.width * 1.8); // bell is the big one
	expect(reset.x).toBeLessThan((await top('#rc-toggle')).x);
});

test('the queue box holds the current queue, so an edit and Set changes it, and empty clears it', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&next=Break:5,QA:10,15');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	const box = pad.locator('#rc-queue-input');
	await expect(box).toHaveValue('Break:5,QA:10,15');
	await box.fill('Break:5,Q&A\\, panel:20');
	await pad.clock.runFor(2_500); // a heartbeat arrives while editing: the edit survives
	await expect(box).toHaveValue('Break:5,Q&A\\, panel:20');
	await pad.locator('#rc-queue-send').click();
	await expect(page.locator('.sq-queued')).toHaveText(['\u25B6 05:00\u2002Break', '\u25B6 20:00\u2002Q&A, panel']);
	await box.fill('');
	await box.press('Enter');
	await expect(page.locator('.sq-queued')).toHaveCount(0);
});

test('Prev steps back to the session before, and Next steps forward again', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&label=Talk&next=Break:5,QA:10');
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
