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

	await pad.locator('[data-rc="start"]').click();
	await expect(digits(page)).toHaveClass(/s-run/);
	await pad.locator('[data-rc="adj:10"]').click();
	await page.clock.runFor(100);
	await expect(digits(page)).toHaveText('30:00');
	await pad.locator('[data-rc="pause"]').click();
	await expect(page.locator('#label-text')).toHaveText('PAUSED');
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
	await pad.locator('[data-rc="start"]').click();
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
		await pad.locator('[data-rc="start"]').tap();
		await expect(digits(page)).toHaveClass(/s-run/);
	});
});

test('a pad whose code nobody answers says so', async ({ page }) => {
	await open(page, '?rc=WRONG1');
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
	await pad.locator('[data-rc="start"]').click();
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

test('the pad says Connected with a check mark, and shows no state name', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('[data-rc="start"]').click();
	await pad.clock.runFor(600);
	await expect(pad.locator('#remote-status-bar')).toHaveText('\u2705 Connected');
	await expect(pad.locator('#remote-label-display')).toHaveText('');
});

test('an operator message typed on the pad shows on the kiosk, not the pad', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('#rc-msg-input').fill('Two minutes');
	await pad.locator('#rc-msg-input').press('Enter');
	await expect(page.locator('#op-msg-overlay')).toHaveClass(/show/);
	await expect(page.locator('#op-msg-box')).toHaveText('Two minutes');
	await expect(pad.locator('#op-msg-overlay')).not.toHaveClass(/show/);
	await expect(page.locator('#op-msg-input')).toHaveCount(0); // no longer on the timer
	await pad.locator('#rc-msg-clear').click();
	await expect(page.locator('#op-msg-overlay')).not.toHaveClass(/show/);
});

test('a lost kiosk is reported, and a new kiosk from the pad carries on the timer', async ({ page, context }) => {
	const code = await hostWithRemote(page, '?mins=20&label=Keynote&next=QA:10');
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await pad.clock.runFor(200);
	await pad.locator('[data-rc="start"]').click();
	await pad.clock.runFor(3_000); // 19:57 left, and the pad has heard so
	await page.close();
	await pad.clock.runFor(7_000); // three heartbeats missed
	await expect(pad.locator('#remote-status-bar')).toContainText(/kiosk disconnected/i);

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
