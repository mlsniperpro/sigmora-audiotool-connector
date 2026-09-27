# Sigmora × Audiotool — The Growth Loop

The Nexus connector web client for our **Let's Build! 2026** entry. It wraps the
Audiotool creative process with a growth layer: it tells an artist **what to make**
based on their real audience (cat 01), and gets the finished track **heard** once
they've made it (cat 06) — all bridged **live via Nexus** (cat 05), without leaving
the session.

> Built on `@audiotool/nexus@0.0.19`. Apache-2.0.

## What this repo is (and isn't)

This is a **starter kit for other builders**: a small, standalone Vite app that
shows the whole Nexus loop (OAuth PKCE, read a session, seed a project, write
markers back) against a backend. Fork it and build on it.

The live product at **https://sigmora.org** does not run this app. It embeds the
same Nexus integration directly in the Sigmora dashboard (Song Starter and
Release live inside a project), with a server-held session so an artist
connects Audiotool **once** and stays connected across browsers, devices and
workspaces. That code lives in the private Sigmora monorepo; the lessons are
below so you don't have to learn them the hard way.

## Lessons from running Nexus in production

- **One holder per refresh token.** Audiotool rotates refresh tokens. If the
  browser SDK and your server both keep and refresh the same token family,
  whichever refreshes first strands the other and your users get asked to
  connect again. Capture the tokens once, let the server be the only party that
  refreshes (serialize it with a lease), and hand the browser access tokens
  only.
- **`?error=` in your page URL logs the SDK out.** `audiotool()` treats any
  `error` query parameter as an OAuth failure and clears its stored session. Keep
  a server copy you can restore from, or keep that parameter off pages that
  mount the SDK.
- **`localhost` is rejected as a redirect URI.** Use `http://127.0.0.1:<port>`
  and register the exact callback URL, trailing slash included.
- **Register every origin you redirect from.** If `www.` redirects to the apex,
  the redirect URI the browser sends is the apex one.
- **Access tokens are long-lived, but refresh early anyway.** Refreshing a few
  days before expiry keeps the token family renewing while the artist is
  active.
- **0.0.18+ tolerates unknown document fields.** 0.0.17 threw on any project
  field it didn't know, so projects saved by a newer studio could fail to read.
  Stay current.

## What it does

| Step | Category | What happens |
|---|---|---|
| **Connect** | 05 | OAuth 2.0 PKCE via the Nexus SDK — the app is now in your live session |
| **Songstarter** | 01 | Your audience signal → 3 song concepts → **seeds a new project** into Audiotool (tempo-laid section markers) |
| **Release Autopilot** | 06 | Reads your finished session → Sigmora backend returns copy, an **ElevenLabs voiceover**, a release plan → **writes campaign markers back** into the project |

## Architecture (two planes)

Per the Nexus model, **only the browser can write** a session; the server is
read-only. So the work splits cleanly:

```
┌─ BROWSER PLANE (this app, Vite) ─────────┐      ┌─ BACKEND (content-autopilot) ──────────┐
│ @audiotool/nexus                         │      │ existing Sigmora LLM + TTS pipeline    │
│ • OAuth PKCE  (src/nexus.ts: connect)    │      │ POST /api/audiotool/content/generate   │
│ • read session (readProject)             │ ───▶ │   normalize → release kit              │
│ • write markers (writeCampaignMarkers)   │ ◀─── │ POST /api/audiotool/songstarter        │
│ • seed project (seedConcept)             │      │   audience signal → concepts           │
└──────────────────────────────────────────┘      └────────────────────────────────────────┘
```

Heavy generation (LLM, ElevenLabs) lives in the backend where those providers
already are; the browser owns auth + the live reads/writes.

## Backend endpoints (in `services/content-autopilot`)

- `POST /api/audiotool/content/generate` — `{ project: RawNexusProject, options? }` → `{ kit }`
- `POST /api/audiotool/content/read` — `{ projectRef }` → server-side read via `AUDIOTOOL_PAT`, then generate (optional fallback plane)
- `POST /api/audiotool/songstarter` — `{ audienceSignal, count? }` → `{ concepts }`

All are gated by `Authorization: Bearer <COMPUTE_API_KEY>` + `x-user-id`.

## Configuration (two kinds of env)

The `COMPUTE_API_KEY` is **never** exposed to the browser. The browser calls a
same-origin proxy (`api/autopilot/*`), which verifies the user's Audiotool
session (GetWhoami) and attaches the key server-side before forwarding to
content-autopilot. So env splits in two (see `.env.example`):

| Var | Plane | Purpose |
|---|---|---|
| `VITE_AUDIOTOOL_CLIENT_ID` | **public** (browser) | OAuth PKCE client id |
| `VITE_AUDIOTOOL_REDIRECT_URI` | **public** (browser) | must EXACTLY match a registered redirect URI (trailing slash incl.) |
| `AUTOPILOT_URL` | **server only** | base URL of the content-autopilot service |
| `COMPUTE_API_KEY` | **server only** | shared secret = content-autopilot's `COMPUTE_API_KEY`; setting it also enables prod posture (a valid Audiotool session required per call) |
| `PRESAVE_URL` | **server only** | optional — Sigmora `POST /api/presave` for the Stripe pre-save CTA |

> Do NOT put `COMPUTE_API_KEY` behind a `VITE_` prefix — that would inline it
> into the browser bundle.

## Run it

1. **Register the app** at `developer.audiotool.com/applications`, scope
   `project:write`. Dev redirect URI `http://127.0.0.1:5173/` (Audiotool
   **requires 127.0.0.1**, not `localhost`); prod = your deployed origin + `/`.
2. **Configure** — copy `.env.example` to `.env`, fill the table above.
3. **Backend** — run `services/content-autopilot` with a Gemini/LLM key,
   `ELEVENLABS_API_KEY`, and the matching `COMPUTE_API_KEY`. (Server-side reads
   via `POST /content/read` also need `AUDIOTOOL_PAT`.)
4. **Client** — `pnpm install && pnpm dev`, open `http://127.0.0.1:5173/`.

```bash
pnpm dev         # vite dev server on 127.0.0.1:5173 (proxy via vite middleware)
pnpm build       # tsc + vite production build
pnpm typecheck   # tsc --noEmit
pnpm test:e2e    # Playwright UI → API smoke (mocked SDK + stubbed backend)
```

## Deployment (Vercel)

- SPA + serverless. The proxy is `api/autopilot/[...path].ts` and **must run on
  the edge runtime** (`export const config = { runtime: 'edge' }`) — it is
  written Web-style (`Request`→`Response`, `req.json()`); the Node runtime would
  throw `req.json is not a function`.
- `vercel.json` rewrites funnel **all** `/api/autopilot/*` (incl. nested paths
  like `content/generate`) to the catch-all function, and everything else to the
  SPA `index.html`.
- Set `VITE_*` (build-time) + the server-only vars on the project, then deploy.

## Status

**Verified end-to-end live on `www.audiotool.com` (2026-06-23):** real OAuth →
Songstarter seeded a playable project (3 tracks: concept note, section regions
with a pentatonic phrase) → Release Autopilot produced copy + 4 platform
captions + a release plan + an ElevenLabs voiceover + 2 sound effects + a teaser
+ a Stripe pre-save → 4 campaign markers written back into the live session.

## Tests

`pnpm test:e2e` runs a deterministic Chromium flow proving the browser plane
wiring without a real `client_id`, backend, or keys:

- the Nexus SDK is swapped for a mock (`test/mocks/`) via a `MOCK_NEXUS=1` Vite
  alias, so OAuth auto-authenticates and read/write resolve;
- the backend is stubbed with `page.route()`, asserting the posted payloads;
- the spec walks connect → songstarter → **seed**, then release → **write-back**,
  asserting each response renders.

The alias is off for `pnpm build`, so production bundles the real SDK (verified
in CI: the mock never reaches `dist/`).

## Files

| File | Role |
|---|---|
| `src/nexus.ts` | the connector — OAuth, read, write-back, project seeding (cat 05) |
| `src/api.ts` | backend client (release kit + songstarter) |
| `src/main.ts` | demo flow wiring the three categories together |
| `src/types.ts` | wire contract, mirrored from the backend |

## Notes

- SDK is **pre-1.0** — pinned to `0.0.17`; budget a re-pin + retest before the deadline.
- The `project:write` scope powers both the Songstarter seed and the campaign-marker write-back.
- Write-backs use only entity types proven by the SDK's own `write-melody` example
  (`pulverisateur` → `noteTrack` → `noteRegion`), so markers/seeds are valid sessions.
- The transport-tempo write is best-effort/guarded; if it no-ops the concept BPM
  still rides in the concept-note region (verified: sections/notes/markers/note land).

## Built with ElevenLabs

Release Autopilot composes multiple ElevenLabs products into one kit:

- **Text-to-Speech** — the voiced release trailer (synthesized, attached as audio)
- **Sound Effects** — promo stings generated from the track's mood
- **Dubbing** — trailer translated to other languages (optional `Translate the trailer into …`)
- **Music v2** — optional promo bed
- (Voice Cloning / Audio Isolation / Voice Changer power the experimental
  "sketch in your voice" path, flag-gated behind `VOICE_SKETCH_ENABLED`.)

## License

**Apache-2.0** — see [`LICENSE`](./LICENSE). Open-sourced for the Audiotool
Let's Build! 2026 hackathon.
