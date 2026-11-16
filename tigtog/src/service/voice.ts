/**
 * Voice dataset: consented, labelled singing recordings in Tigrinya and
 * Amharic, used to train Tigtog's own singing-voice model.
 *
 * Rules enforced here:
 *  - nothing is accepted without a current consent from the singer;
 *  - recordings are private (the API never serves them publicly);
 *  - a singer can delete any recording, or withdraw consent, which deletes
 *    all of their recordings.
 * Pure in-memory logic; audio bytes are stored by the API layer.
 */
import {
  type VoiceAudio,
  type VoiceConsent,
  type VoiceNote,
  type VoiceSample,
  TigtogError,
  VOICE_CONSENT_VERSION,
} from "../domain/types.js";
import { newId } from "../domain/auth.js";

export interface NewVoiceSample {
  audioId: string;
  promptId: string;
  kind: "sweep" | "line" | "song";
  language: "ti" | "am";
  text: string;
  phonemes: string;
  notes: VoiceNote[];
  rhythm?: string;
  beatStart?: number;
  songSource?: "traditional" | "own";
  bpm: number;
  cents: number;
  durationSec: number;
}

export interface VoiceStats {
  language: "ti" | "am";
  samples: number;
  minutes: number;
  singers: number;
  /** Traditional songs sung from memory (the training priority). */
  songs: number;
}

export class VoiceStore {
  consents = new Map<string, VoiceConsent>(); // userId -> consent
  audio = new Map<string, VoiceAudio>();
  samples = new Map<string, VoiceSample>();

  load(consents: VoiceConsent[], audio: VoiceAudio[], samples: VoiceSample[]): void {
    for (const c of consents) this.consents.set(c.userId, c);
    for (const a of audio) this.audio.set(a.id, a);
    for (const s of samples) this.samples.set(s.id, s);
  }

  getConsent(userId: string): VoiceConsent | undefined {
    return this.consents.get(userId);
  }

  hasCurrentConsent(userId: string): boolean {
    return this.consents.get(userId)?.version === VOICE_CONSENT_VERSION;
  }

  giveConsent(userId: string, version: number): VoiceConsent {
    if (version !== VOICE_CONSENT_VERSION) {
      throw new TigtogError(400, "consent_outdated", "please read and accept the current consent");
    }
    const c: VoiceConsent = { userId, version, givenAt: new Date().toISOString() };
    this.consents.set(userId, c);
    return c;
  }

  /** Withdraw consent: removes the consent and every recording. Returns audio files to delete. */
  withdraw(userId: string): VoiceAudio[] {
    this.consents.delete(userId);
    const files: VoiceAudio[] = [];
    for (const [id, s] of this.samples) if (s.userId === userId) this.samples.delete(id);
    for (const [id, a] of this.audio) {
      if (a.ownerId === userId) {
        files.push(a);
        this.audio.delete(id);
      }
    }
    return files;
  }

  private requireConsent(userId: string): void {
    if (!this.hasCurrentConsent(userId)) {
      throw new TigtogError(403, "consent_required", "accept the voice consent before recording");
    }
  }

  registerAudio(input: Omit<VoiceAudio, "createdAt">): VoiceAudio {
    this.requireConsent(input.ownerId);
    const a: VoiceAudio = { ...input, createdAt: new Date().toISOString() };
    this.audio.set(a.id, a);
    return a;
  }

  addSample(userId: string, input: NewVoiceSample): VoiceSample {
    this.requireConsent(userId);
    const audio = this.audio.get(input.audioId);
    if (!audio || audio.ownerId !== userId) {
      throw new TigtogError(400, "audio_not_found", "upload the recording first");
    }
    for (const s of this.samples.values()) {
      if (s.audioId === audio.id) throw new TigtogError(409, "audio_in_use", "this recording is already saved");
    }
    const sample: VoiceSample = {
      ...input,
      id: newId(),
      userId,
      consentVersion: this.consents.get(userId)!.version,
      createdAt: new Date().toISOString(),
    };
    this.samples.set(sample.id, sample);
    return sample;
  }

  listSamples(userId: string): VoiceSample[] {
    return [...this.samples.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Delete one recording (owner only). Returns the audio file to remove. */
  deleteSample(userId: string, sampleId: string): VoiceAudio | undefined {
    const s = this.samples.get(sampleId);
    if (!s) throw new TigtogError(404, "sample_not_found", "no such recording");
    if (s.userId !== userId) throw new TigtogError(403, "forbidden", "you can only delete your own recordings");
    this.samples.delete(sampleId);
    const a = this.audio.get(s.audioId);
    this.audio.delete(s.audioId);
    return a;
  }

  stats(): VoiceStats[] {
    return (["ti", "am"] as const).map((language) => {
      const list = [...this.samples.values()].filter((s) => s.language === language);
      return {
        language,
        samples: list.length,
        minutes: Math.round((list.reduce((t, s) => t + s.durationSec, 0) / 60) * 10) / 10,
        singers: new Set(list.map((s) => s.userId)).size,
        songs: list.filter((s) => s.kind === "song").length,
      };
    });
  }
}
