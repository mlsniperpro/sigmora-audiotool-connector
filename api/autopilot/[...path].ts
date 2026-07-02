/**
 * Vercel Function (Node runtime) — the production wrapper around the shared
 * proxy core. Catch-all so `/api/autopilot/<subpath>` (incl. nested like
 * `content/generate`) all land here. Reads server-only env that is NEVER
 * VITE_-prefixed, so the COMPUTE_API_KEY can't leak into the browser bundle.
 */
import { proxyAutopilot } from '../../server/autopilot-proxy.js';

// Edge runtime: this handler is written in the Web style (Request -> Response,
// req.json()), which Vercel only provides on the edge runtime. Without this the
// function runs as a classic Node serverless fn (req = IncomingMessage) and
// `req.json()` throws "is not a function". The proxy only uses fetch + env, so
// it is edge-compatible.
export const config = { runtime: 'edge' };

// Ambient declaration so this typechecks without @types/node in the workspace.
declare const process: { env: Record<string, string | undefined> };

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  // Base guards a relative req.url (some runtimes pass a path, not an absolute URL).
  const subpath = new URL(req.url, 'http://localhost').pathname.replace(/^\/api\/autopilot\/?/, '');
  const body = await req.json().catch(() => ({}));
  const token = req.headers.get('x-audiotool-token') ?? undefined;

  const result = await proxyAutopilot({
    subpath,
    body,
    audiotoolToken: token,
    env: {
      AUTOPILOT_URL: process.env.AUTOPILOT_URL,
      COMPUTE_API_KEY: process.env.COMPUTE_API_KEY,
      PRESAVE_URL: process.env.PRESAVE_URL,
    },
  });

  return jsonResponse(result.json, result.status);
}
