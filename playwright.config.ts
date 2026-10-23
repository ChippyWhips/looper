import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	timeout: 120_000,
	fullyParallel: false,
	workers: 1,
	reporter: [['list']],
	webServer: {
		command: 'npm run build && npm run preview -- --port 4173 --strictPort',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	},
	use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 800 } },
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
				launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }
			}
		},
		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
			grep: /@smoke/
		},
		{
			name: 'firefox',
			use: {
				...devices['Desktop Firefox'],
				viewport: { width: 1280, height: 800 },
				launchOptions: { firefoxUserPrefs: { 'media.autoplay.default': 0 } }
			},
			grep: /@smoke/
		}
	]
});
