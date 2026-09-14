import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { BenchmarkAudioEvidence } from './benchmark-audio-evidence.js';
import { validateBenchmarkAudioEvidence } from './benchmark-audio-evidence.js';
import type { TranscriptBenchmarkFixtureManifest } from './benchmark-fixture-manifest.js';

export const MAX_BENCHMARK_AUDIO_EVIDENCE_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBenchmarkAudioEvidence(content: string): readonly BenchmarkAudioEvidence[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error('benchmark audio evidence is not valid JSON', { cause: error });
  }

  if (!Array.isArray(parsed)) throw new Error('benchmark audio evidence must be a JSON array');

  return parsed.map((value, index) => {
    if (!isRecord(value)) throw new Error(`benchmark audio evidence entry must be an object: ${index}`);
    const { corpusCaseId, file, sha256, origin, consentRecorded, noise, accent } = value;
    if (
      typeof corpusCaseId !== 'string' ||
      typeof file !== 'string' ||
      typeof sha256 !== 'string' ||
      (origin !== 'synthetic' && origin !== 'consented-recording') ||
      typeof consentRecorded !== 'boolean' ||
      (noise !== 'quiet' && noise !== 'moderate-background') ||
      (accent !== 'baseline' && accent !== 'accent-variation')
    ) {
      throw new Error(`benchmark audio evidence entry has invalid fields: ${index}`);
    }
    return { corpusCaseId, file, sha256, origin, consentRecorded, noise, accent };
  });
}

export async function loadBenchmarkAudioEvidenceFile(
  evidencePath: string,
  maxBytes = MAX_BENCHMARK_AUDIO_EVIDENCE_BYTES,
): Promise<readonly BenchmarkAudioEvidence[]> {
  if (evidencePath.trim().length === 0) throw new Error('evidencePath must not be empty');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be a positive safe integer');

  const absolutePath = resolve(evidencePath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error('benchmark audio evidence path is not a regular file');
  if (metadata.size > maxBytes) throw new Error(`benchmark audio evidence exceeds byte limit: ${metadata.size} > ${maxBytes}`);

  return parseBenchmarkAudioEvidence(await readFile(absolutePath, 'utf8'));
}

export function assertBenchmarkAudioEvidenceMatchesFixtureManifest(
  evidence: readonly BenchmarkAudioEvidence[],
  manifest: TranscriptBenchmarkFixtureManifest,
): void {
  const caseIds = manifest.entries.map((entry) => entry.caseId);
  const validationErrors = validateBenchmarkAudioEvidence(evidence, caseIds);
  if (validationErrors.length > 0) {
    throw new Error(`benchmark audio evidence is invalid: ${validationErrors[0]}`);
  }

  const byCaseId = new Map(evidence.map((sample) => [sample.corpusCaseId, sample] as const));
  for (const entry of manifest.entries) {
    const sample = byCaseId.get(entry.caseId);
    if (!sample) {
      throw new Error(`missing benchmark audio evidence for fixture: ${entry.caseId}`);
    }
    if (sample.file.replaceAll('\\', '/') !== entry.path.replaceAll('\\', '/')) {
      throw new Error(`benchmark audio evidence path mismatch: ${entry.caseId}`);
    }
    if (sample.sha256 !== entry.sha256) {
      throw new Error(`benchmark audio evidence sha256 mismatch: ${entry.caseId}`);
    }
  }

  if (evidence.length !== manifest.entries.length) {
    throw new Error('benchmark audio evidence must match fixture manifest one-to-one');
  }
}
