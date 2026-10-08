import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

const PORT = 3101;
const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, launchOptions: { executablePath: chromium } },
  // Builds the UI, seeds a throwaway database, then serves API + built UI on one port.
  webServer: {
    command: 'npm run build && npm run db:seed -- --reset && npm start',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      DATABASE_PATH: '.e2e/payguard.db',
      UPLOAD_DIR: '.e2e/uploads',
      DEMO_PASSWORD: 'e2e-demo-password',
      ANTHROPIC_API_KEY: '',
    },
  },
});
