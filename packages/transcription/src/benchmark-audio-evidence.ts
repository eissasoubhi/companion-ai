export type BenchmarkAudioOrigin = 'synthetic' | 'consented-recording';
export type BenchmarkNoiseCondition = 'quiet' | 'moderate-background';
export type BenchmarkAccentCondition = 'baseline' | 'accent-variation';

export interface BenchmarkAudioEvidence {
  readonly corpusCaseId: string;
  readonly file: string;
  readonly sha256: string;
  readonly origin: BenchmarkAudioOrigin;
  readonly consentRecorded: boolean;
  readonly noise: BenchmarkNoiseCondition;
  readonly accent: BenchmarkAccentCondition;
}

export interface BenchmarkAudioEvidenceCoverage {
  readonly totalSamples: number;
  readonly hasModerateBackgroundNoise: boolean;
  readonly hasAccentVariation: boolean;
  readonly ready: boolean;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function validateBenchmarkAudioEvidence(
  evidence: readonly BenchmarkAudioEvidence[],
  corpusCaseIds: readonly string[],
): readonly string[] {
  const errors: string[] = [];
  const knownCaseIds = new Set(corpusCaseIds);
  const seenCaseIds = new Set<string>();
  const seenFiles = new Set<string>();

  for (const sample of evidence) {
    if (!knownCaseIds.has(sample.corpusCaseId)) {
      errors.push(`unknown corpus case id: ${sample.corpusCaseId}`);
    }
    if (seenCaseIds.has(sample.corpusCaseId)) {
      errors.push(`duplicate audio evidence for corpus case: ${sample.corpusCaseId}`);
    }
    seenCaseIds.add(sample.corpusCaseId);

    const file = sample.file.trim();
    if (file.length === 0 || file.startsWith('/') || file.includes('..')) {
      errors.push(`${sample.corpusCaseId}: audio file must be a safe relative path`);
    } else if (seenFiles.has(file)) {
      errors.push(`duplicate audio file: ${file}`);
    } else {
      seenFiles.add(file);
    }

    if (!SHA256_HEX.test(sample.sha256)) {
      errors.push(`${sample.corpusCaseId}: sha256 must be 64 lowercase hex characters`);
    }

    if (sample.origin === 'consented-recording' && !sample.consentRecorded) {
      errors.push(`${sample.corpusCaseId}: consented recording requires recorded consent`);
    }
    if (sample.origin === 'synthetic' && sample.consentRecorded) {
      errors.push(`${sample.corpusCaseId}: synthetic audio must not claim recorded consent`);
    }
  }

  return errors;
}

export function summarizeBenchmarkAudioEvidenceCoverage(
  evidence: readonly BenchmarkAudioEvidence[],
): BenchmarkAudioEvidenceCoverage {
  const hasModerateBackgroundNoise = evidence.some(
    (sample) => sample.noise === 'moderate-background',
  );
  const hasAccentVariation = evidence.some(
    (sample) => sample.accent === 'accent-variation',
  );

  return {
    totalSamples: evidence.length,
    hasModerateBackgroundNoise,
    hasAccentVariation,
    ready: evidence.length > 0 && hasModerateBackgroundNoise && hasAccentVariation,
  };
}
