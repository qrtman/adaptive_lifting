import fs from 'fs';
import path from 'path';
import { defineConfig, devices } from '@playwright/test';

function devServerCommand() {
  const localNpm = path.join(
    process.cwd(),
    '.nodeenv',
    process.platform === 'win32' ? 'Scripts/npm.cmd' : 'bin/npm'
  );
  if (fs.existsSync(localNpm)) {
    return `"${localNpm}" run dev`;
  }
  return 'npm run dev';
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: devServerCommand(),
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
