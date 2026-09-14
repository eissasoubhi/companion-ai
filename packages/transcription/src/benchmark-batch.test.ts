import { describe, expect, it } from 'vitest';

import {
  executeTranscriptBenchmarkBatch,
  fingerprintTranscriptBenchmarkFixtureManifest,
  serializeTranscriptBenchmarkBatchArtifact,
} from './benchmark-batch.js';
import type { LoadedTranscriptBenchmarkFixtureSet } from './benchmark-fixture-loader.js';
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

const fixtureSet: LoadedTranscriptBenchmarkFixtureSet = {
  manifest: {
    version: 1,
    fixtureSetId: 'fixtures-v1',
    corpusVersion: 'corpus-v1',
    entries: [
      {
        caseId: 'local-case',
        source: 'local',
        path: 'local.pcm',
        sha256: 'a'.repeat(64),
        encoding: 'pcm-s16le',
        sampleRateHz: 16_000,
        channels: 1,
      },
      {
        caseId: 'remote-case',
        source: 'remote',
        path: 'remote.pcm',
        sha256: 'b'.repeat(64),
        encoding: 'pcm-s16le',
        sampleRateHz: 16_000,
        channels: 1,
      },
    ],
  },
  fixtures: [
    {
      caseId: 'local-case',
      source: 'local',
      chunks: [
        {
          sequence: 0,
          capturedAtMs: 100,
          sampleRateHz: 16_000,
          channels: 1,
          encoding: 'pcm-s16le',
          data: new Uint8Array([1, 2]),
        },
      ],
    },
    {
      caseId: 'remote-case',
      source: 'remote',
      chunks: [
        {
          sequence: 0,
          capturedAtMs: 200,
          sampleRateHz: 16_000,
          channels: 1,
          encoding: 'pcm-s16le',
          data: new Uint8Array([3, 4]),
        },
      ],
    },
  ],
};

class DeterministicProvider implements TranscriptionProvider {
  readonly requests: TranscriptionConnectRequest[] = [];

  constructor(
    readonly id: string,
    private readonly lifecycle: { active: number; maxActive: number },
  ) {}

  async connect(
    request: TranscriptionConnectRequest,
    onEvent: TranscriptionProviderEventHandler,
  ) {
    this.requests.push(request);
    this.lifecycle.active += 1;
    this.lifecycle.maxActive = Math.max(this.lifecycle.maxActive, this.lifecycle.active);
    onEvent({ type: 'ready' });

    return {
      write: async (_chunk: AudioChunk) => undefined,
      close: async () => {
        const text = request.source === 'local' ? 'Explain Symfony' : 'Et ensuite';
        onEvent({
          type: 'transcript',
          segmentId: `${this.id}:${request.source}`,
          text,
          isFinal: true,
          startedAtMs: 100,
          endedAtMs: 120,
        });
        this.lifecycle.active -= 1;
        onEvent({ type: 'closed', reason: 'fixture-complete' });
      },
    };
  }
}

describe('executeTranscriptBenchmarkBatch', () => {
  it('runs providers sequentially against the same verified fixture set', async () => {
    const lifecycle = { active: 0, maxActive: 0 };
    const first = new DeterministicProvider('provider:first', lifecycle);
    const second = new DeterministicProvider('provider:second', lifecycle);

    const result = await executeTranscriptBenchmarkBatch(
      [first, second],
      corpus,
      fixtureSet,
      { clock: () => 150, sessionIdPrefix: 'comparison-v1' },
    );

    expect(lifecycle.maxActive).toBe(1);
    expect(result.providerIds).toEqual(['provider:first', 'provider:second']);
    expect(result.caseIds).toEqual(['local-case', 'remote-case']);
    expect(result.corpusVersion).toBe('corpus-v1');
    expect(result.fixtureSetId).toBe('fixtures-v1');
    expect(result.fixtureFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.runs).toHaveLength(2);
    expect(result.runs.every((run) => run.report.accuracy.wordErrorRate === 0)).toBe(true);
    expect(first.requests.map((request) => request.source)).toEqual(['local', 'remote']);
    expect(second.requests.map((request) => request.source)).toEqual(['local', 'remote']);
    expect(first.requests[0]?.sessionId).toBe('comparison-v1:provider:first:local-case');
  });

  it('fingerprints fixture identity deterministically and changes when verified bytes change', () => {
    const original = fingerprintTranscriptBenchmarkFixtureManifest(fixtureSet.manifest);
    const reordered = fingerprintTranscriptBenchmarkFixtureManifest({
      ...fixtureSet.manifest,
      entries: [...fixtureSet.manifest.entries].reverse(),
    });
    const changedDigest = fingerprintTranscriptBenchmarkFixtureManifest({
      ...fixtureSet.manifest,
      entries: fixtureSet.manifest.entries.map((entry) =>
        entry.caseId === 'local-case' ? { ...entry, sha256: 'c'.repeat(64) } : entry,
      ),
    });

    expect(reordered).toBe(original);
    expect(changedDigest).not.toBe(original);
  });

  it('rejects duplicate provider ids before opening any provider connection', async () => {
    const lifecycle = { active: 0, maxActive: 0 };
    const first = new DeterministicProvider('provider:same', lifecycle);
    const second = new DeterministicProvider('provider:same', lifecycle);

    await expect(
      executeTranscriptBenchmarkBatch([first, second], corpus, fixtureSet),
    ).rejects.toThrow('duplicate transcription provider id: provider:same');

    expect(first.requests).toHaveLength(0);
    expect(second.requests).toHaveLength(0);
  });

  it('rejects provider ids with surrounding whitespace before provider I/O', async () => {
    const lifecycle = { active: 0, maxActive: 0 };
    const provider = new DeterministicProvider(' provider:spaced ', lifecycle);

    await expect(executeTranscriptBenchmarkBatch([provider], corpus, fixtureSet)).rejects.toThrow(
      'provider id must not have surrounding whitespace',
    );
    expect(provider.requests).toHaveLength(0);
  });

  it('serializes a deterministic JSON artifact without audio bytes or credentials', async () => {
    const lifecycle = { active: 0, maxActive: 0 };
    const provider = new DeterministicProvider('provider:artifact', lifecycle);
    const result = await executeTranscriptBenchmarkBatch([provider], corpus, fixtureSet, {
      clock: () => 150,
    });

    const artifact = serializeTranscriptBenchmarkBatchArtifact(result);
    expect(artifact.endsWith('\n')).toBe(true);
    expect(artifact).toContain('"fixtureSetId": "fixtures-v1"');
    expect(artifact).toContain('"fixtureFingerprintSha256"');
    expect(artifact).toContain('"providerId": "provider:artifact"');
    expect(artifact).not.toContain('"data"');
    expect(artifact).not.toContain('"sha256"');
  });
});
