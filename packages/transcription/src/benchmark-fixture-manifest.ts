import type { AudioChunk, AudioEncoding } from './types.js';

export const TRANSCRIPT_BENCHMARK_FIXTURE_MANIFEST_VERSION = 1 as const;
export type TranscriptBenchmarkFixtureStorageEncoding = 'raw' | 'base64' | 'gzip-base64';

export interface TranscriptBenchmarkFixtureManifestEntry {
  readonly caseId: string;
  readonly source: Extract<AudioChunk['source'], 'local' | 'remote'>;
  readonly path: string;
  readonly sha256: string;
  readonly encoding: AudioChunk['encoding'];
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly storageEncoding?: TranscriptBenchmarkFixtureStorageEncoding | undefined;
}

export interface TranscriptBenchmarkFixtureManifest {
  readonly version: typeof TRANSCRIPT_BENCHMARK_FIXTURE_MANIFEST_VERSION;
  readonly fixtureSetId: string;
  readonly corpusVersion: string;
  readonly entries: readonly TranscriptBenchmarkFixtureManifestEntry[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:\//;
const AUDIO_ENCODINGS = new Set<AudioEncoding>(['pcm-s16le', 'pcm-f32le', 'opus']);
const STORAGE_ENCODINGS = new Set<TranscriptBenchmarkFixtureStorageEncoding>([
  'raw',
  'base64',
  'gzip-base64',
]);

function assertIdentifier(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}

function assertRelativeFixturePath(path: string, caseId: string): void {
  const normalized = path.replaceAll('\\', '/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    WINDOWS_DRIVE_PATH_PATTERN.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..' || segment === '.' || segment.length === 0)
  ) {
    throw new Error(`benchmark fixture path must be a safe relative path: ${caseId}`);
  }
}

function sameFixtureAsset(
  left: TranscriptBenchmarkFixtureManifestEntry,
  right: TranscriptBenchmarkFixtureManifestEntry,
): boolean {
  return (
    left.source === right.source &&
    left.sha256 === right.sha256 &&
    left.encoding === right.encoding &&
    left.sampleRateHz === right.sampleRateHz &&
    left.channels === right.channels &&
    (left.storageEncoding ?? 'raw') === (right.storageEncoding ?? 'raw')
  );
}

export function assertTranscriptBenchmarkFixtureManifest(
  manifest: TranscriptBenchmarkFixtureManifest,
  expectedCaseIds?: readonly string[],
): void {
  if (manifest.version !== TRANSCRIPT_BENCHMARK_FIXTURE_MANIFEST_VERSION) {
    throw new Error(`unsupported benchmark fixture manifest version: ${manifest.version}`);
  }

  assertIdentifier(manifest.fixtureSetId, 'fixtureSetId');
  assertIdentifier(manifest.corpusVersion, 'corpusVersion');

  if (manifest.entries.length === 0) {
    throw new Error('benchmark fixture manifest must contain at least one entry');
  }

  const seenCaseIds = new Set<string>();
  const seenPaths = new Map<string, TranscriptBenchmarkFixtureManifestEntry>();

  for (const entry of manifest.entries) {
    assertIdentifier(entry.caseId, 'benchmark fixture caseId');
    if (seenCaseIds.has(entry.caseId)) {
      throw new Error(`duplicate benchmark fixture caseId: ${entry.caseId}`);
    }
    seenCaseIds.add(entry.caseId);

    if (entry.source !== 'local' && entry.source !== 'remote') {
      throw new Error(`benchmark fixture source must be local or remote: ${entry.caseId}`);
    }

    assertRelativeFixturePath(entry.path, entry.caseId);
    const normalizedPath = entry.path.replaceAll('\\', '/');
    const existingEntry = seenPaths.get(normalizedPath);
    if (existingEntry && !sameFixtureAsset(existingEntry, entry)) {
      throw new Error(`benchmark fixture path has conflicting metadata: ${normalizedPath}`);
    }
    seenPaths.set(normalizedPath, entry);

    if (!SHA256_PATTERN.test(entry.sha256)) {
      throw new Error(`benchmark fixture sha256 is invalid: ${entry.caseId}`);
    }

    if (!AUDIO_ENCODINGS.has(entry.encoding)) {
      throw new Error(`benchmark fixture encoding is invalid: ${entry.caseId}`);
    }
    if (!Number.isInteger(entry.sampleRateHz) || entry.sampleRateHz <= 0) {
      throw new RangeError(`benchmark fixture sampleRateHz is invalid: ${entry.caseId}`);
    }
    if (!Number.isInteger(entry.channels) || entry.channels <= 0) {
      throw new RangeError(`benchmark fixture channels is invalid: ${entry.caseId}`);
    }

    const storageEncoding = entry.storageEncoding ?? 'raw';
    if (!STORAGE_ENCODINGS.has(storageEncoding)) {
      throw new Error(`benchmark fixture storageEncoding is invalid: ${entry.caseId}`);
    }
  }

  if (!expectedCaseIds) return;

  const expected = new Set<string>();
  for (const caseId of expectedCaseIds) {
    assertIdentifier(caseId, 'expected benchmark caseId');
    if (expected.has(caseId)) {
      throw new Error(`duplicate expected benchmark caseId: ${caseId}`);
    }
    expected.add(caseId);
  }

  for (const caseId of expected) {
    if (!seenCaseIds.has(caseId)) {
      throw new Error(`missing benchmark fixture manifest entry: ${caseId}`);
    }
  }
  for (const caseId of seenCaseIds) {
    if (!expected.has(caseId)) {
      throw new Error(`unexpected benchmark fixture manifest entry: ${caseId}`);
    }
  }
}
