import { test, expect, open, digits } from './fixtures';

async function hostWithRemote(page: import('@playwright/test').Page, query = '?mins=20') {
	await open(page, query);
	await page.locator('#btn-menu').click();
	await page.locator('#btn-remote').click();
	return (await page.locator('#remote-code-display').textContent())!.trim();
}

// Same-browser remote control runs over BroadcastChannel and needs no
// network. The cross-device path (PeerJS) is aborted by the fixture, which
// is also the honest test of "works offline in the same browser".
test('a remote pad in another tab starts, pauses and adjusts the host', async ({ page, context }) => {
	await open(page, '?mins=20');
	await page.locator('#btn-menu').click();
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	expect(code).toMatch(/^[A-Z2-9]{6}$/);

	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await expect(pad.locator('#remote-status-bar')).toContainText('connected');
	await expect(page.locator('#remote-status')).toContainText('connected');

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
	await page.locator('#btn-menu').click();
	await page.locator('#btn-remote').click();
	const code = (await page.locator('#remote-code-display').textContent())!.trim();
	await page.keyboard.press('Space'); // the modal is open; start from the pad instead
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
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
	await page.locator('#btn-menu').click();
	await page.locator('#btn-remote').click();
	await expect.poll(() => page.evaluate(() => typeof (window as unknown as { Peer?: unknown }).Peer)).toBe('function');
});

test('a tampered PeerJS is refused by the browser', async ({ page, errors }) => {
	await page.route(PEER_URL, (r) =>
		r.fulfill({ body: 'window.Peer = function () {}', contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } })
	);
	await open(page);
	await page.locator('#btn-menu').click();
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
		await expect(pad.locator('#remote-status-bar')).toContainText('connected');
		await pad.locator('[data-rc="start"]').tap();
		await expect(digits(page)).toHaveClass(/s-run/);
	});
});

test('a pad whose code nobody answers says so', async ({ page }) => {
	await open(page, '?rc=WRONG1');
	await page.clock.runFor(8_500);
	await expect(page.locator('#remote-status-bar')).toContainText('no connection');
});

test('reopening the remote while a pad is connected still says connected', async ({ page, context }) => {
	const code = await hostWithRemote(page);
	const pad = await context.newPage();
	await pad.goto('/tick.html?rc=' + code);
	await expect(page.locator('#remote-status')).toContainText('connected');
	await page.locator('#remote-modal-close').click();
	await page.locator('#btn-menu').click();
	await page.locator('#btn-remote').click();
	await expect(page.locator('#remote-status')).toContainText('connected');
});

test("the broker's WebSocket is blocked like any other off-site request", async ({ page, offsite }) => {
	await page.route(PEER_URL, (r) => r.fulfill({ path: 'node_modules/peerjs/dist/peerjs.min.js', headers: { 'access-control-allow-origin': '*' } }));
	await hostWithRemote(page);
	await expect.poll(() => offsite.some((u) => u.startsWith('wss://'))).toBe(true);
});
