import { test, expect, open, digits, label, settle, menu } from './fixtures';

test('opens idle at the default duration, and asks for nothing off-site', async ({ page, offsite }) => {
	await open(page);
	await expect(digits(page)).toHaveText('10:00');
	await expect(digits(page)).toHaveClass(/s-idle/);
	await settle(page);
	expect(offsite).toEqual([]);
});

test('space starts and pauses; the count follows the clock', async ({ page }) => {
	await open(page, '?mins=25');
	await page.keyboard.press('Space');
	await page.clock.runFor(3000);
	await expect(digits(page)).toHaveText('24:57');
	await expect(digits(page)).toHaveClass(/s-run/);
	await page.keyboard.press('Space');
	await expect(label(page)).toHaveText('PAUSED');
	await page.clock.runFor(5000);
	await expect(digits(page)).toHaveText('24:57');
});

test('typed digits set the minutes, arrows adjust a running timer', async ({ page }) => {
	await open(page);
	await page.keyboard.type('7');
	await expect(page.locator('#key-buffer')).toContainText('7');
	await page.keyboard.press('Enter');
	await expect(digits(page)).toHaveText('07:00');
	await page.keyboard.press('Space');
	await page.keyboard.press('ArrowUp'); // +10
	await page.keyboard.press('ArrowLeft'); // +1
	await page.keyboard.press('ArrowDown'); // -5
	await page.clock.runFor(100);
	await expect(digits(page)).toHaveText('13:00');
});

test('warning colours at the two thresholds, then overtime counts up in red', async ({ page }) => {
	await open(page, '?mins=3');
	// A first visit queues one 10-minute slot, which would take over at zero.
	await page.keyboard.press('n');
	await page.locator('.qr-del').click();
	await page.locator('#next-set').click();
	await page.keyboard.press('Space');
	await page.clock.fastForward(61_000); // 1:59 left, under the 120 s default
	await expect(digits(page)).toHaveClass(/s-warn\b/);
	await page.clock.fastForward(60_000); // 0:59 left
	await expect(digits(page)).toHaveClass(/s-warn2/);
	await page.clock.fastForward(64_000); // 5 s over
	await expect(digits(page)).toHaveClass(/s-ot/);
	await expect(label(page)).toHaveText('OVERTIME');
	await expect(digits(page)).toHaveText('+00:05');
});

test('the queue loads and starts the next slot when time runs out', async ({ page }) => {
	await open(page, '?mins=1&label=Talk&next=Break:2,QA:5');
	await expect(page.locator('#session-label')).toHaveText('Talk');
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 02:00 Break', '▶ 05:00 QA']);
	await page.keyboard.press('Space');
	await page.clock.fastForward(62_000);
	await expect(page.locator('#session-label')).toHaveText('Break');
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 05:00 QA']);
	await page.clock.fastForward(2_000);
	// Running, and already inside the 120 s default warning for a 2-minute slot.
	await expect(digits(page)).toHaveClass(/s-warn\b/);
	await expect(digits(page)).toHaveText('01:58');
	// The redraw loop survived the hand-over (it once stopped for good here).
	await page.clock.runFor(3_000);
	await expect(digits(page)).toHaveText('01:55');
});

test('enter in a modal saves the modal and leaves a running timer alone', async ({ page }) => {
	await open(page, '?mins=20&next=Break:5');
	await page.keyboard.press('Space');
	await page.clock.runFor(2_000);
	await page.keyboard.press('n');
	await page.locator('#queue-current-label').fill('Opening');
	await page.locator('#queue-current-label').press('Enter');
	await expect(page.locator('#session-label')).toHaveText('Opening');
	await page.keyboard.press('w');
	await page.locator('#warn1-input').press('Enter');
	await page.clock.runFor(1_000);
	await expect(digits(page)).toHaveText('19:57');
	await expect(digits(page)).toHaveClass(/s-run/);
});

test('ctrl+enter skips to the next queued slot', async ({ page }) => {
	await open(page, '?mins=25&next=Break:5');
	await page.keyboard.press('Space');
	await page.keyboard.press('Control+Enter');
	await expect(digits(page)).toHaveText('05:00');
	await expect(digits(page)).toHaveClass(/s-next/);
});

test('target mode defaults to the next half hour and counts down to it', async ({ page }) => {
	await open(page, '', '2026-11-14T10:12:00');
	await page.keyboard.press('u');
	await expect(page.locator('#until-hour')).toHaveValue('10');
	await expect(page.locator('#until-min')).toHaveValue('30');
	await page.locator('#until-hour').press('Enter');
	await page.clock.runFor(100);
	await expect(digits(page)).toHaveText('18:00');
	await expect(digits(page)).toHaveClass(/s-until|s-run/);
});

test('end resets to the starting duration', async ({ page }) => {
	await open(page, '?mins=4');
	await page.keyboard.press('Space');
	await page.clock.fastForward(10_000);
	await page.keyboard.press('End');
	await expect(digits(page)).toHaveText('04:00');
});

test('running past zero by hand hands over to the queue', async ({ page }) => {
	await open(page, '?mins=1&label=Talk&next=Break:5');
	await page.keyboard.press('Space');
	await page.clock.fastForward(30_000);
	await page.keyboard.press('ArrowRight'); // −1 min: 0:30 → −0:30
	await expect(page.locator('#session-label')).toHaveText('Break');
	await page.clock.runFor(2_000);
	await expect(digits(page)).toHaveText('04:58');
});

test('holding the sound button rings the bell without changing the setting', async ({ page }) => {
	await open(page);
	await menu(page);
	await page.locator('#btn-sound').hover();
	await page.mouse.down();
	await page.clock.runFor(900);
	await page.mouse.up();
	await expect(page.locator('#btn-sound')).toHaveText('sound: off');
	await page.locator('#btn-sound').click(); // a plain click still cycles
	await expect(page.locator('#btn-sound')).toHaveText('sound: end');
});

test('the mouse wheel scrolls the manual instead of changing the timer', async ({ page }) => {
	await open(page);
	await page.keyboard.press('Space');
	await page.keyboard.press('Home');
	await page.locator('#manual').hover();
	await page.mouse.wheel(0, 600);
	await expect.poll(() => page.locator('#manual').evaluate((m) => m.scrollTop)).toBeGreaterThan(0);
	await page.keyboard.press('Escape');
	await expect(digits(page)).toHaveText('10:00');
});

test('out-of-range minutes in the URL are ignored', async ({ page }) => {
	await open(page, '?mins=Infinity&next=Talk:0.01,QA:1e9,Break:5.5');
	await expect(digits(page)).toHaveText('10:00');
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 05:00 Break']);
});

test('the queue keeps counting down, and hands over, behind clock mode', async ({ page }) => {
	// Saved rather than ?next=, because a URL queue is never written back.
	await page.addInitScript(() => {
		if (!sessionStorage.getItem('seeded')) {
			localStorage.setItem('tick_prefs', JSON.stringify({ nextQueue: [{ label: 'Break', mins: 5 }] }));
			sessionStorage.setItem('seeded', '1');
		}
	});
	await open(page, '?mins=1&label=Talk');
	await page.keyboard.press('Space');
	await menu(page);
	await page.locator('#btn-clock-watch').click();
	await page.clock.fastForward(61_500); // overtime starts at −1 s
	await page.clock.runFor(100); // ... and the hand-over happens while the clock shows
	// Seen from outside the face: the hand-over saves the shortened queue.
	const queued = () => page.evaluate(() => JSON.parse(localStorage.getItem('tick_prefs')!).nextQueue.length);
	expect(await queued()).toBe(0);
	await expect(digits(page)).toHaveClass(/s-watch/);
	await page.clock.fastForward(3_000);
	await menu(page);
	await page.locator('#btn-clock-watch').click();
	await page.clock.runFor(100);
	await expect(page.locator('#session-label')).toHaveText('Break');
	await expect(digits(page)).toHaveText('04:57'); // Break began at 61 s, it's now 64 s
});

test('the queue under a running timer is not rebuilt every second', async ({ page }) => {
	await open(page, '?mins=20&next=Break:5');
	await page.keyboard.press('Space');
	const row = await page.locator('.sq-queued').elementHandle();
	await page.clock.runFor(3_000);
	expect(await row!.evaluate((el) => el.isConnected)).toBe(true);
	await page.locator('.sq-queued').click();
	await expect(page.locator('#next-modal')).toHaveClass(/open/);
	await expect(digits(page)).toHaveClass(/s-run/);
});

test('the session label survives starting over', async ({ page }) => {
	await open(page);
	await page.keyboard.press('n');
	await page.locator('#queue-current-label').fill('Panel');
	await page.locator('#next-set').click();
	await page.keyboard.press('Enter');
	await page.keyboard.press('End');
	await expect(page.locator('#session-label')).toHaveText('Panel');
});

test.describe('on a touch screen', () => {
	test.use({ hasTouch: true });
	test('tapping the queue opens it and leaves the timer running', async ({ page }) => {
		await open(page, '?mins=20&next=Break:5');
		await settle(page); // the menu opens on load; its backdrop would take the tap
		await page.locator('#timer-display').tap();
		await page.clock.runFor(500);
		await expect(digits(page)).toHaveClass(/s-run/);
		await page.locator('.sq-queued').tap();
		await page.clock.runFor(500);
		await expect(page.locator('#next-modal')).toHaveClass(/open/);
		await expect(digits(page)).toHaveClass(/s-run/);
	});
});
