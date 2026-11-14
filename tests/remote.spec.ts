import { test, expect, open, digits } from './fixtures';

// Same-browser remote control runs over BroadcastChannel and needs no
// network. The cross-device path (PeerJS) is aborted by the fixture, which
// is also the honest test of "works offline in the same browser".
test('a remote pad in another tab starts, pauses and adjusts the host', async ({ page, context, errors }) => {
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
	void errors;
});
