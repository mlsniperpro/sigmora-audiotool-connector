/**
 * Client runtime config, sourced from Vite env (see `.env.example`).
 *
 * Only PUBLIC values live here — everything in the browser bundle is readable
 * by anyone. The PKCE client id and redirect URI are public by design. The
 * service key, backend URL, and pre-save endpoint are SERVER-only and live in
 * the proxy's env (see `server/autopilot-proxy.ts`), never as VITE_* vars.
 */
export const CONFIG = {
  clientId: import.meta.env.VITE_AUDIOTOOL_CLIENT_ID ?? '',
  redirectUrl: import.meta.env.VITE_AUDIOTOOL_REDIRECT_URI ?? 'http://127.0.0.1:5173/',
  /** Nexus scope — write access so we can seed/markup the live session. */
  scope: 'project:write',
} as const;

export function assertConfigured(): string | null {
  if (!CONFIG.clientId) {
    return 'Missing VITE_AUDIOTOOL_CLIENT_ID — register the app at developer.audiotool.com/applications and set it in .env.';
  }
  return null;
}
