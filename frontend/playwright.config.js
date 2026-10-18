import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:8887', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: `"${path.resolve('../.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')}" -m uvicorn src.web:app --host 127.0.0.1 --port 8887`,
    cwd: '..', url: 'http://127.0.0.1:8887/health', reuseExistingServer: false,
    env: { TRAVEL_API_TOKEN: 'fixture-' + 'X'.repeat(40), TRAVEL_DB: 'build/browser.sqlite', TRAVEL_AI_ENABLED: '0', TRAVEL_LIVE_WEATHER: '0' },
  },
});