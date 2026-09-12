import type { DetectedQuestion, TranscriptSegment } from '@companion-ai/contracts';
import type { TranscriptionPipelineEvent } from '@companion-ai/transcription';

import {
  defaultQuestionDetectionConfig,
  detectQuestion,
  type QuestionDetectionConfig,
} from './question-detector.js';

export interface QuestionStreamConfig {
  readonly detection: QuestionDetectionConfig;
  readonly duplicateWindowMs: number;
  readonly rephraseSimilarityThreshold: number;
}

export interface QuestionStreamDependencies {
  readonly now: () => number;
  readonly createQuestionId: (segment: TranscriptSegment) => string;
}

interface SeenQuestion {
  readonly normalized: string;
  readonly contentTokens: ReadonlySet<string>;
  readonly detectedAtMs: number;
}

export const defaultQuestionStreamConfig: QuestionStreamConfig = {
  detection: defaultQuestionDetectionConfig,
  duplicateWindowMs: 120_000,
  rephraseSimilarityThreshold: 0.72,
};

const stopWords = new Set([
  'a', 'about', 'an', 'and', 'are', 'can', 'could', 'did', 'do', 'does', 'explain',
  'give', 'how', 'i', 'is', 'me', 'please', 'tell', 'the', 'to', 'walk', 'what',
  'when', 'where', 'which', 'who', 'why', 'will', 'would', 'you', 'your',
  'comment', 'décris', 'decris', 'donne', 'est', 'explique', 'moi', 'parle', 'peux',
  'pourquoi', 'pourrais', 'pourriez', 'pouvez', 'que', 'quel', 'quelle', 'quelles',
  'quels', 'tu', 'un', 'une', 'vous',
]);

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stem(token: string): string {
  if (token.length <= 4) return token;
  return token.replace(/(?:ing|ed|es|s|e)$/u, '');
}

function contentTokens(value: string): ReadonlySet<string> {
  return new Set(
    normalize(value)
      .split(' ')
      .filter((token) => token.length > 1 && !stopWords.has(token))
      .map(stem),
  );
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  return intersection / (left.size + right.size - intersection);
}

/**
 * Converts finalized remote transcript segments into de-duplicated questions.
 * Local microphone transcripts are intentionally ignored: suggestions should be
 * triggered by the interviewer, never by the user's own answer.
 */
export class QuestionStream {
  readonly #config: QuestionStreamConfig;
  readonly #dependencies: QuestionStreamDependencies;
  #seen: SeenQuestion[] = [];
  #sessionId: string | undefined;

  constructor(
    config: Partial<QuestionStreamConfig> = {},
    dependencies: Partial<QuestionStreamDependencies> = {},
  ) {
    this.#config = {
      detection: config.detection ?? defaultQuestionStreamConfig.detection,
      duplicateWindowMs:
        config.duplicateWindowMs ?? defaultQuestionStreamConfig.duplicateWindowMs,
      rephraseSimilarityThreshold:
        config.rephraseSimilarityThreshold ??
        defaultQuestionStreamConfig.rephraseSimilarityThreshold,
    };
    this.#dependencies = {
      now: dependencies.now ?? Date.now,
      createQuestionId:
        dependencies.createQuestionId ??
        ((segment) => `question:${segment.sessionId}:${segment.id}`),
    };
  }

  process(event: TranscriptionPipelineEvent): DetectedQuestion | undefined {
    if (event.type !== 'transcript') return undefined;

    const { segment } = event;
    if (segment.source !== 'remote' || !segment.isFinal) return undefined;

    if (this.#sessionId !== segment.sessionId) {
      this.#seen = [];
      this.#sessionId = segment.sessionId;
    }

    const text = segment.text.trim();
    if (!text) return undefined;

    const detection = detectQuestion(text, this.#config.detection);
    if (!detection.isQuestion) return undefined;

    const detectedAtMs = this.#dependencies.now();
    const normalized = normalize(text);
    const tokens = contentTokens(text);
    const oldestAllowed = detectedAtMs - this.#config.duplicateWindowMs;
    this.#seen = this.#seen.filter((item) => item.detectedAtMs >= oldestAllowed);

    const duplicate = this.#seen.some(
      (item) =>
        item.normalized === normalized ||
        jaccard(item.contentTokens, tokens) >= this.#config.rephraseSimilarityThreshold,
    );
    if (duplicate) return undefined;

    this.#seen.push({ normalized, contentTokens: tokens, detectedAtMs });

    return {
      id: this.#dependencies.createQuestionId(segment),
      sessionId: segment.sessionId,
      transcriptSegmentIds: [segment.id],
      text,
      kind: detection.kind,
      confidence: detection.confidence,
      detectedAtMs,
    };
  }

  reset(): void {
    this.#seen = [];
    this.#sessionId = undefined;
  }
}
