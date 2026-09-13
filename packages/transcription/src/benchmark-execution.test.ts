import { describe, expect, it } from 'vitest';

import {
  executeTranscriptBenchmarkRun,
  type TranscriptBenchmarkAudioFixture,
} from './benchmark-execution.js';
import type { TranscriptBenchmarkCorpusCase } from './benchmark-corpus.js';
import type {
  AudioChunk,
  TranscriptionConnectRequest,
  TranscriptionProvider,
  TranscriptionProviderEventHandler,
} from './types.js';

const corpus = [
  {
    id: 'local-case',
    locale: 'en',
    kind: 'technical',
    reference: 'Explain Symfony',
    keyTerms: ['Symfony'],
    tags: ['technical'],
  },
  {
    id: 'remote-case',
    locale: 'fr',
    kind: 'follow-up',
    reference: 'Et ensuite',
    keyTerms: [],
    tags: ['follow-up'],
  },
] as const satisfies readonly TranscriptBenchmarkCorpusCase[];

function chunk(sequence: number, text: string) {
  return {
    sequence,
    capturedAtMs: 100,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: 'pcm-s16le' as const,
    data: new TextEncoder().encode(text),
  };
}

const fixtures = [
  {
    caseId: 'local-case',
    source: 'local',
    chunks: [chunk(0, 'Explain '), chunk(1, 'Symfony')],
  },
  {
    caseId: 'remote-case',
    source: 'remote',
    chunks: [chunk(0, 'Et ensuite')],
  },
] as const satisfies readonly TranscriptBenchmarkAudioFixture[];

class FinalOnCloseProvider implements TranscriptionProvider {
  readonly id = 'fake:streaming';
  readonly requests: TranscriptionConnectRequest[] = [];
  readonly writes: AudioChunk[] = [];

  async connect(
    request: TranscriptionConnectRequest,
    onEvent: TranscriptionProviderEventHandler,
  ) {
    this.requests.push(request);
    onEvent({ type: 'ready' });
    const parts: string[] = [];

    return {
      write: async (audioChunk: AudioChunk) => {
        this.writes.push(audioChunk);
        parts.push(new TextDecoder().decode(audioChunk.data));
      },
      close: async () => {
        onEvent({
          type: 'transcript',
          segmentId: `segment-${request.source}`,
          text: parts.join(''),
          isFinal: true,
          startedAtMs: 100,
          endedAtMs: 120,
        });
        onEvent({ type: 'closed', reason: 'fixture-complete' });
      },
    };
  }
}

describe('executeTranscriptBenchmarkRun', () => {
  it('streams the same fixture contract through a provider and preserves local/remote attribution', async () => {
    const provider = new FinalOnCloseProvider();

    const result = await executeTranscriptBenchmarkRun(provider, corpus, fixtures, {
      sessionIdPrefix: 'suite-v1',
      clock: () => 150,
    });

    expect(result.providerId).toBe('fake:streaming');
    expect(result.observations.map((item) => item.hypothesis)).toEqual([
      'Explain Symfony',
      'Et ensuite',
    ]);
    expect(result.report.accuracy.wordErrorRate).toBe(0);
    expect(result.report.latency.local.count).toBe(1);
    expect(result.report.latency.remote.count).toBe(1);
    expect(result.report.latency.final.p95Ms).toBe(30);

    expect(provider.requests.map((request) => request.source)).toEqual(['local', 'remote']);
    expect(provider.requests.every((request) => request.partialResults)).toBe(true);
    expect(provider.writes.map((audioChunk) => audioChunk.source)).toEqual([
      'local',
      'local',
      'remote',
    ]);
    expect(provider.writes.map((audioChunk) => audioChunk.sessionId)).toEqual([
      'suite-v1:fake:streaming:local-case',
      'suite-v1:fake:streaming:local-case',
      'suite-v1:fake:streaming:remote-case',
    ]);
  });

  it('paces fixture chunks by capture timestamps and rebases them to the live clock', async () => {
    const provider = new FinalOnCloseProvider();
    let now = 1_000;
    const sleeps: number[] = [];
    const pacedFixture: TranscriptBenchmarkAudioFixture = {
      caseId: 'local-case',
      source: 'local',
      chunks: [
        { ...chunk(0, 'Explain '), capturedAtMs: 100 },
        { ...chunk(1, 'Sym'), capturedAtMs: 150 },
        { ...chunk(2, 'fony'), capturedAtMs: 225 },
      ],
    };

    await executeTranscriptBenchmarkRun(provider, [corpus[0]], [pacedFixture], {
      clock: () => now,
      sleep: async (durationMs) => {
        sleeps.push(durationMs);
        now += durationMs;
      },
    });

    expect(sleeps).toEqual([50, 75]);
    expect(provider.writes.map((audioChunk) => audioChunk.capturedAtMs)).toEqual([
      1_000,
      1_050,
      1_125,
    ]);
  });

  it('fails closed when the provider errors before producing a final transcript', async () => {
    const provider: TranscriptionProvider = {
      id: 'fake:error',
      connect: async (_request, onEvent) => {
        onEvent({ type: 'ready' });
        return {
          write: async () => undefined,
          close: async () => {
            onEvent({
              type: 'error',
              code: 'upstream-unavailable',
              message: 'temporary outage',
              retryable: true,
            });
            onEvent({ type: 'closed' });
          },
        };
      },
    };

    await expect(
      executeTranscriptBenchmarkRun(provider, [corpus[0]], [fixtures[0]], {
        clock: () => 150,
      }),
    ).rejects.toThrow('upstream-unavailable: temporary outage');
  });

  it('fails closed when a provider errors after emitting a final transcript', async () => {
    const provider: TranscriptionProvider = {
      id: 'fake:late-error',
      connect: async (_request, onEvent) => {
        onEvent({ type: 'ready' });
        return {
          write: async () => undefined,
          close: async () => {
            onEvent({
              type: 'transcript',
              segmentId: 'segment-final',
              text: 'Explain Symfony',
              isFinal: true,
              startedAtMs: 100,
              endedAtMs: 120,
            });
            onEvent({
              type: 'error',
              code: 'close-failure',
              message: 'provider close failed',
              retryable: false,
            });
            onEvent({ type: 'closed' });
          },
        };
      },
    };

    await expect(
      executeTranscriptBenchmarkRun(provider, [corpus[0]], [fixtures[0]], {
        clock: () => 150,
      }),
    ).rejects.toThrow('close-failure: provider close failed');
  });

  it('validates the complete fixture set before opening a provider connection', async () => {
    let connects = 0;
    const provider: TranscriptionProvider = {
      id: 'fake:validation',
      connect: async () => {
        connects += 1;
        throw new Error('should not connect');
      },
    };

    await expect(
      executeTranscriptBenchmarkRun(provider, corpus, [fixtures[0]]),
    ).rejects.toThrow('missing benchmark fixture: remote-case');
    expect(connects).toBe(0);

    await expect(
      executeTranscriptBenchmarkRun(provider, [corpus[0]], [
        {
          ...fixtures[0],
          chunks: [chunk(1, 'first'), chunk(1, 'duplicate')],
        },
      ]),
    ).rejects.toThrow('chunk sequence must increase monotonically');
    expect(connects).toBe(0);

    await expect(
      executeTranscriptBenchmarkRun(provider, [corpus[0]], [
        {
          ...fixtures[0],
          source: 'unknown',
        },
      ]),
    ).rejects.toThrow('fixture source must be local or remote');
    expect(connects).toBe(0);

    await expect(
      executeTranscriptBenchmarkRun(provider, [corpus[0]], [
        {
          ...fixtures[0],
          chunks: [chunk(0, 'first'), { ...chunk(1, 'second'), sampleRateHz: 48_000 }],
        },
      ]),
    ).rejects.toThrow('audio format changes mid-stream');
    expect(connects).toBe(0);

    await expect(
      executeTranscriptBenchmarkRun(provider, [corpus[0]], [
        {
          ...fixtures[0],
          chunks: [
            { ...chunk(0, 'first'), capturedAtMs: 200 },
            { ...chunk(1, 'second'), capturedAtMs: 100 },
          ],
        },
      ]),
    ).rejects.toThrow('capturedAtMs must not move backwards');
    expect(connects).toBe(0);
  });

  it('rejects invalid execution configuration before provider I/O', async () => {
    const provider = new FinalOnCloseProvider();

    await expect(
      executeTranscriptBenchmarkRun(provider, [corpus[0]], [fixtures[0]], {
        finalTimeoutMs: 0,
      }),
    ).rejects.toThrow('finalTimeoutMs must be a positive finite number');
    expect(provider.requests).toHaveLength(0);
  });
});
