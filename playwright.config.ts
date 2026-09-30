import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	fullyParallel: false,
	reporter: 'list',
	use: {
		baseURL: 'http://127.0.0.1:4317',
		viewport: { width: 1440, height: 900 },
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chrome',
			use: {
				...devices['Desktop Chrome'],
				// Real Chrome: Scenes targets it, and it has the H.264/AAC encoders export needs.
				channel: 'chrome',
				viewport: { width: 1440, height: 900 },
				permissions: ['microphone'],
				launchOptions: {
					args: [
						'--autoplay-policy=no-user-gesture-required',
						// A fake microphone (it beeps) for voiceover tests.
						'--use-fake-ui-for-media-stream',
						'--use-fake-device-for-media-stream'
					]
				}
			}
		}
	],
	webServer: {
		command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4317 --strictPort',
		url: 'http://127.0.0.1:4317',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
