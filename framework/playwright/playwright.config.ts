import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: [['list'], ['json', { outputFile: '../../runs/latest/playwright-results.json' }]],
  webServer: {
    command: 'npx tsx apps/under-test/server.ts',
    port: 4731,
    reuseExistingServer: false,
    env: { PLAYWRIGHT_APP_PORT: '4731' },
    timeout: 120000,
    cwd: '../../',
  },
  use: {
    baseURL: 'http://127.0.0.1:4731',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'ui',
      testMatch: '**/ui/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'api',
      testMatch: '**/api/*.spec.ts',
    },
  ],
});
