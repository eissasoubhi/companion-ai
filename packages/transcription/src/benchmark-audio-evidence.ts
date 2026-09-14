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
  readonly missingCorpusCaseIds: readonly string[];
  readonly hasModerateBackgroundNoise: boolean;
  readonly hasAccentVariation: boolean;
  readonly ready: boolean;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function validateBenchmarkAudioEvidence(evidence: readonly BenchmarkAudioEvidence[], corpusCaseIds: readonly string[]): readonly string[] {
  const errors: string[] = [];
  const known = new Set(corpusCaseIds);
  const cases = new Set<string>();
  const files = new Set<string>();
  for (const sample of evidence) {
    if (!known.has(sample.corpusCaseId)) errors.push(`unknown corpus case id: ${sample.corpusCaseId}`);
    if (cases.has(sample.corpusCaseId)) errors.push(`duplicate audio evidence for corpus case: ${sample.corpusCaseId}`);
    cases.add(sample.corpusCaseId);
    const file = sample.file.trim();
    if (!file || file.startsWith('/') || file.includes('..')) errors.push(`${sample.corpusCaseId}: audio file must be a safe relative path`);
    else if (files.has(file)) errors.push(`duplicate audio file: ${file}`);
    else files.add(file);
    if (!SHA256_HEX.test(sample.sha256)) errors.push(`${sample.corpusCaseId}: sha256 must be 64 lowercase hex characters`);
    if (sample.origin === 'consented-recording' && !sample.consentRecorded) errors.push(`${sample.corpusCaseId}: consented recording requires recorded consent`);
    if (sample.origin === 'synthetic' && sample.consentRecorded) errors.push(`${sample.corpusCaseId}: synthetic audio must not claim recorded consent`);
  }
  return errors;
}

export function summarizeBenchmarkAudioEvidenceCoverage(evidence: readonly BenchmarkAudioEvidence[], corpusCaseIds: readonly string[]): BenchmarkAudioEvidenceCoverage {
  const covered = new Set(evidence.map((sample) => sample.corpusCaseId));
  const missingCorpusCaseIds = corpusCaseIds.filter((id) => !covered.has(id));
  const hasModerateBackgroundNoise = evidence.some((sample) => sample.noise === 'moderate-background');
  const hasAccentVariation = evidence.some((sample) => sample.accent === 'accent-variation');
  return {
    totalSamples: evidence.length,
    missingCorpusCaseIds,
    hasModerateBackgroundNoise,
    hasAccentVariation,
    ready: corpusCaseIds.length > 0 && missingCorpusCaseIds.length === 0 && hasModerateBackgroundNoise && hasAccentVariation,
  };
}
