import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// CI installs the Chromium this Playwright pins. Cloud dev containers ship
// one already at this path; use it rather than downloading a second copy.
const preinstalled = '/opt/pw-browsers/chromium';
const executablePath = !process.env.CI && existsSync(preinstalled) ? preinstalled : undefined;

export default defineConfig({
	testDir: 'tests',
	fullyParallel: true,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	// Never reused: a server already on the port could be serving another
	// checkout's tick.html, and every failure would then point at the wrong file.
	webServer: { command: 'node scripts/serve.mjs', port: 4173, reuseExistingServer: false },
	use: { baseURL: 'http://localhost:4173', trace: 'off' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }]
});
