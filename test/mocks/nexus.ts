/**
 * Mock of `@audiotool/nexus` for deterministic Playwright runs.
 *
 * Activated via the `MOCK_NEXUS=1` Vite alias (see vite.config.ts) so the
 * served app uses it instead of the real WASM-backed SDK. OAuth auto-succeeds,
 * reads return a small canned session, and writes resolve — letting the e2e
 * test exercise the real UI → backend wiring without a client_id or a browser
 * consent flow.
 */

interface MockEntity {
  entityType: string;
  id: string;
  fields?: Record<string, unknown>;
}

const CANNED_ENTITIES: MockEntity[] = [
  { entityType: 'tonematrix', id: 't1', fields: {} },
  { entityType: 'pulverisateur', id: 'p1', fields: {} },
  {
    // Real Nexus shape (verified live): a noteRegion's `region` is a sub-message
    // exposed as { fields, location } — flattenFields recurses into `.fields`.
    entityType: 'noteRegion',
    id: 'r1',
    fields: {
      region: { fields: { displayName: { value: 'Intro' }, positionTicks: { value: 0 } }, location: {} },
    },
  },
];

// Stateful project list so a seeded project shows up in the picker (per page load).
const MOCK_PROJECTS: Array<{ name: string; displayName: string }> = [
  { name: 'projects/demo', displayName: 'Midnight Drive' },
];

// A mock `config` entity so the transport-tempo write path (seedConcept ->
// setTransportTempo) has something to query + update, mirroring the real SDK
// where tempo lives as `tempoBpm` on the singleton `config` entity.
const MOCK_CONFIG_ENTITY = {
  entityType: 'config',
  id: 'config-1',
  fields: { tempoBpm: { value: 125 } },
};

function makeTransaction() {
  // Each create() returns something with a `.location`, mirroring the real API
  // surface used by nexus.ts (player.location, track.location, …).
  return {
    create: (entityType: string, fields: Record<string, unknown>) => ({
      entityType,
      fields,
      location: { entityType },
    }),
    // Mirrors `t.update(field, value)` — used by setTransportTempo to set tempo.
    update: () => {},
    // Mirrors `t.entities.ofTypes(...).getOne()` — returns the config entity when
    // queried for it, undefined otherwise, so the tempo write path is exercised.
    entities: {
      ofTypes: (...types: string[]) => ({
        getOne: () => (types.includes('config') ? MOCK_CONFIG_ENTITY : undefined),
      }),
    },
  };
}

function makeDocument() {
  return {
    start: async () => {},
    stop: async () => {},
    queryEntities: { get: () => CANNED_ENTITIES },
    modify: async (fn: (t: ReturnType<typeof makeTransaction>) => unknown) => fn(makeTransaction()),
    createTransaction: async () => ({ ...makeTransaction(), send: () => {} }),
    // Reactive surface (cat 05) — mirrors `events.onCreate(entityType, cb): Terminable`.
    // Fires one synthetic create shortly after subscription so the e2e test can
    // observe a live event deterministically.
    events: {
      onCreate: (_entityType: string, cb: (e: unknown) => void) => {
        const timer = setTimeout(() => cb({ entityType: 'tonematrix', id: 'live-1' }), 50);
        return { terminate: () => clearTimeout(timer) };
      },
      // Field-level update subscription (used best-effort for rename detection).
      onUpdate: (_field: unknown, _cb: (v: unknown) => void) => ({ terminate: () => {} }),
    },
  };
}

type AuthedMock = {
  status: 'authenticated';
  userName: string;
  open: (project: string) => Promise<ReturnType<typeof makeDocument>>;
  projects: {
    createProject: (opts: { project: { displayName: string } }) => Promise<{
      project: { name: string; displayName: string };
    }>;
    listProjects: (req: Record<string, unknown>) => Promise<{
      projects: Array<{ name: string; displayName: string }>;
    }>;
  };
  logout: () => void;
  exportTokens: () => Record<string, unknown>;
};

export type BrowserAuthResult =
  | AuthedMock
  | { status: 'unauthenticated'; login: () => void; error?: Error };

export async function audiotool(_opts: {
  clientId: string;
  redirectUrl: string;
  scope: string;
}): Promise<BrowserAuthResult> {
  return {
    status: 'authenticated',
    userName: 'Test Artist',
    open: async () => makeDocument(),
    projects: {
      createProject: async ({ project }) => {
        const created = { name: 'projects/seed-mock-123', displayName: project.displayName };
        MOCK_PROJECTS.push(created); // stateful: a seeded project then appears in the picker
        return { project: created };
      },
      listProjects: async () => ({ projects: MOCK_PROJECTS }),
    },
    logout: () => {},
    exportTokens: () => ({}),
  };
}
