import { summarizeTranscriptLatencies, type TranscriptLatencySummarySet } from './latency-metrics.js';
import type { TranscriptLatencySample, TranscriptionPipelineEvent } from './types.js';

export interface TranscriptLatencyWindowOptions {
  readonly capacity?: number | undefined;
}

/**
 * Keeps only the most recent latency samples so production metrics stay bounded.
 * The default capacity is intentionally small enough for desktop sessions while
 * still providing stable p50/p95 summaries over recent transcription behavior.
 */
export class TranscriptLatencyWindow {
  readonly #capacity: number;
  readonly #samples: TranscriptLatencySample[] = [];

  constructor(options: TranscriptLatencyWindowOptions = {}) {
    const capacity = options.capacity ?? 512;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Transcript latency window capacity must be a positive integer.');
    }
    this.#capacity = capacity;
  }

  get capacity(): number {
    return this.#capacity;
  }

  get size(): number {
    return this.#samples.length;
  }

  record(sample: TranscriptLatencySample): void {
    this.#samples.push(sample);
    const overflow = this.#samples.length - this.#capacity;
    if (overflow > 0) {
      this.#samples.splice(0, overflow);
    }
  }

  recordEvent(event: TranscriptionPipelineEvent): void {
    if (event.type === 'transcript') {
      this.record(event.latency);
    }
  }

  summarize(): TranscriptLatencySummarySet {
    return summarizeTranscriptLatencies(this.#samples);
  }

  clear(): void {
    this.#samples.length = 0;
  }
}
