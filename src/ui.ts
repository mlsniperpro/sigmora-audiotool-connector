/** Tiny DOM helpers — no framework, keeps the demo dependency-light. */

import type { ReleaseKit, SongConcept, VoiceSketch } from './types.js';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}

export function mount(selector: string, ...nodes: (Node | string)[]): HTMLElement {
  const host = document.querySelector<HTMLElement>(selector);
  if (!host) throw new Error(`No element matches ${selector}`);
  host.replaceChildren(...nodes.map((n) => (typeof n === 'string' ? document.createTextNode(n) : n)));
  return host;
}

export function show(selector: string): void {
  document.querySelector(selector)?.classList.remove('hidden');
}

const logEl = () => document.querySelector<HTMLPreElement>('#log');

export function logLine(message: string): void {
  const node = logEl();
  if (!node) return;
  node.textContent = `${node.textContent ?? ''}${message}\n`;
  node.scrollTop = node.scrollHeight;
}

export function logError(error: unknown): void {
  logLine(`✖ ${error instanceof Error ? error.message : String(error)}`);
}

/** Put a button into a busy/spinner state; returns a restore function. */
export function busyOn(button: HTMLButtonElement, busyLabel: string): () => void {
  const original = button.textContent;
  button.disabled = true;
  button.classList.add('busy');
  button.textContent = busyLabel;
  return () => {
    button.disabled = false;
    button.classList.remove('busy');
    button.textContent = original;
  };
}

/** Run an async action while showing a spinner + label on its button. */
export async function withBusy(
  button: HTMLButtonElement,
  busyLabel: string,
  fn: () => unknown,
): Promise<void> {
  const restore = busyOn(button, busyLabel);
  try {
    await fn();
  } finally {
    restore();
  }
}

/** Pretty label for an ElevenLabs product id. */
const EL_PRODUCT_LABELS: Record<string, string> = {
  tts: 'Text-to-Speech',
  'voice-clone': 'Voice Cloning',
  dubbing: 'Dubbing',
  'sound-effects': 'Sound Effects',
  music: 'Music v2',
  'audio-isolation': 'Audio Isolation',
  'voice-changer': 'Voice Changer',
};

/** A native audio player for an inline data URL — lets users HEAR results in-app. */
function audioEl(url: string): HTMLAudioElement {
  return el('audio', { controls: true, src: url, preload: 'none', className: 'player' });
}

/** A native video player for an inline data URL — watch the trailer in-app. */
function videoEl(url: string): HTMLVideoElement {
  return el('video', { controls: true, src: url, preload: 'none', className: 'player video' });
}

/** Render the release kit into a card. `onPreSave` wires the support CTA. */
export function renderReleaseKit(kit: ReleaseKit, onPreSave?: () => void): HTMLElement {
  const { track, voiceover } = kit;
  const sections: HTMLElement[] = [
    el('h3', {}, [`Release kit — ${track.title}`]),
    el('p', { className: 'meta' }, [
      `${track.tempo ? `${track.tempo} BPM · ` : ''}${track.durationSec ? `${track.durationSec}s · ` : ''}` +
        `${track.devices.length} instruments · ${track.sections.length} sections`,
    ]),
  ];

  // "Built with ElevenLabs" — the special-award lever, made explicit.
  if (kit.elevenLabsProducts.length) {
    sections.push(
      el('h4', {}, ['Built with ElevenLabs']),
      el(
        'div',
        { className: 'el-products' },
        kit.elevenLabsProducts.map((p) =>
          el('span', { className: 'badge el' }, [EL_PRODUCT_LABELS[p] ?? p]),
        ),
      ),
    );
  }

  sections.push(
    el('h4', {}, ['Announcement']),
    el('p', {}, [kit.releaseCopy || '—']),
    el('h4', {}, [voiceover.viaVoiceClone ? 'Voiceover (your voice — ElevenLabs clone)' : 'Voiceover (ElevenLabs)']),
    el('p', { className: 'quote' }, [voiceover.script || '—']),
    el('p', { className: 'meta' }, [
      voiceover.synthesized
        ? `✓ synthesized via ${voiceover.provider}${voiceover.viaVoiceClone ? ' (voice-clone)' : ''}`
        : `script only (provider: ${voiceover.provider})`,
    ]),
  );
  if (voiceover.audioUrl) sections.push(audioEl(voiceover.audioUrl));

  // Dubbing — global reach.
  if (kit.dubs.length) {
    sections.push(
      el('h4', {}, [`Dubbed into ${kit.dubs.length} language(s)`]),
      el(
        'ul',
        {},
        kit.dubs.map((d) =>
          el('li', {}, [
            `${d.language}${d.text ? `: “${d.text}”` : ''}`,
            ...(d.audioUrl ? [audioEl(d.audioUrl)] : []),
          ]),
        ),
      ),
    );
  }

  // Promo sound effects.
  if (kit.soundEffects.length) {
    sections.push(
      el('h4', {}, ['Promo sound effects']),
      el(
        'ul',
        {},
        kit.soundEffects.map((s) =>
          el('li', {}, [
            `${s.prompt}${s.audioUrl || s.audioPath ? '' : ' — prompt only'}`,
            ...(s.audioUrl ? [audioEl(s.audioUrl)] : []),
          ]),
        ),
      ),
    );
  }

  // Instrumental promo bed (Music v2) — the music UNDER the trailer, not the release.
  if (kit.promoBed) {
    sections.push(
      el('h4', {}, ['Promo bed (instrumental · ElevenLabs Music v2)']),
      el('p', { className: 'meta' }, [
        kit.promoBed.audioUrl || kit.promoBed.audioPath
          ? '✓ generated'
          : `skipped — ${kit.promoBed.skippedReason ?? 'unavailable'}`,
      ]),
    );
    if (kit.promoBed.audioUrl) sections.push(audioEl(kit.promoBed.audioUrl));
  }

  // Teaser cut (optional) — watch the trailer in-app.
  if (kit.socialCut) {
    sections.push(
      el('h4', {}, ['Teaser cut']),
      el('p', { className: 'meta' }, [
        kit.socialCut.videoUrl || kit.socialCut.videoPath
          ? '✓ rendered'
          : `skipped — ${kit.socialCut.skippedReason ?? 'unavailable'}`,
      ]),
    );
    if (kit.socialCut.videoUrl) sections.push(videoEl(kit.socialCut.videoUrl));
  }

  sections.push(
    el('h4', {}, ['Platform captions']),
    el(
      'div',
      { className: 'platforms' },
      kit.platformCopy.map((p) =>
        el('div', { className: 'platform' }, [
          el('strong', {}, [p.platform]),
          el('p', {}, [p.caption]),
          el('p', { className: 'tags' }, [p.hashtags.join(' ')]),
        ]),
      ),
    ),
    el('h4', {}, ['Release plan']),
    el('ul', {}, kit.releasePlan.map((step) => el('li', {}, [step]))),
  );

  // Pre-save / fan-support offer — the "monetised" half of category 06.
  const presaveBtn = el('button', { className: 'primary presave-cta' }, [
    `${kit.preSave.ctaLabel} · $${kit.preSave.suggestedAmountUsd}`,
  ]);
  presaveBtn.onclick = () => withBusy(presaveBtn, 'Minting…', () => onPreSave?.());
  sections.push(
    el('h4', {}, ['Fan support / pre-save']),
    el('div', { className: 'presave' }, [
      el('strong', {}, [kit.preSave.title]),
      el('p', {}, [kit.preSave.blurb]),
      presaveBtn,
    ]),
  );

  sections.push(
    el('h4', {}, ['Campaign markers (written back to your session)']),
    el(
      'ul',
      {},
      kit.campaignMarkers.map((m) => el('li', {}, [`@ ${Math.round(m.atSec)}s — ${m.label}`])),
    ),
  );

  return el('div', { className: 'kit' }, sections);
}

/**
 * Render selectable song concepts. `onSeed` seeds the concept into Audiotool;
 * `onSketch` (when provided — i.e. a voice identity is set) offers a short
 * "sketch in your voice" preview per concept.
 */
export function renderConcepts(
  concepts: SongConcept[],
  onSeed: (concept: SongConcept) => void,
  onSketch?: (concept: SongConcept) => void,
): HTMLElement {
  return el(
    'div',
    { className: 'concepts' },
    concepts.map((c) => {
      const seedBtn = el('button', { className: 'seed' }, ['Seed into Audiotool →']);
      seedBtn.onclick = () => withBusy(seedBtn, 'Seeding…', () => onSeed(c));
      const children: HTMLElement[] = [
        el('h4', {}, [c.title]),
        el('p', { className: 'meta' }, [`${c.mood} · ${c.tempo} BPM`]),
        el('p', {}, [c.theme]),
        el('p', { className: 'quote' }, [c.hookIdea]),
        el('p', { className: 'tags' }, [c.sections.join(' → ')]),
        seedBtn,
      ];
      if (onSketch) {
        const sketchBtn = el('button', { className: 'ghost sketch' }, ['▷ 15s sketch in your voice']);
        sketchBtn.onclick = () => withBusy(sketchBtn, 'Sketching…', () => onSketch(c));
        children.push(sketchBtn);
      }
      return el('div', { className: 'concept' }, children);
    }),
  );
}

/** Render a voice-sketch result — a labeled starting point, never a release. */
export function renderSketch(sketch: VoiceSketch): HTMLElement {
  const playUrl = sketch.mixedSketchUrl ?? sketch.voiceSketchUrl ?? sketch.musicClipUrl;
  return el('div', { className: 'sketch' }, [
    el('p', { className: 'meta' }, [sketch.note]),
    el(
      'div',
      { className: 'el-products' },
      sketch.elevenLabsProducts.map((p) =>
        el('span', { className: 'badge el' }, [EL_PRODUCT_LABELS[p] ?? p]),
      ),
    ),
    el('p', { className: 'meta' }, [
      sketch.mixedSketchPath
        ? '✓ mixed sketch — your voice over a bed'
        : sketch.voiceSketchPath
          ? '✓ sketch in your voice'
          : sketch.musicClipPath
            ? 'music idea ready — voice step degraded'
            : 'sketch unavailable',
    ]),
    ...(playUrl ? [audioEl(playUrl)] : []),
    ...(sketch.skipped?.length
      ? [el('p', { className: 'meta' }, [`degraded: ${sketch.skipped.join('; ')}`])]
      : []),
  ]);
}
