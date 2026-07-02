/**
 * Sigmora × Audiotool — the Growth Loop demo entry point.
 *
 * Flow:
 *   1. Connect (OAuth)                     → earns 05 (Connect)
 *   2. Songstarter: audience → concepts    → earns 01 (Discovery)
 *      → seed a new project into Audiotool
 *   3. Release Autopilot: finished track   → earns 06 (Growth)
 *      → read session → backend release kit → write campaign markers back
 */

import { fetchSongConcepts, fetchVoiceSketch, generateReleaseKit, type GenerateOptions, mintPreSaveLink } from './api.js';
import { assertConfigured } from './config.js';
import { accessToken, type Authed, connect, listProjects, readProject, seedConcept, watchSession, writeCampaignMarkers } from './nexus.js';
import type { AudienceProfile, ReleaseKit, SongConcept } from './types.js';
import { busyOn, el, logError, logLine, mount, renderConcepts, renderReleaseKit, renderSketch, show } from './ui.js';

// A song concept handed off from the main Sigmora web app survives login via
// this key. The OAuth flow returns to the bare `redirectUrl`, dropping the
// `?seed=` query string, so we stash it before redirecting. sessionStorage
// (not localStorage) scopes it to this tab so an abandoned seed can't re-plant
// itself in a future visit.
const SEED_STASH_KEY = 'sigmora_audiotool_seed';

/** Parse a raw `?seed=` JSON string into a concept. Null when absent/malformed. */
function parseSeed(raw: string | null): SongConcept | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SongConcept>;
    if (!parsed || typeof parsed.title !== 'string') return null;
    return {
      title: parsed.title,
      mood: typeof parsed.mood === 'string' ? parsed.mood : '',
      theme: typeof parsed.theme === 'string' ? parsed.theme : '',
      tempo: typeof parsed.tempo === 'number' ? parsed.tempo : 120,
      hookIdea: typeof parsed.hookIdea === 'string' ? parsed.hookIdea : '',
      sections: Array.isArray(parsed.sections)
        ? parsed.sections.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * The concept the web app handed off (its Songstarter page links here with
 * `?seed=<json>`). Reads the URL first, then the stash that survives the OAuth
 * round-trip. Returns null when absent or malformed.
 */
function readSeedConcept(): SongConcept | null {
  const fromUrl = parseSeed(new URLSearchParams(location.search).get('seed'));
  if (fromUrl) return fromUrl;
  try {
    return parseSeed(sessionStorage.getItem(SEED_STASH_KEY));
  } catch {
    return null;
  }
}

/** Persist the inbound `?seed=` BEFORE login redirects away and strips it. */
function stashSeed(): void {
  try {
    const raw = new URLSearchParams(location.search).get('seed');
    if (raw) sessionStorage.setItem(SEED_STASH_KEY, raw);
  } catch {
    /* sessionStorage unavailable — the seed handoff just won't survive login */
  }
}

/** Drop the seed once it's been planted so a reload can't duplicate the project. */
function consumeSeed(): void {
  try {
    sessionStorage.removeItem(SEED_STASH_KEY);
  } catch {
    /* ignore */
  }
  removeQueryParams('seed');
}

/**
 * Strip spent query params via replaceState so a reload can't replay them.
 * The Audiotool SDK cleans these on its happy path, but not on every error
 * branch (a failed token exchange leaves `?code`/`state` behind) — a reload
 * would then re-POST an already-used code. We belt-and-suspenders it here.
 */
function removeQueryParams(...keys: string[]): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of keys) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, document.title, url.search ? url.href : url.href.replace(/\?$/, ''));
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Whether an auth error is a spent/replayed handshake rather than a real
 * denial. Audiotool (Ory) returns "The consent verifier has already been used"
 * when an authorize link is followed twice; the SDK also surfaces stale-state
 * and missing-verifier variants. All are fixed by a fresh, clean login() — so
 * we say so plainly instead of dead-ending on the raw provider string. A
 * genuine user "Deny" (access_denied without these markers) is NOT stale.
 */
function isStaleAuthError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('consent verifier') ||
    message.includes('already been used') ||
    message.includes('invalid state') ||
    message.includes('code verifier')
  );
}

async function main(): Promise<void> {
  const configError = assertConfigured();
  if (configError) {
    mount('#auth', el('p', { className: 'error' }, [configError]));
    return;
  }

  // Preserve any concept the web app handed off before the OAuth redirect can
  // strip it (login() returns to the bare redirectUrl, dropping `?seed=`).
  stashSeed();

  const auth = await connect();

  if (auth.status === 'unauthenticated') {
    // A spent/replayed authorize link ("consent verifier has already been
    // used", stale state, missing verifier) is fully recoverable: a fresh
    // login() starts a clean handshake. Strip any spent OAuth params so a
    // reload can't replay them, and tell the user plainly that one click fixes
    // it — rather than dead-ending on the raw provider error.
    const stale = auth.error ? isStaleAuthError(auth.error) : false;
    removeQueryParams('code', 'scope', 'state', 'error', 'error_description');
    if (auth.error && !stale) logError(auth.error);
    if (stale) logLine('Your previous sign-in link expired — click Connect to retry with a fresh one.');
    const button = el(
      'button',
      { className: 'primary', onclick: () => { stashSeed(); auth.login(); } },
      ['Connect Audiotool'],
    );
    mount(
      '#auth',
      el('p', {}, [
        stale
          ? 'That sign-in link already ran once and expired (Audiotool links are single-use). Click Connect to start a fresh sign-in.'
          : 'Connect your Audiotool account to begin.',
      ]),
      button,
    );
    return;
  }

  // Authenticated — `auth` IS the client.
  await renderConnected(auth);
}

async function renderConnected(at: Authed): Promise<void> {
  mount(
    '#auth',
    el('div', { className: 'who' }, [
      el('span', { className: 'badge' }, ['● connected']),
      el('span', {}, [`as ${at.userName}`]),
      el('button', { className: 'ghost', onclick: () => at.logout() }, ['Log out']),
    ]),
  );
  show('#content');
  logLine(`Connected as ${at.userName}.`);

  // Shared project picker — list the user's tracks so they pick one in-app
  // instead of pasting studio URLs (the main "don't jiggle to Audiotool" fix).
  const picker = el('select', { className: 'wide' });
  const refreshProjects = async (selectUrl?: string): Promise<void> => {
    try {
      const projects = await listProjects(at);
      if (!projects.length) {
        picker.replaceChildren(
          el('option', { value: '' }, ['No projects yet — seed one in Songstarter below']),
        );
        return;
      }
      picker.replaceChildren(...projects.map((p) => el('option', { value: p.url }, [p.displayName])));
      // Select the requested project only if it's actually in the list (a freshly
      // seeded project can lag); otherwise keep the first option selected.
      if (selectUrl && projects.some((p) => p.url === selectUrl)) picker.value = selectUrl;
    } catch (error) {
      logError(error);
    }
  };
  await refreshProjects();

  mount(
    '#content',
    songstarterPanel(at, refreshProjects),
    el('hr', {}),
    releaseAutopilotPanel(at, picker, refreshProjects),
  );

  // Handoff from the main Sigmora web app: if a concept arrived via `?seed=`,
  // seed it straight into a new Audiotool project now that we're authenticated,
  // so the artist lands on the idea instead of re-entering it here.
  const seed = readSeedConcept();
  if (seed) {
    // Consume it up front: a seed only plants once, so even if this attempt
    // throws, a reload won't silently create a duplicate project.
    consumeSeed();
    logLine(`Seeding "${seed.title}" from Sigmora into a new Audiotool project…`);
    try {
      const url = await seedConcept(at, seed);
      await refreshProjects(url);
      logLine('✓ Seeded — now selected in Release Autopilot below.');
    } catch (error) {
      logError(error);
    }
  }
}

// ---- Category 01 — Songstarter ---------------------------------------------

function songstarterPanel(
  at: Authed,
  refreshProjects: (selectUrl?: string) => Promise<void>,
): HTMLElement {
  const input = el('input', {
    type: 'text',
    placeholder: 'What do your fans love? — e.g. late-night lo-fi, driving beats',
    className: 'wide',
  });
  // Structured audience inputs — when filled, ideation is provably data-driven
  // (the backend renders these into the signal), not a free-text guess (cat 01).
  const countryInput = el('input', { type: 'text', className: 'wide', placeholder: 'Top country (e.g. United States)' });
  const interestsInput = el('input', { type: 'text', className: 'wide', placeholder: 'Top interests — comma separated (e.g. lo-fi, study, late-night)' });
  const sourcesInput = el('input', { type: 'text', className: 'wide', placeholder: 'Traffic sources — comma separated (e.g. YouTube search, Reels)' });
  // Optional: a consented voice-identity id enables a "sketch in your voice"
  // preview per concept (Music v2 → Audio Isolation → Voice Changer). A starting
  // point only — the real track is made in Audiotool. Server flag-gated.
  const sketchVoiceIdInput = el('input', { type: 'text', className: 'wide', placeholder: 'Your voice id (optional) — preview a 15s sketch in your voice' });
  const results = el('div', {});
  const button = el('button', { className: 'primary' }, ['Generate song concepts']);

  const buildProfile = (): AudienceProfile | undefined => {
    const profile: AudienceProfile = {};
    const primaryCountry = countryInput.value.trim();
    const topInterests = interestsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    const trafficSources = sourcesInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (primaryCountry) profile.primaryCountry = primaryCountry;
    if (topInterests.length) profile.topInterests = topInterests;
    if (trafficSources.length) profile.trafficSources = trafficSources;
    return Object.keys(profile).length ? profile : undefined;
  };

  button.onclick = async () => {
    const signal = input.value.trim();
    const profile = buildProfile();
    if (!signal && !profile) {
      logLine('Enter an audience signal, or fill in at least one audience field.');
      return;
    }
    const restore = busyOn(button, 'Generating…');
    results.replaceChildren();
    logLine(profile ? 'Finding concepts from your audience data…' : 'Finding song ideas…');
    try {
      const concepts = await fetchSongConcepts(accessToken(at), signal, 3, profile);
      logLine(`Got ${concepts.length} concepts.`);
      const vid = sketchVoiceIdInput.value.trim();
      const onSketch = vid
        ? async (concept: SongConcept) => {
            logLine(`Generating a 15s sketch of "${concept.title}" in your voice…`);
            try {
              const sketch = await fetchVoiceSketch(accessToken(at), concept, vid, { lengthSeconds: 15, includeBackingBed: true });
              logLine(`✓ Sketch ready (${sketch.elevenLabsProducts.join(', ') || 'no products'}).`);
              results.append(renderSketch(sketch));
            } catch (error) {
              logError(error);
            }
          }
        : undefined;
      results.append(
        renderConcepts(
          concepts,
          async (concept) => {
            logLine(`Seeding "${concept.title}" into a new Audiotool project…`);
            try {
              const url = await seedConcept(at, concept);
              await refreshProjects(url);
              logLine('✓ Seeded — now selected in Release Autopilot below.');
              results.append(el('p', { className: 'ok' }, [`Seeded "${concept.title}". `, el('a', { href: url, target: '_blank' }, ['Open in Audiotool ↗'])]));
            } catch (error) {
              logError(error);
            }
          },
          onSketch,
        ),
      );
    } catch (error) {
      logError(error);
    } finally {
      restore();
    }
  };

  return el('section', {}, [
    el('h2', {}, ['Songstarter']),
    el('p', { className: 'meta' }, ['Turn what your fans love into song ideas — each seeded as a real, playable Audiotool project.']),
    input,
    el('p', { className: 'meta' }, ['…or tell us about your audience to sharpen the ideas:']),
    countryInput,
    interestsInput,
    sourcesInput,
    sketchVoiceIdInput,
    button,
    results,
  ]);
}

// ---- Category 06 — Release Autopilot ---------------------------------------

function releaseAutopilotPanel(
  at: Authed,
  picker: HTMLSelectElement,
  refreshProjects: (selectUrl?: string) => Promise<void>,
): HTMLElement {
  const refreshBtn = el('button', { className: 'ghost', title: 'Refresh project list', onclick: () => refreshProjects() }, ['↻']);
  const results = el('div', {});
  const button = el('button', { className: 'primary' }, ['Generate release']);

  // ElevenLabs product toggles — turn the demo from "TTS only" into the full
  // multi-product kit (dubbing / SFX / Music v2 bed / voice-clone). These are
  // the levers the "Built with ElevenLabs" slide needs to show >1 product.
  const bedToggle = el('input', { type: 'checkbox' });
  const sfxToggle = el('input', { type: 'checkbox' });
  const teaserToggle = el('input', { type: 'checkbox' });
  const dubInput = el('input', { type: 'text', className: 'wide', placeholder: 'Translate the trailer into — e.g. es, pt-BR, fr' });
  const voiceIdInput = el('input', { type: 'text', className: 'wide', placeholder: 'Your voice id (optional) — narrate the trailer in your voice' });
  const buildReleaseOptions = (): GenerateOptions => {
    const opts: GenerateOptions = {};
    const dubLanguages = dubInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (dubLanguages.length) opts.dubLanguages = dubLanguages;
    if (sfxToggle.checked) opts.includeSoundEffects = true;
    if (bedToggle.checked) opts.includePromoBed = true;
    if (teaserToggle.checked) opts.includeTeaserCut = true;
    const vid = voiceIdInput.value.trim();
    if (vid) opts.voiceIdentityId = vid;
    return opts;
  };

  let lastKit: ReleaseKit | null = null;
  let lastUrl = '';

  // Reactive bridge (cat 05): when the live session changes, OFFER a one-click
  // regenerate — proves the bridge is two-way and live, not a one-shot read.
  const regenerateButton = el('button', { className: 'primary' }, ['↻ Regenerate from updated session']);
  const regenerateBanner = el('div', { className: 'banner hidden' }, [
    el('span', {}, ['● Your Audiotool session changed.']),
    regenerateButton,
  ]);

  const writeBackButton = el('button', { className: 'ghost hidden' }, ['Write campaign markers back →']);
  writeBackButton.onclick = async () => {
    if (!lastKit || !lastUrl) return;
    const restore = busyOn(writeBackButton, 'Writing…');
    logLine(`Writing ${lastKit.campaignMarkers.length} markers into the session…`);
    try {
      const count = await writeCampaignMarkers(at, lastUrl, lastKit.campaignMarkers, lastKit.track.tempo ?? 120);
      logLine(`✓ Wrote ${count} markers. Flip to your Audiotool tab to see them land.`);
      results.append(el('p', { className: 'ok' }, [`Wrote ${count} campaign markers into the live session.`]));
    } catch (error) {
      logError(error);
    } finally {
      restore();
    }
  };

  // Read the live session → backend release kit → render. Reusable so both the
  // button and the reactive bridge's regenerate affordance can trigger it.
  const runGenerate = async (): Promise<void> => {
    const url = picker.value;
    if (!url) {
      logLine('Pick a project first — or seed one in Songstarter above.');
      return;
    }
    const restore = busyOn(button, 'Generating…');
    regenerateBanner.classList.add('hidden');
    results.replaceChildren();
    writeBackButton.classList.add('hidden');
    try {
      logLine('Reading the live session…');
      const project = await readProject(at, url);
      logLine(`Read ${project.entities.length} entities. Generating release kit…`);
      const kit = await generateReleaseKit(accessToken(at), project, buildReleaseOptions());
      lastKit = kit;
      lastUrl = url;
      logLine('✓ Release kit ready.');
      results.append(
        renderReleaseKit(kit, async () => {
          logLine(`Minting a Stripe pre-save link ($${kit.preSave.suggestedAmountUsd})…`);
          try {
            const link = await mintPreSaveLink(accessToken(at), {
              productName: kit.preSave.title,
              amountUsd: kit.preSave.suggestedAmountUsd,
            });
            if (link) {
              logLine(`✓ Pre-save link ready: ${link}`);
              window.open(link, '_blank');
            } else {
              logLine('Set PRESAVE_URL on the server to mint a live Stripe link (offer shown above).');
            }
          } catch (error) {
            logError(error);
          }
        }),
      );
      if (kit.campaignMarkers.length) writeBackButton.classList.remove('hidden');
    } catch (error) {
      logError(error);
    } finally {
      restore();
    }
  };
  button.onclick = runGenerate;
  regenerateButton.onclick = runGenerate;

  let stopWatch: (() => Promise<void>) | null = null;
  const watchButton = el('button', { className: 'ghost' }, ['Watch session live ▷']);
  watchButton.onclick = async () => {
    const url = picker.value;
    if (!url && !stopWatch) {
      logLine('Pick a project first to watch it live.');
      return;
    }
    if (stopWatch) {
      await stopWatch();
      stopWatch = null;
      watchButton.textContent = 'Watch session live ▷';
      logLine('Stopped watching the session.');
      return;
    }
    const verbs: Record<string, string> = { create: 'created', update: 'updated', remove: 'removed' };
    try {
      stopWatch = await watchSession(at, url, (event) => {
        logLine(`● live: ${event.entityType ?? 'entity'} ${verbs[event.kind] ?? 'changed'} in your session.`);
        // The bridge noticed an edit — surface a one-click regenerate.
        if (lastKit) regenerateBanner.classList.remove('hidden');
      });
      watchButton.textContent = 'Stop watching ◼';
      logLine('Watching the live session — edit it in Audiotool and changes appear here.');
    } catch (error) {
      logError(error);
    }
  };

  return el('section', {}, [
    el('h2', {}, ['Release Autopilot']),
    el('p', { className: 'meta' }, ['Pick a finished track and get release copy, a voiced trailer, a launch plan, and a fan-support page — with campaign markers written back into your session.']),
    el('div', { className: 'pickrow' }, [picker, refreshBtn]),
    el('div', { className: 'options' }, [
      el('label', {}, [bedToggle, ' Promo bed (Music v2)']),
      el('label', {}, [sfxToggle, ' Sound effects']),
      el('label', {}, [teaserToggle, ' Teaser cut']),
    ]),
    dubInput,
    voiceIdInput,
    button,
    watchButton,
    regenerateBanner,
    writeBackButton,
    results,
  ]);
}

main().catch((error) => {
  logError(error);
});
