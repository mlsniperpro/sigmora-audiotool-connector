/**
 * Server-side proxy core — the trust boundary for the hosted connector.
 *
 * The browser plane must NOT hold the content-autopilot service key, and must
 * NOT be trusted to declare who the user is. So every backend call goes through
 * this proxy, which:
 *   1. verifies the caller's Audiotool session server-side (GetWhoami) and
 *      derives a forge-proof tenant id from it, and
 *   2. attaches the COMPUTE_API_KEY (kept in server-only env) before forwarding
 *      to content-autopilot.
 *
 * Framework-agnostic on purpose: the Vercel function (`api/autopilot/[...].ts`)
 * and the Vite dev middleware (vite.config.ts) both wrap this one function, so
 * dev and prod share identical behavior. Uses only global `fetch` — no Node
 * APIs — so it typechecks without @types/node and runs in any modern runtime.
 */

/** Server-only configuration, injected by each wrapper from its env. */
export interface ProxyEnv {
  /** Public base URL of the deployed content-autopilot service. */
  AUTOPILOT_URL?: string;
  /** Shared service secret content-autopilot validates. Its presence also flips
   *  the proxy into "production posture" (a valid Audiotool session required). */
  COMPUTE_API_KEY?: string;
  /** Optional pre-save minter endpoint (apps/web `POST /api/presave`). */
  PRESAVE_URL?: string;
}

export interface ProxyResult {
  status: number;
  json: unknown;
}

/** Browser-supplied subpath → the real content-autopilot route. Allowlisted so
 *  the client can never coerce the proxy into forwarding to an arbitrary path. */
const AUTOPILOT_ROUTES: Record<string, string> = {
  songstarter: '/api/audiotool/songstarter',
  'songstarter/sketch': '/api/audiotool/songstarter/sketch',
  'content/generate': '/api/audiotool/content/generate',
};

const WHOAMI_URL = 'https://rpc.audiotool.com/audiotool.auth.v1.AuthService/GetWhoami';

/**
 * Resolve a forge-proof tenant id from the user's Audiotool access token by
 * calling Audiotool's own whoami RPC. A bad/expired/forged token can't pass
 * this — Audiotool rejects it — so the returned id is trustworthy.
 *
 * @param requireValid In production posture, a missing/invalid token is a hard
 *   401. In dev posture (no COMPUTE_API_KEY) we fall back to a dev tenant so the
 *   connector works offline against a local backend.
 */
async function resolveUserId(
  token: string | undefined,
  requireValid: boolean,
): Promise<{ userId?: string; error?: ProxyResult }> {
  if (token) {
    const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    try {
      const res = await fetch(WHOAMI_URL, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { whoami?: { userName?: string } } | null;
        const userName = data?.whoami?.userName;
        if (userName) return { userId: `audiotool:${userName}` };
      }
    } catch {
      // Network error reaching Audiotool — treat as unverified below.
    }
    if (requireValid) {
      return { error: { status: 401, json: { success: false, error: 'Audiotool session invalid or expired — reconnect.' } } };
    }
  } else if (requireValid) {
    return { error: { status: 401, json: { success: false, error: 'Missing Audiotool session — connect first.' } } };
  }
  // Dev posture only.
  return { userId: 'audiotool-dev' };
}

/** Verify identity, then forward a single connector call to its real backend. */
export async function proxyAutopilot(input: {
  subpath: string;
  body: unknown;
  audiotoolToken?: string;
  env: ProxyEnv;
}): Promise<ProxyResult> {
  const { subpath, body, audiotoolToken, env } = input;
  const requireValid = Boolean(env.COMPUTE_API_KEY);

  // Pre-save lives on a different plane (apps/web) and carries no service key.
  if (subpath === 'presave') {
    if (!env.PRESAVE_URL) return { status: 200, json: { url: null } };
    const { userId, error } = await resolveUserId(audiotoolToken, requireValid);
    if (error) return error;
    const res = await fetch(env.PRESAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId as string },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  const path = AUTOPILOT_ROUTES[subpath];
  if (!path) return { status: 404, json: { success: false, error: `Unknown route: ${subpath}` } };
  if (!env.AUTOPILOT_URL) {
    return { status: 500, json: { success: false, error: 'AUTOPILOT_URL is not configured on the server.' } };
  }

  const { userId, error } = await resolveUserId(audiotoolToken, requireValid);
  if (error) return error;

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-user-id': userId as string };
  if (env.COMPUTE_API_KEY) headers.Authorization = `Bearer ${env.COMPUTE_API_KEY}`;

  // Normalize: tolerate a scheme-less AUTOPILOT_URL (e.g. "host:3000") so a
  // mis-set env can't produce an opaque "Invalid URL" TypeError.
  let base = env.AUTOPILOT_URL.replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  const target = `${base}${path}`;
  try {
    const res = await fetch(target, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { status: 502, json: { success: false, error: `Upstream fetch failed: ${detail} (target=${target})` } };
  }
}
