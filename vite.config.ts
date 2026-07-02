import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { proxyAutopilot, type ProxyEnv } from './server/autopilot-proxy';

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// When MOCK_NEXUS=1 (Playwright e2e), swap the real WASM-backed SDK for a
// deterministic mock so the UI → backend wiring can be tested without a real
// OAuth client_id or browser consent flow. `/utils` MUST precede the bare
// specifier so the more specific alias wins.
const mockNexus = process.env.MOCK_NEXUS === '1';
const nexusAliases = mockNexus
  ? [
      { find: '@audiotool/nexus/utils', replacement: resolvePath('./test/mocks/nexus-utils.ts') },
      { find: '@audiotool/nexus', replacement: resolvePath('./test/mocks/nexus.ts') },
    ]
  : [];

// Dev/preview parity for the production Vercel function (api/autopilot/[...]):
// serves `/api/autopilot/*` from the same shared proxy core so `pnpm dev` (and
// e2e, when not intercepted) behaves like prod. Server-only env (AUTOPILOT_URL,
// COMPUTE_API_KEY, PRESAVE_URL) is read here in Node, never exposed to the bundle.
function autopilotDevProxy(env: ProxyEnv): Plugin {
  const readBody = (req: import('node:http').IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => resolve(data));
      req.on('error', () => resolve(''));
    });

  return {
    name: 'autopilot-dev-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/autopilot')) return next();
        void (async () => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
            return;
          }
          const subpath = url.replace(/^\/api\/autopilot\/?/, '').split('?')[0];
          const raw = await readBody(req);
          let body: unknown = {};
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            body = {};
          }
          const token = (req.headers['x-audiotool-token'] as string | undefined) ?? undefined;
          const result = await proxyAutopilot({ subpath, body, audiotoolToken: token, env });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.json));
        })();
      });
    },
  };
}

// Audiotool OAuth redirects require 127.0.0.1 (NOT localhost) — the consent
// screen rejects localhost. Keep host/port in sync with the redirect URI
// registered at developer.audiotool.com/applications and VITE_AUDIOTOOL_REDIRECT_URI.
export default defineConfig(({ mode }) => {
  // Load ALL env (empty prefix), so we can read server-only vars for the dev proxy.
  const env = loadEnv(mode, process.cwd(), '');
  const proxyEnv: ProxyEnv = {
    AUTOPILOT_URL: env.AUTOPILOT_URL,
    COMPUTE_API_KEY: env.COMPUTE_API_KEY,
    PRESAVE_URL: env.PRESAVE_URL,
  };
  return {
    resolve: { alias: nexusAliases },
    plugins: [autopilotDevProxy(proxyEnv)],
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  };
});
