import { describe, expect, it } from 'vitest';

import type { TranscriptLatencySample } from './types.js';
import { summarizeTranscriptLatencies } from './latency-metrics.js';

function sample(
  lagMs: number,
  options: { readonly isFinal?: boolean; readonly source?: 'local' | 'remote' } = {},
): TranscriptLatencySample {
  return {
    providerId: 'fake',
    sessionId: 'session-1',
    source: options.source ?? 'remote',
    segmentId: `segment-${lagMs}-${options.isFinal ? 'final' : 'partial'}`,
    isFinal: options.isFinal ?? false,
    observedAtMs: 1_000 + lagMs,
    audioEndedAtMs: 1_000,
    lagMs,
  };
}

describe('summarizeTranscriptLatencies', () => {
  it('reports deterministic p50/p95 latency overall and by finality/source', () => {
    const summary = summarizeTranscriptLatencies([
      sample(10, { source: 'local' }),
      sample(20),
      sample(30, { isFinal: true }),
      sample(40, { isFinal: true, source: 'local' }),
      sample(100, { isFinal: true }),
    ]);

    expect(summary.all).toEqual({ count: 5, p50Ms: 30, p95Ms: 100, maxMs: 100, meanMs: 40 });
    expect(summary.partial).toEqual({ count: 2, p50Ms: 10, p95Ms: 20, maxMs: 20, meanMs: 15 });
    expect(summary.final).toEqual({ count: 3, p50Ms: 40, p95Ms: 100, maxMs: 100, meanMs: 170 / 3 });
    expect(summary.local.count).toBe(2);
    expect(summary.remote.count).toBe(3);
  });

  it('returns null metrics for an empty sample set and clamps negative lag', () => {
    expect(summarizeTranscriptLatencies([]).all).toEqual({
      count: 0,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
      meanMs: null,
    });

    expect(summarizeTranscriptLatencies([sample(-5)]).all).toEqual({
      count: 1,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      meanMs: 0,
    });
  });
});
