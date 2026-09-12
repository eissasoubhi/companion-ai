import { describe, expect, it } from 'vitest';

import {
  requiredTechnicalTerms,
  summarizeBenchmarkCorpusCoverage,
  transcriptBenchmarkCorpus,
  validateBenchmarkCorpus,
} from './benchmark-corpus.js';

describe('STT benchmark corpus manifest', () => {
  it('keeps the versioned corpus structurally valid', () => {
    expect(validateBenchmarkCorpus(transcriptBenchmarkCorpus)).toEqual([]);
  });

  it('covers English, French and code-switching cases', () => {
    const coverage = summarizeBenchmarkCorpusCoverage(transcriptBenchmarkCorpus);

    expect(coverage.locales.en).toBeGreaterThan(0);
    expect(coverage.locales.fr).toBeGreaterThan(0);
    expect(coverage.locales.mixed).toBeGreaterThan(0);
  });

  it('covers recruiter, behavioral, technical, follow-up and incomplete utterances', () => {
    const coverage = summarizeBenchmarkCorpusCoverage(transcriptBenchmarkCorpus);

    expect(coverage.kinds.recruiter).toBeGreaterThan(0);
    expect(coverage.kinds.behavioral).toBeGreaterThan(0);
    expect(coverage.kinds.technical).toBeGreaterThan(0);
    expect(coverage.kinds['follow-up']).toBeGreaterThan(0);
    expect(coverage.kinds.incomplete).toBeGreaterThan(0);
  });

  it('covers every required technical term from the P0 benchmark issue', () => {
    const coverage = summarizeBenchmarkCorpusCoverage(transcriptBenchmarkCorpus);

    expect(coverage.coveredTechnicalTerms).toEqual(requiredTechnicalTerms);
    expect(coverage.missingTechnicalTerms).toEqual([]);
  });

  it('rejects duplicate ids, empty references and key terms absent from references', () => {
    const invalid = [
      {
        id: 'duplicate',
        locale: 'en' as const,
        kind: 'technical' as const,
        reference: 'Symfony',
        keyTerms: ['Symfony'],
        tags: [],
      },
      {
        id: 'duplicate',
        locale: 'fr' as const,
        kind: 'technical' as const,
        reference: '   ',
        keyTerms: ['Docker'],
        tags: [],
      },
    ];

    expect(validateBenchmarkCorpus(invalid)).toEqual([
      'duplicate case id: duplicate',
      'duplicate: reference must not be empty',
      'duplicate: key term not present in reference: Docker',
    ]);
  });
});
