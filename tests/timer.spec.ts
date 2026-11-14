import { test, expect, open, digits, label, settle } from './fixtures';

test('opens idle at the default duration, and asks for nothing off-site', async ({ page, offsite, errors }) => {
	await open(page);
	await expect(digits(page)).toHaveText('10:00');
	await expect(digits(page)).toHaveClass(/s-idle/);
	await settle(page);
	expect(offsite).toEqual([]);
	void errors;
});

test('space starts and pauses; the count follows the clock', async ({ page, errors }) => {
	await open(page, '?mins=25');
	await page.keyboard.press('Space');
	await page.clock.runFor(3000);
	await expect(digits(page)).toHaveText('24:57');
	await expect(digits(page)).toHaveClass(/s-run/);
	await page.keyboard.press('Space');
	await expect(label(page)).toHaveText('PAUSED');
	await page.clock.runFor(5000);
	await expect(digits(page)).toHaveText('24:57');
	void errors;
});

test('typed digits set the minutes, arrows adjust a running timer', async ({ page, errors }) => {
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
	void errors;
});

test('warning colours at the two thresholds, then overtime counts up in red', async ({ page, errors }) => {
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
	void errors;
});

// Known bug, found while writing this: at zero the next slot loads but never
// starts — startTimer() returns early because the timer is still running.
test.fail('the queue loads and starts the next slot when time runs out', async ({ page, errors }) => {
	await open(page, '?mins=1&label=Talk&next=Break:2,QA:5');
	await expect(page.locator('#session-label')).toHaveText('Talk');
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 02:00 Break', '▶ 05:00 QA']);
	await page.keyboard.press('Space');
	await page.clock.fastForward(62_000);
	await expect(page.locator('#session-label')).toHaveText('Break');
	await expect(page.locator('.sq-queued')).toHaveText(['▶ 05:00 QA']);
	await page.clock.fastForward(2_000);
	await expect(digits(page)).toHaveClass(/s-run/);
	void errors;
});

test('ctrl+enter skips to the next queued slot', async ({ page, errors }) => {
	await open(page, '?mins=25&next=Break:5');
	await page.keyboard.press('Space');
	await page.keyboard.press('Control+Enter');
	await expect(digits(page)).toHaveText('05:00');
	await expect(digits(page)).toHaveClass(/s-next/);
	void errors;
});

// Known bug, found while writing this: Enter in the target modal also reaches
// the page's own Enter (restart at the default duration), undoing the target.
test.fail('target mode defaults to the next half hour and counts down to it', async ({ page, errors }) => {
	await open(page, '', '2026-11-14T10:12:00');
	await page.keyboard.press('u');
	await expect(page.locator('#until-hour')).toHaveValue('10');
	await expect(page.locator('#until-min')).toHaveValue('30');
	await page.locator('#until-hour').press('Enter');
	await page.clock.runFor(100);
	await expect(digits(page)).toHaveText('18:00');
	await expect(digits(page)).toHaveClass(/s-until|s-run/);
	void errors;
});

test('end resets to the starting duration', async ({ page, errors }) => {
	await open(page, '?mins=4');
	await page.keyboard.press('Space');
	await page.clock.fastForward(10_000);
	await page.keyboard.press('End');
	await expect(digits(page)).toHaveText('04:00');
	void errors;
});
