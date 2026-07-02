/**
 * Shapes mirrored from the backend (`services/content-autopilot`
 * `src/services/audiotool-content/types.ts`). Kept in sync by hand — this is
 * the wire contract between the browser plane and the generation backend.
 */

export interface RawNexusEntity {
  entityType: string;
  id: string;
  fields?: Record<string, unknown>;
}

export interface RawNexusProject {
  projectId: string;
  projectUrl?: string;
  displayName?: string;
  tempo?: number;
  durationSec?: number;
  entities: RawNexusEntity[];
}

export interface PlatformCopy {
  platform: string;
  caption: string;
  hashtags: string[];
}

export interface CampaignMarker {
  atSec: number;
  label: string;
}

export interface AudiotoolTrack {
  projectId: string;
  projectUrl?: string;
  title: string;
  tempo?: number;
  durationSec?: number;
  sections: Array<{ name: string; startSec?: number; durationSec?: number }>;
  devices: Array<{ type: string; count: number }>;
  rawMeta: { entityCount: number; entityTypeCounts: Record<string, number> };
}

export interface VoiceoverDub {
  language: string;
  audioPath?: string;
  audioUrl?: string;
  text?: string;
  provider: string;
}

export interface SoundEffectAsset {
  prompt: string;
  audioPath?: string;
  audioUrl?: string;
}

export interface PreSaveOffer {
  title: string;
  blurb: string;
  suggestedAmountUsd: number;
  ctaLabel: string;
}

export interface SocialCut {
  videoPath?: string;
  videoUrl?: string;
  skippedReason?: string;
}

/** Instrumental trailer bed (ElevenLabs Music v2) — never the release track. */
export interface PromoBed {
  prompt: string;
  audioPath?: string;
  audioUrl?: string;
  skippedReason?: string;
}

export interface ReleaseKit {
  track: AudiotoolTrack;
  releaseCopy: string;
  platformCopy: PlatformCopy[];
  releasePlan: string[];
  voiceover: {
    script: string;
    audioPath?: string;
    audioUrl?: string;
    provider: string;
    synthesized: boolean;
    viaVoiceClone: boolean;
  };
  dubs: VoiceoverDub[];
  soundEffects: SoundEffectAsset[];
  promoBed?: PromoBed;
  preSave: PreSaveOffer;
  socialCut?: SocialCut;
  campaignMarkers: CampaignMarker[];
  elevenLabsProducts: string[];
}

export interface SongConcept {
  title: string;
  mood: string;
  theme: string;
  tempo: number;
  hookIdea: string;
  sections: string[];
}

/**
 * A short "sketch in your voice" (ElevenLabs Music v2 → Audio Isolation → Voice
 * Changer). A labeled STARTING POINT — the real track is made in Audiotool.
 */
export interface VoiceSketch {
  isSketch: true;
  concept: SongConcept;
  musicClipPath?: string;
  voiceSketchPath?: string;
  mixedSketchPath?: string;
  musicClipUrl?: string;
  voiceSketchUrl?: string;
  mixedSketchUrl?: string;
  elevenLabsProducts: string[];
  note: string;
  skipped?: string[];
}

/** Structured audience profile (mirrors backend) — drives data-backed ideation. */
export interface AudienceProfile {
  primaryAgeGroup?: string;
  primaryCountry?: string;
  topInterests?: string[];
  trafficSources?: string[];
  engagementRatePct?: number;
  notes?: string;
}
