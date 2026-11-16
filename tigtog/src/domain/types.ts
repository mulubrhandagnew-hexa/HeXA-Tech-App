/**
 * Tigtog domain records. These are the shapes persisted to storage.
 * Timestamps are ISO-8601 strings; ids are opaque strings.
 */

export interface User {
  id: string;
  username: string; // lowercase, unique
  displayName: string;
  bio: string;
  passwordHash: string; // "scrypt$<salt>$<hash>"
  createdAt: string;
}

export interface Session {
  /** SHA-256 of the bearer token; the raw token is never stored. */
  tokenHash: string;
  userId: string;
  createdAt: string;
}

export interface Media {
  id: string;
  ownerId: string;
  fileName: string; // stored file name inside the media directory
  contentType: string;
  size: number;
  createdAt: string;
}

/** Content language: Tigrinya, Amharic, or anything else. */
export type Language = "ti" | "am" | "other";
export const LANGUAGES: Language[] = ["ti", "am", "other"];

/** What the post is: a regular video, or music made/shared as a video. */
export type PostKind = "video" | "music";
export const POST_KINDS: PostKind[] = ["video", "music"];

export interface Post {
  id: string;
  authorId: string;
  caption: string;
  language: Language;
  kind: PostKind;
  hashtags: string[];
  mediaId: string;
  views: number;
  createdAt: string;
}

export interface Like {
  postId: string;
  userId: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  text: string;
  createdAt: string;
}

export interface Follow {
  followerId: string;
  followeeId: string;
  createdAt: string;
}

// ------------------------------------------------------------ voice dataset

/** Bump when the consent text changes; older consents must be renewed. */
export const VOICE_CONSENT_VERSION = 1;

/** A singer's explicit agreement to have their recordings used for training. */
export interface VoiceConsent {
  userId: string;
  version: number;
  givenAt: string;
}

/** A private audio file uploaded for the voice dataset (never served publicly). */
export interface VoiceAudio {
  id: string;
  ownerId: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

/** One guide note the singer followed, timed from the start of the audio. */
export interface VoiceNote {
  syllable: string;
  midi: number;
  start: number; // seconds
  dur: number; // seconds
}

export interface VoiceSample {
  id: string;
  userId: string;
  audioId: string;
  promptId: string;
  kind: "sweep" | "line";
  language: "ti" | "am";
  text: string;
  phonemes: string; // from public/g2p.js, words separated by " | "
  notes: VoiceNote[];
  bpm: number;
  cents: number; // tuning offset of the guide from A440
  durationSec: number;
  consentVersion: number;
  createdAt: string;
}

export interface TigtogState {
  users: User[];
  sessions: Session[];
  media: Media[];
  posts: Post[];
  likes: Like[];
  comments: Comment[];
  follows: Follow[];
  voiceConsents: VoiceConsent[];
  voiceAudio: VoiceAudio[];
  voiceSamples: VoiceSample[];
}

export function emptyState(): TigtogState {
  return {
    users: [], sessions: [], media: [], posts: [], likes: [], comments: [], follows: [],
    voiceConsents: [], voiceAudio: [], voiceSamples: [],
  };
}

/** Public view of a user — never exposes the password hash. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  createdAt: string;
  followers: number;
  following: number;
  posts: number;
}

/** A post as rendered in a feed, with author and engagement counts. */
export interface FeedPost {
  id: string;
  caption: string;
  language: Language;
  kind: PostKind;
  hashtags: string[];
  mediaUrl: string;
  contentType: string;
  views: number;
  likes: number;
  comments: number;
  likedByMe: boolean;
  createdAt: string;
  author: { id: string; username: string; displayName: string; followedByMe: boolean };
}

export class TigtogError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TigtogError";
  }
}
