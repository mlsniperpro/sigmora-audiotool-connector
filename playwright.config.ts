import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the Audiotool connector UI.
 *
 * Boots the Vite dev server with MOCK_NEXUS=1 (so the SDK is mocked and OAuth
 * auto-authenticates) and test env. The backend is stubbed per-test via
 * page.route(), so no real backend/keys/client_id are needed.
 */
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      MOCK_NEXUS: '1',
      VITE_AUDIOTOOL_CLIENT_ID: 'test-client-id',
      VITE_AUDIOTOOL_REDIRECT_URI: 'http://127.0.0.1:5173/',
      // Server-only proxy env. The test intercepts /api/autopilot/* at the
      // browser boundary, so this isn't actually hit — present for parity.
      AUTOPILOT_URL: 'http://127.0.0.1:3000',
    },
  },
});
