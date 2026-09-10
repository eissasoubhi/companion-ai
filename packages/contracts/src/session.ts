export type AudioSource = 'local' | 'remote' | 'unknown';

export type SessionPhase =
  | 'idle'
  | 'preflight'
  | 'listening'
  | 'degraded'
  | 'ended';

export type QuestionKind =
  | 'general'
  | 'behavioral'
  | 'technical'
  | 'coding'
  | 'system-design'
  | 'recruiter'
  | 'negotiation';

export interface TranscriptSegment {
  readonly id: string;
  readonly sessionId: string;
  readonly source: AudioSource;
  readonly text: string;
  readonly isFinal: boolean;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
}

export interface DetectedQuestion {
  readonly id: string;
  readonly sessionId: string;
  readonly transcriptSegmentIds: readonly string[];
  readonly text: string;
  readonly kind: QuestionKind;
  readonly confidence: number;
  readonly detectedAtMs: number;
}

export type GroundingSourceKind =
  | 'prepared-answer'
  | 'verified-story'
  | 'profile-fact'
  | 'cv'
  | 'document'
  | 'job-description';

export interface GroundingSource {
  readonly id: string;
  readonly kind: GroundingSourceKind;
  readonly label: string;
  readonly score?: number;
}

export type SuggestionLength = 'short' | 'normal' | 'detailed';

export interface AnswerSuggestion {
  readonly id: string;
  readonly sessionId: string;
  readonly questionId: string;
  readonly text: string;
  readonly length: SuggestionLength;
  readonly status: 'streaming' | 'complete' | 'cancelled' | 'failed';
  readonly grounding: readonly GroundingSource[];
  readonly createdAtMs: number;
}

export interface SessionCapabilities {
  readonly microphone: boolean;
  readonly systemAudio: boolean;
  readonly screenCapture: boolean;
  readonly realtimeTranscription: boolean;
}

export interface LiveSessionState {
  readonly id: string;
  readonly phase: SessionPhase;
  readonly capabilities: SessionCapabilities;
}

export function isConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function normalizeQuestionText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function questionFingerprint(value: string): string {
  return normalizeQuestionText(value);
}
