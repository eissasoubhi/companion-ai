import { describe, expect, it } from 'vitest';

import type { TranscriptLatencySample, TranscriptionPipelineEvent } from './types.js';
import { TranscriptLatencyWindow } from './latency-window.js';

function sample(lagMs: number, source: 'local' | 'remote' = 'remote'): TranscriptLatencySample {
  return {
    providerId: 'fake',
    sessionId: 'session-1',
    source,
    segmentId: `segment-${source}-${lagMs}`,
    isFinal: true,
    observedAtMs: 1_000 + lagMs,
    audioEndedAtMs: 1_000,
    lagMs,
  };
}

describe('TranscriptLatencyWindow', () => {
  it('keeps retention bounded by dropping the oldest samples', () => {
    const window = new TranscriptLatencyWindow({ capacity: 3 });

    window.record(sample(10));
    window.record(sample(20));
    window.record(sample(30));
    window.record(sample(100));

    expect(window.size).toBe(3);
    expect(window.summarize().all).toEqual({
      count: 3,
      p50Ms: 30,
      p95Ms: 100,
      maxMs: 100,
      meanMs: 50,
    });
  });

  it('records only transcript pipeline events and preserves local/remote attribution', () => {
    const window = new TranscriptLatencyWindow({ capacity: 4 });
    const transcriptEvent: TranscriptionPipelineEvent = {
      type: 'transcript',
      segment: {
        id: 'segment-local-25',
        sessionId: 'session-1',
        source: 'local',
        text: 'hello',
        isFinal: true,
        startedAtMs: 1_000,
      },
      latency: sample(25, 'local'),
    };
    const readyEvent: TranscriptionPipelineEvent = {
      type: 'provider-ready',
      providerId: 'fake',
      sessionId: 'session-1',
      source: 'remote',
    };

    window.recordEvent(readyEvent);
    window.recordEvent(transcriptEvent);

    expect(window.size).toBe(1);
    expect(window.summarize().local.count).toBe(1);
    expect(window.summarize().remote.count).toBe(0);
  });

  it('rejects invalid capacities and can be cleared', () => {
    expect(() => new TranscriptLatencyWindow({ capacity: 0 })).toThrow(
      'Transcript latency window capacity must be a positive integer.',
    );
    expect(() => new TranscriptLatencyWindow({ capacity: 1.5 })).toThrow(
      'Transcript latency window capacity must be a positive integer.',
    );

    const window = new TranscriptLatencyWindow({ capacity: 2 });
    window.record(sample(15));
    window.clear();

    expect(window.size).toBe(0);
    expect(window.summarize().all.count).toBe(0);
  });
});
