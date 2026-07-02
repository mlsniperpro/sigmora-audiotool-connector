/**
 * Backend client — calls the connector's own same-origin proxy
 * (`/api/autopilot/*`), never content-autopilot directly.
 *
 * The proxy holds the service key server-side and derives the user identity
 * from the Audiotool session, so the browser ships NO secret and cannot spoof
 * who it is. Each call forwards the user's Audiotool access token (obtained via
 * the SDK's `exportTokens()`) in `x-audiotool-token`; the proxy verifies it.
 */

import type {
  AudienceProfile,
  RawNexusProject,
  ReleaseKit,
  SongConcept,
  VoiceSketch,
} from './types.js';

const PROXY_BASE = '/api/autopilot';

function headers(token: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['x-audiotool-token'] = token;
  return h;
}

async function post<T>(subpath: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}/${subpath}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const detail = json?.error ?? `HTTP ${res.status}`;
    throw new Error(`Backend ${subpath} failed: ${detail}`);
  }
  return json as T;
}

export interface GenerateOptions {
  platforms?: string[];
  skipVoiceover?: boolean;
  voiceId?: string;
  /** Consented artist voice-identity id → narrate in the artist's cloned voice. */
  voiceIdentityId?: string;
  /** Languages to auto-dub the voiceover into (ElevenLabs dubbing). */
  dubLanguages?: string[];
  /** Generate promo sound effects (ElevenLabs SFX). */
  includeSoundEffects?: boolean;
  /** Generate an instrumental promo bed (ElevenLabs Music v2). */
  includePromoBed?: boolean;
  /** Promo-bed length in seconds. */
  promoBedSeconds?: number;
  /** Render a short teaser cut (heavier; off by default). */
  includeTeaserCut?: boolean;
}

/** Finished track → release kit (category 06). */
export async function generateReleaseKit(
  token: string,
  project: RawNexusProject,
  options?: GenerateOptions,
): Promise<ReleaseKit> {
  const out = await post<{ kit: ReleaseKit }>('content/generate', token, {
    project,
    options,
    cacheKey: project.projectId,
  });
  return out.kit;
}

/**
 * Mint a shareable Stripe pre-save / fan-support link for a release (category 06
 * "monetised"). The proxy forwards to the Sigmora billing plane (apps/web
 * `createStripePaymentLink`) when `PRESAVE_URL` is configured server-side.
 * Returns null when no minter is configured (the demo then shows the offer only).
 */
export async function mintPreSaveLink(
  token: string,
  offer: { productName: string; amountUsd: number },
): Promise<string | null> {
  const out = await post<{ url?: string | null }>('presave', token, {
    productName: offer.productName,
    amountMinor: Math.round(offer.amountUsd * 100),
    currency: 'usd',
  });
  return out.url ?? null;
}

/**
 * Audience signal → startable song concepts (category 01).
 * Pass a structured `profile` to make ideation provably audience-data-driven;
 * the free-text `audienceSignal` is the fallback when no profile is available.
 */
export async function fetchSongConcepts(
  token: string,
  audienceSignal: string,
  count = 3,
  profile?: AudienceProfile,
): Promise<SongConcept[]> {
  const out = await post<{ concepts: SongConcept[] }>('songstarter', token, {
    audienceSignal,
    ...(profile ? { audienceProfile: profile } : {}),
    count,
  });
  return out.concepts;
}

/**
 * Concept → a short "sketch in your voice" (Music v2 → Audio Isolation → Voice
 * Changer). Flag-gated server-side (VOICE_SKETCH_ENABLED → 501 when off). A
 * labeled starting point; the real track is made in Audiotool.
 */
export async function fetchVoiceSketch(
  token: string,
  concept: SongConcept,
  voiceIdentityId: string,
  opts?: { lengthSeconds?: number; includeBackingBed?: boolean },
): Promise<VoiceSketch> {
  const out = await post<{ sketch: VoiceSketch }>('songstarter/sketch', token, {
    concept,
    voiceIdentityId,
    ...(opts?.lengthSeconds ? { lengthSeconds: opts.lengthSeconds } : {}),
    ...(opts?.includeBackingBed ? { includeBackingBed: true } : {}),
  });
  return out.sketch;
}
