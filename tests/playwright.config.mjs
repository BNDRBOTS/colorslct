import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: 'e2e.spec.mjs',
  timeout: 45000,
  retries: 0,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8899',
    launchOptions: { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    viewport: { width: 1280, height: 850 }
  },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:8899/index.html',
    reuseExistingServer: true,
    timeout: 15000
  }
});
