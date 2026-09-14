import type { BenchmarkAudioEvidence } from './benchmark-audio-evidence.js';
import { validateBenchmarkAudioEvidence } from './benchmark-audio-evidence.js';
import type { TranscriptBenchmarkFixtureManifest } from './benchmark-fixture-manifest.js';

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
