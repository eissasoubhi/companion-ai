import { describe, expect, it } from 'vitest';

import {
  assertBenchmarkProviderAudioFormat,
  createLiveBenchmarkProviders,
  parseBenchmarkCliArgs,
} from './benchmark-cli.js';
import type { TranscriptBenchmarkFixtureManifest } from './benchmark-fixture-manifest.js';

function manifest(
  entries: TranscriptBenchmarkFixtureManifest['entries'],
): TranscriptBenchmarkFixtureManifest {
  return {
    version: 1,
    fixtureSetId: 'benchmark-v1',
    corpusVersion: 'corpus-v1',
    entries,
  };
}

const baseEntry = {
  caseId: 'case-a',
  source: 'local' as const,
  path: 'case-a.pcm',
  sha256: 'a'.repeat(64),
  encoding: 'pcm-s16le' as const,
  sampleRateHz: 24_000,
  channels: 1,
};

describe('benchmark CLI', () => {
  it('accepts a uniform mono pcm-s16le fixture set', () => {
    const format = assertBenchmarkProviderAudioFormat(
      manifest([
        baseEntry,
        { ...baseEntry, caseId: 'case-b', path: 'case-b.pcm', source: 'remote' },
      ]),
    );

    expect(format).toEqual({ encoding: 'pcm-s16le', sampleRateHz: 24_000, channels: 1 });
  });

  it('rejects mixed fixture formats before any provider is created', () => {
    expect(() =>
      assertBenchmarkProviderAudioFormat(
        manifest([
          baseEntry,
          { ...baseEntry, caseId: 'case-b', path: 'case-b.pcm', sampleRateHz: 16_000 },
        ]),
      ),
    ).toThrow(/one audio format/);
  });

  it('rejects formats unsupported by all three shortlisted providers', () => {
    expect(() =>
      assertBenchmarkProviderAudioFormat(
        manifest([{ ...baseEntry, encoding: 'pcm-f32le' }]),
      ),
    ).toThrow(/mono pcm-s16le/);
  });

  it('requires all provider credentials before live execution', () => {
    const format = assertBenchmarkProviderAudioFormat(manifest([baseEntry]));

    expect(() =>
      createLiveBenchmarkProviders(
        {
          DEEPGRAM_API_KEY: 'deepgram-secret',
          ASSEMBLYAI_API_KEY: 'assembly-secret',
        },
        format,
      ),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('creates the three canonical provider candidates without exposing credentials in ids', () => {
    const format = assertBenchmarkProviderAudioFormat(manifest([baseEntry]));
    const providers = createLiveBenchmarkProviders(
      {
        DEEPGRAM_API_KEY: 'deepgram-secret',
        ASSEMBLYAI_API_KEY: 'assembly-secret',
        OPENAI_API_KEY: 'openai-secret',
      },
      format,
    );

    expect(providers.map((provider) => provider.id)).toEqual([
      'deepgram:nova-3',
      'assemblyai:universal-3-5-pro',
      'openai:gpt-live-transcribe',
    ]);
    expect(JSON.stringify(providers)).not.toContain('secret');
  });

  it('requires provenance evidence and validates the optional final timeout', () => {
    const options = parseBenchmarkCliArgs([
      'fixtures/manifest.json',
      'fixtures/audio-evidence.json',
      'results/run.json',
      '12000',
    ]);
    expect(options.manifestPath).toMatch(/fixtures\/manifest\.json$/);
    expect(options.evidencePath).toMatch(/fixtures\/audio-evidence\.json$/);
    expect(options.outputPath).toMatch(/results\/run\.json$/);
    expect(options.finalTimeoutMs).toBe(12_000);

    expect(() => parseBenchmarkCliArgs(['manifest.json', 'evidence.json', 'result.json', '0'])).toThrow(
      /positive finite/,
    );
    expect(() => parseBenchmarkCliArgs(['manifest.json', 'result.json'])).toThrow(/usage/);
  });
});
