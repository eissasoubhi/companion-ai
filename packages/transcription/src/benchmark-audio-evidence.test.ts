import { describe, expect, it } from 'vitest';

import {
  summarizeBenchmarkAudioEvidenceCoverage,
  validateBenchmarkAudioEvidence,
  type BenchmarkAudioEvidence,
} from './benchmark-audio-evidence.js';

const validSample = {
  corpusCaseId: 'en-recruiter-stack',
  file: 'audio/en-recruiter-stack.pcm',
  sha256: 'a'.repeat(64),
  origin: 'synthetic',
  consentRecorded: false,
  noise: 'quiet',
  accent: 'baseline',
} as const satisfies BenchmarkAudioEvidence;

describe('validateBenchmarkAudioEvidence', () => {
  it('accepts synthetic and explicitly consented recordings', () => {
    const consented: BenchmarkAudioEvidence = {
      ...validSample,
      corpusCaseId: 'fr-recruiter-parcours',
      file: 'audio/fr-recruiter-parcours.pcm',
      sha256: 'b'.repeat(64),
      origin: 'consented-recording',
      consentRecorded: true,
    };

    expect(
      validateBenchmarkAudioEvidence(
        [validSample, consented],
        ['en-recruiter-stack', 'fr-recruiter-parcours'],
      ),
    ).toEqual([]);
  });

  it('rejects unknown or duplicate cases, unsafe paths and invalid checksums', () => {
    const bad: BenchmarkAudioEvidence = {
      ...validSample,
      corpusCaseId: 'missing',
      file: '../outside.pcm',
      sha256: 'ABC',
    };

    expect(validateBenchmarkAudioEvidence([bad, bad], ['en-recruiter-stack'])).toEqual(
      expect.arrayContaining([
        'unknown corpus case id: missing',
        'duplicate audio evidence for corpus case: missing',
        'missing: audio file must be a safe relative path',
        'missing: sha256 must be 64 lowercase hex characters',
      ]),
    );
  });

  it('fails closed when consent metadata contradicts origin', () => {
    const noConsent: BenchmarkAudioEvidence = {
      ...validSample,
      origin: 'consented-recording',
      consentRecorded: false,
    };
    const fakeConsent: BenchmarkAudioEvidence = {
      ...validSample,
      corpusCaseId: 'fr-recruiter-parcours',
      file: 'audio/fr.pcm',
      sha256: 'b'.repeat(64),
      consentRecorded: true,
    };

    expect(
      validateBenchmarkAudioEvidence(
        [noConsent, fakeConsent],
        ['en-recruiter-stack', 'fr-recruiter-parcours'],
      ),
    ).toEqual(
      expect.arrayContaining([
        'en-recruiter-stack: consented recording requires recorded consent',
        'fr-recruiter-parcours: synthetic audio must not claim recorded consent',
      ]),
    );
  });
});

describe('summarizeBenchmarkAudioEvidenceCoverage', () => {
  it('only reports ready when real evidence covers both noise and accent variation', () => {
    expect(summarizeBenchmarkAudioEvidenceCoverage([]).ready).toBe(false);
    expect(summarizeBenchmarkAudioEvidenceCoverage([validSample]).ready).toBe(false);

    const noisyAccent: BenchmarkAudioEvidence = {
      ...validSample,
      corpusCaseId: 'mixed-architecture-messaging',
      file: 'audio/mixed.pcm',
      sha256: 'c'.repeat(64),
      noise: 'moderate-background',
      accent: 'accent-variation',
    };

    expect(summarizeBenchmarkAudioEvidenceCoverage([validSample, noisyAccent])).toEqual({
      totalSamples: 2,
      hasModerateBackgroundNoise: true,
      hasAccentVariation: true,
      ready: true,
    });
  });
});
