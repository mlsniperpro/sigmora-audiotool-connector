import { expect, test } from '@playwright/test';

/**
 * UI → API end-to-end wiring (deterministic).
 *
 * The Nexus SDK is mocked (OAuth auto-authenticates, read/write succeed) and
 * the same-origin proxy (/api/autopilot/*) is stubbed via request interception
 * — the proxy + content-autopilot live server-side, out of the browser's reach.
 * This proves the browser plane actually:
 *   - renders the connected state after OAuth
 *   - posts the right payloads to the right endpoints
 *   - renders the responses (concepts, release kit)
 *   - drives the SDK write-backs (seed project, campaign markers)
 * without needing a real client_id, backend, or API keys.
 */

const CONCEPTS = [
  { title: 'Neon Rain', mood: 'moody', theme: 'city nights', tempo: 88, hookIdea: 'reverbed Rhodes stab', sections: ['Intro', 'Verse', 'Hook'] },
];

const KIT = {
  track: {
    projectId: 'demo',
    title: 'Midnight Drive',
    tempo: 120,
    durationSec: 90,
    sections: [{ name: 'Intro', startSec: 0 }],
    devices: [{ type: 'pulverisateur', count: 2 }],
    rawMeta: { entityCount: 3, entityTypeCounts: {} },
  },
  releaseCopy: 'A late-night drive in audio form.',
  platformCopy: [{ platform: 'tiktok', caption: 'new one is up — Midnight Drive', hashtags: ['#lofi'] }],
  releasePlan: ['Pitch to lo-fi playlists', 'Set up a pre-save'],
  voiceover: { script: 'Headlights on the highway.', provider: 'elevenlabs', synthesized: true, audioPath: '/tmp/vo.mp3', audioUrl: 'data:audio/mpeg;base64,AAAA', viaVoiceClone: false },
  dubs: [{ language: 'es', audioPath: '/tmp/es.mp3', text: 'Faros en la carretera.', provider: 'elevenlabs' }],
  soundEffects: [{ prompt: 'tape-stop riser', audioPath: '/tmp/sfx-0.mp3' }],
  promoBed: { prompt: 'instrumental promo bed', audioPath: '/tmp/bed.mp3' },
  socialCut: { videoPath: '/tmp/teaser.mp4', videoUrl: 'data:video/mp4;base64,AAAA' },
  preSave: { title: 'Back Midnight Drive', blurb: 'Support the release and unlock it early.', suggestedAmountUsd: 5, ctaLabel: 'Pre-save + support' },
  campaignMarkers: [{ atSec: 48, label: 'hook -> Reels cut' }],
  elevenLabsProducts: ['tts', 'dubbing', 'sound-effects', 'music'],
};

test.beforeEach(async ({ page }) => {
  // Stub the backend. Assert the request payloads are well-formed as they pass.
  await page.route('**/api/autopilot/songstarter', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.audienceSignal).toBeTruthy();
    await route.fulfill({ json: { success: true, concepts: CONCEPTS } });
  });
  await page.route('**/api/autopilot/content/generate', async (route) => {
    const body = route.request().postDataJSON();
    // The browser read the (mocked) session and posted a normalized snapshot.
    expect(body.project).toBeTruthy();
    expect(Array.isArray(body.project.entities)).toBe(true);
    // Phase A: the demo now sends product options (no longer TTS-only).
    expect(body.options?.includePromoBed).toBe(true);
    await route.fulfill({ json: { success: true, kit: KIT } });
  });
});

test('connect → songstarter → seed, then release → write-back', async ({ page }) => {
  await page.goto('/');

  // 1) OAuth (mocked) completes → connected state renders.
  await expect(page.locator('.badge')).toHaveText(/connected/i);
  await expect(page.locator('.who')).toContainText('Test Artist');

  // 2) Songstarter: audience signal → concepts (cat 01).
  await page.getByPlaceholder(/what do your fans love/i).fill('fans love late-night lo-fi');
  await page.getByRole('button', { name: /generate song concepts/i }).click();
  await expect(page.getByText('Neon Rain')).toBeVisible();

  // Seed the concept into Audiotool (mocked SDK createProject + modify).
  await page.getByRole('button', { name: /seed into audiotool/i }).first().click();
  await expect(page.getByText(/Seeded "Neon Rain"/)).toBeVisible();

  // 3) Release Autopilot: pick a project from the in-app list (no URL pasting).
  await expect(page.locator('select')).toContainText('Midnight Drive');
  await page.getByLabel(/Promo bed/i).check();
  await page.getByRole('button', { name: /^generate release$/i }).click();

  await expect(page.getByText(/Release kit — Midnight Drive/)).toBeVisible();
  await expect(page.getByText('new one is up — Midnight Drive')).toBeVisible();
  await expect(page.getByText('Headlights on the highway.')).toBeVisible();

  // Multi-product ElevenLabs surface + monetization render (the win-critical bits).
  await expect(page.getByText('Built with ElevenLabs')).toBeVisible();
  await expect(page.getByText('Dubbing', { exact: true })).toBeVisible();
  await expect(page.getByText(/Dubbed into 1 language/)).toBeVisible();
  await expect(page.locator('.el-products')).toContainText('Music v2');
  await expect(page.getByText(/Promo bed \(instrumental/)).toBeVisible();
  // Results are playable in-app (inline data-URL players) — audio + the trailer video.
  await expect(page.locator('audio.player').first()).toBeVisible();
  await expect(page.locator('video.player')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pre-save \+ support · \$5/ })).toBeVisible();

  // 4) Write campaign markers back into the live session (cat 06 + 05).
  await page.getByRole('button', { name: /write campaign markers back/i }).click();
  await expect(page.getByText(/Wrote .* campaign markers into the live session/i)).toBeVisible();

  // 5) Reactive bridge (cat 05): watch the live session, observe a live event,
  //    and the one-click "regenerate from updated session" affordance appears.
  await page.getByRole('button', { name: /watch session live/i }).click();
  await expect(page.getByText(/live: tonematrix created in your session/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Regenerate from updated session/i })).toBeVisible();
});

test('app shell boots and mounts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Sigmora/i })).toBeVisible();
  await expect(page.locator('#app')).toBeVisible();
});
