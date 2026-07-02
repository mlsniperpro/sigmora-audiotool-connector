/**
 * Browser plane — the Nexus connector itself (category 05).
 *
 * Owns everything that must run client-side: OAuth (PKCE, handled by the SDK),
 * reading the live session, writing campaign markers back into it (06), and
 * seeding a brand-new project from a song concept (01). Heavy generation is
 * delegated to the Sigmora backend (see `api.ts`).
 */

import { audiotool, type BrowserAuthResult } from '@audiotool/nexus';
import { secondsToTicks, Ticks } from '@audiotool/nexus/utils';
import { CONFIG } from './config.js';
import type { CampaignMarker, RawNexusProject, SongConcept } from './types.js';

/** The authenticated client (`status === "authenticated"`) — `audiotool()` result. */
export type Authed = Extract<BrowserAuthResult, { status: 'authenticated' }>;

/** Kick off / resume the OAuth PKCE flow. Returns the auth result. */
export function connect(): Promise<BrowserAuthResult> {
  return audiotool({ clientId: CONFIG.clientId, redirectUrl: CONFIG.redirectUrl, scope: CONFIG.scope });
}

/**
 * The authenticated user's Audiotool access token, for forwarding to our proxy
 * (which verifies it server-side via GetWhoami). Returns '' if unavailable so
 * callers stay simple; the proxy then rejects in production posture.
 */
export function accessToken(at: Authed): string {
  try {
    return at.exportTokens().accessToken ?? '';
  } catch {
    return '';
  }
}

/** A user's Audiotool project, shaped for the in-app picker. */
export interface ProjectChoice {
  /** `projects/<id>` name. */
  name: string;
  /** Full studio URL (what read/write/watch take). */
  url: string;
  /** Human label for the dropdown. */
  displayName: string;
}

/**
 * List the signed-in user's Audiotool projects so they can PICK one in-app
 * instead of pasting a studio URL (the main "don't jiggle to Audiotool" fix).
 */
export async function listProjects(at: Authed): Promise<ProjectChoice[]> {
  const res = (await at.projects.listProjects({})) as {
    projects?: Array<{ name?: string; displayName?: string }>;
  };
  return (res.projects ?? [])
    .filter((p): p is { name: string; displayName?: string } => Boolean(p.name))
    .map((p) => ({
      name: p.name,
      url: p.name.replace('projects/', 'https://beta.audiotool.com/studio?project='),
      displayName: p.displayName?.trim() || `Untitled (${p.name.replace('projects/', '').slice(0, 8)})`,
    }));
}

/** Bare project id from a studio URL / `projects/<id>` name. */
function extractProjectId(ref: string): string {
  return ref.match(/[?&]project=([^&]+)/)?.[1] ?? ref.replace(/^projects\//, '');
}

/** Flatten a Nexus entity's typed field bag into a plain `{ name: value }` map. */
function flattenFields(fields: unknown): Record<string, unknown> | undefined {
  if (!fields || typeof fields !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields as Record<string, unknown>)) {
    try {
      if (field && typeof field === 'object' && 'value' in (field as object)) {
        out[key] = (field as { value: unknown }).value;
      } else if (field && typeof field === 'object' && 'fields' in (field as object)) {
        // Nested sub-message (e.g. a noteRegion's `region`) — exposed as
        // `{ fields, location }` with no `.value`. Recurse so its data survives.
        out[key] = flattenFields((field as { fields: unknown }).fields);
      } else if (['number', 'string', 'boolean'].includes(typeof field)) {
        out[key] = field;
      }
    } catch {
      // Skip fields whose getters throw (unsynced references, etc.).
    }
  }
  return out;
}

/**
 * Read a live project's entity snapshot, ready to POST to the backend.
 * @param at         Authenticated client.
 * @param projectUrl Studio URL or project name.
 */
export async function readProject(at: Authed, projectUrl: string): Promise<RawNexusProject> {
  const nexus = await at.open(projectUrl);
  try {
    await nexus.start();
    const entities = nexus.queryEntities.get();
    return {
      projectId: extractProjectId(projectUrl),
      projectUrl: projectUrl.startsWith('http') ? projectUrl : undefined,
      entities: entities.map((e) => ({
        entityType: e.entityType,
        id: e.id,
        fields: flattenFields((e as { fields?: unknown }).fields),
      })),
    };
  } finally {
    await nexus.stop().catch(() => {});
  }
}

/**
 * Write campaign markers back into the live session (06 + reinforces 05).
 * Lays them out as named note regions on a dedicated "Sigmora Campaign" track,
 * positioned at each marker's timestamp. Uses only entity types proven by the
 * SDK's write-melody example.
 *
 * @param tempo BPM used to convert seconds → ticks (defaults to 120).
 */
export async function writeCampaignMarkers(
  at: Authed,
  projectUrl: string,
  markers: CampaignMarker[],
  tempo = 120,
): Promise<number> {
  if (markers.length === 0) return 0;
  const nexus = await at.open(projectUrl);
  await nexus.start();
  try {
    await nexus.modify((t) => {
      // A note track needs a note-consuming player device.
      const player = t.create('pulverisateur', {
        displayName: 'Sigmora Campaign',
        positionX: 120,
        positionY: 480,
      });
      const track = t.create('noteTrack', {
        player: player.location,
        orderAmongTracks: 5000 + Math.floor(secondsToTicks(markers[0]!.atSec, tempo) % 1000),
      });
      for (const marker of markers) {
        const collection = t.create('noteCollection', {});
        t.create('noteRegion', {
          collection: collection.location,
          track: track.location,
          region: {
            positionTicks: Math.max(0, Math.floor(secondsToTicks(marker.atSec, tempo))),
            durationTicks: Ticks.Beat,
            loopDurationTicks: Ticks.Beat,
            loopOffsetTicks: 0,
            collectionOffsetTicks: 0,
            colorIndex: 5,
            displayName: marker.label,
            isEnabled: true,
          },
        });
      }
    });
    return markers.length;
  } finally {
    await nexus.stop().catch(() => {});
  }
}

/**
 * Subscribe to live changes in a session (category 05 — bidirectional + reactive).
 *
 * Proves the bridge is two-way and live: as the artist edits the project, the
 * campaign can react. We surface entity-create events to the caller, which lets
 * the demo show "the bridge is live" (e.g. re-offer a regenerate when the track
 * changes). Returns an async unsubscribe that also stops the document.
 *
 * The SDK's event surface is pre-1.0; we bind defensively so a missing/renamed
 * `events.onCreate` degrades to a no-op subscription rather than throwing.
 */
export async function watchSession(
  at: Authed,
  projectUrl: string,
  onChange: (event: { kind: 'create' | 'update' | 'remove'; entityType?: string; id?: string }) => void,
): Promise<() => Promise<void>> {
  const nexus = await at.open(projectUrl);
  await nexus.start();

  // Subscribe to creation of every entity type ("*"). The onCreate callback may
  // RETURN a cleanup fn that the SDK runs when that entity is removed — so this
  // single subscription yields both create AND remove signals.
  const subscription = nexus.events.onCreate('*', (entity) => {
    const e = entity as { entityType?: string; id?: string; fields?: Record<string, unknown> };
    onChange({ kind: 'create', entityType: e.entityType, id: e.id });

    // Best-effort: catch renames by watching the entity's mutable name field.
    // The SDK is pre-1.0; if a field isn't subscribable this degrades silently
    // and the create/remove signals still fire.
    try {
      const nameField = e.fields?.displayName ?? e.fields?.name;
      if (nameField) {
        nexus.events.onUpdate(nameField as never, () => {
          onChange({ kind: 'update', entityType: e.entityType, id: e.id });
        });
      }
    } catch {
      // No per-field update tracking for this entity — that's fine.
    }

    return () => onChange({ kind: 'remove', entityType: e.entityType, id: e.id });
  });

  return async () => {
    try {
      subscription.terminate();
    } finally {
      await nexus.stop().catch(() => {});
    }
  };
}

/**
 * Seed a brand-new Audiotool project from a song concept (category 01).
 * Creates the project, lays a named region per section, AND seeds a short
 * pentatonic phrase in each so the artist opens to a *playable idea* — first
 * sound, not a blank page.
 *
 * @returns The new project's studio URL.
 */
export async function seedConcept(at: Authed, concept: SongConcept): Promise<string> {
  // 1) Create the project (proven by the SDK's create-project example).
  const created = await at.projects.createProject({ project: { displayName: concept.title } });
  if (created instanceof Error) throw new Error(`createProject failed: ${created.message}`);
  const name = created.project?.name;
  if (!name) throw new Error('createProject returned no project name');
  const url = name.replace('projects/', 'https://beta.audiotool.com/studio?project=');

  // 2) Open it and lay down one named region per concept section.
  const sections = concept.sections.length ? concept.sections : ['Intro', 'Verse', 'Hook', 'Outro'];
  const nexus = await at.open(url);
  await nexus.start();
  try {
    await nexus.modify((t) => {
      const player = t.create('pulverisateur', {
        displayName: 'Sigmora Seed',
        positionX: 120,
        positionY: 240,
      });
      const track = t.create('noteTrack', { player: player.location, orderAmongTracks: 1000 });
      const barTicks = Ticks.Bars(4); // 4-bar blocks, tempo-independent.

      // Write the audience-derived concept INTO the session as a named region on
      // its own track, so the artist opens to the idea (mood/theme/hook/tempo) —
      // not just a playable-but-anonymous project. Uses the proven displayName
      // region pattern. The transport tempo is also surfaced in this label as a
      // human-readable FALLBACK; the real transport-tempo write happens in a
      // separate guarded step below (setTransportTempo) so that if it fails
      // against live beta, this label still carries the BPM.
      const conceptPlayer = t.create('pulverisateur', {
        displayName: 'Sigmora Concept',
        positionX: 120,
        positionY: 120,
      });
      const conceptTrack = t.create('noteTrack', {
        player: conceptPlayer.location,
        orderAmongTracks: 500,
      });
      const conceptCollection = t.create('noteCollection', {});
      const conceptSpanTicks = barTicks * Math.max(1, sections.length);
      t.create('noteRegion', {
        collection: conceptCollection.location,
        track: conceptTrack.location,
        region: {
          positionTicks: 0,
          durationTicks: conceptSpanTicks,
          loopDurationTicks: conceptSpanTicks,
          loopOffsetTicks: 0,
          collectionOffsetTicks: 0,
          colorIndex: 7,
          displayName: `Concept: ${concept.mood} / ${concept.theme} - ${concept.tempo} BPM - Hook: ${concept.hookIdea}`,
          isEnabled: true,
        },
      });

      // Minor-pentatonic offsets (semitones), root A3 — pleasant in any context.
      const PENTA = [0, 3, 5, 7, 10];
      const stepTicks = Ticks.Beat * 2; // a note every 2 beats → 8 over 4 bars
      sections.forEach((section, index) => {
        const collection = t.create('noteCollection', {});
        t.create('noteRegion', {
          collection: collection.location,
          track: track.location,
          region: {
            positionTicks: index * barTicks,
            durationTicks: barTicks,
            loopDurationTicks: barTicks,
            loopOffsetTicks: 0,
            collectionOffsetTicks: 0,
            colorIndex: (index % 8) + 1,
            displayName: section,
            isEnabled: true,
          },
        });
        // Seed a short pentatonic phrase so the project PLAYS on open (first
        // sound). velocity is normalized [0,1] — verified live against beta.
        for (let i = 0; i < 8; i++) {
          const pitch = 57 + PENTA[(i + index) % PENTA.length]! + (Math.floor(i / PENTA.length) % 2) * 12;
          t.create('note', {
            collection: collection.location,
            positionTicks: i * stepTicks,
            durationTicks: Math.floor(stepTicks * 0.8),
            pitch,
            velocity: 0.8,
          });
        }
      });
    });
    // The seed succeeded. Now set the actual transport tempo in a SEPARATE,
    // guarded transaction so that — if the SDK's config-update shape is wrong
    // against live beta — the seed above still stands (degrade, don't throw).
    // The concept-note label already carries the BPM as a fallback.
    await setTransportTempo(nexus, concept.tempo);
  } finally {
    await nexus.stop().catch(() => {});
  }
  return url;
}

/**
 * Best-effort: set the live project's transport tempo (BPM) to `bpm`.
 *
 * Audiotool stores the project tempo as `tempoBpm` on the singleton `config`
 * entity (verified against the installed SDK's generated types,
 * gen/.../entity/config/v1/config_nexus.d.ts: `tempoBpm: PrimitiveField<number,
 * "mut">`, default 125, valid range [30, 1000]). The transaction builder exposes
 * `t.update(field, value)` for mutable primitive fields and `t.entities` to query
 * the live document, so the supported write is:
 *   const config = t.entities.ofTypes('config').getOne()
 *   t.update(config.fields.tempoBpm, bpm)
 *
 * A freshly created project has NO config (the engine shows a default tempo of
 * 120 until one exists), so to make the studio open at the concept's BPM we must
 * CREATE the config, not skip. `config.defaultGroove` is a Pointer; we point it
 * at an existing groove if the project has one, else create the config bare.
 * Two guarded transactions (update-existing, then create-if-absent), each wrapped
 * so any SDK-shape drift degrades to a no-op rather than failing the seed (which
 * already committed; the BPM also rides in the concept-note label as a fallback).
 */
async function setTransportTempo(nexus: Awaited<ReturnType<Authed['open']>>, bpm: number): Promise<void> {
  if (!Number.isFinite(bpm) || bpm <= 0) return;
  // Clamp into the engine's documented [30, 1000] range so an out-of-range
  // audience-derived BPM can't make the write throw.
  const tempo = Math.min(1000, Math.max(30, Math.round(bpm)));

  // 1) Update an existing config (re-seeds / projects that already have one).
  try {
    let updated = false;
    await nexus.modify((t) => {
      const config = t.entities.ofTypes('config').getOne();
      if (!config) return;
      t.update(config.fields.tempoBpm, tempo);
      updated = true;
    });
    if (updated) return;
  } catch {
    // fall through to create
  }

  // 2) No config yet (fresh project): create one so the transport tempo sticks.
  //    Point default_groove at an existing groove if the project has one.
  try {
    await nexus.modify((t) => {
      if (t.entities.ofTypes('config').getOne()) return;
      // A config REQUIRES a defaultGroove pointer; reuse the project's groove if
      // it has one, else create a default groove (all its fields are optional).
      const groove = t.entities.ofTypes('groove').getOne() ?? t.create('groove', {});
      t.create('config', { tempoBpm: tempo, defaultGroove: groove.location });
    });
  } catch {
    // Live beta rejected the config create (required immutable field / shape
    // drift / permissions). The seed already stands and the BPM is in the
    // concept-note label, so degrade silently rather than failing the seed.
  }
}
