import { describe, expect, it } from 'vitest';

import {
  calculateKeyTermAccuracy,
  calculateWordErrorRate,
  normalizeTranscriptText,
  summarizeTranscriptBenchmark,
} from './benchmark-metrics.js';

describe('transcript benchmark metrics', () => {
  it('normalizes case, accents and punctuation deterministically', () => {
    expect(normalizeTranscriptText('  Écoute, Symfony 7.4! ')).toBe('ecoute symfony 7.4');
  });

  it('computes insertion, deletion and substitution WER', () => {
    expect(calculateWordErrorRate('one two three', 'one four three')).toBeCloseTo(1 / 3);
    expect(calculateWordErrorRate('one two', 'one two three')).toBeCloseTo(1 / 2);
    expect(calculateWordErrorRate('one two three', 'one three')).toBeCloseTo(1 / 3);
  });

  it('handles empty references without division by zero', () => {
    expect(calculateWordErrorRate('', '')).toBe(0);
    expect(calculateWordErrorRate('', 'unexpected')).toBe(1);
  });

  it('measures normalized technical-term accuracy without substring false positives', () => {
    expect(calculateKeyTermAccuracy('PHP Symfony React AWS', ['PHP', 'Symfony', 'React', 'AWS'])).toBe(1);
    expect(calculateKeyTermAccuracy('React Native', ['React', 'AWS'])).toBe(0.5);
    expect(calculateKeyTermAccuracy('Kubernetes', ['Kube'])).toBe(0);
    expect(calculateKeyTermAccuracy('anything', [])).toBeNull();
  });

  it('aggregates WER by reference word count and keeps per-sample evidence', () => {
    const summary = summarizeTranscriptBenchmark([
      {
        id: 'en-tech',
        reference: 'Symfony React AWS',
        hypothesis: 'Symfony React AWS',
        keyTerms: ['Symfony', 'React', 'AWS'],
      },
      {
        id: 'fr-tech',
        reference: 'PHP Docker',
        hypothesis: 'PHP doctor',
        keyTerms: ['PHP', 'Docker'],
      },
    ]);

    expect(summary.sampleCount).toBe(2);
    expect(summary.referenceWordCount).toBe(5);
    expect(summary.wordErrorRate).toBeCloseTo(1 / 5);
    expect(summary.keyTermAccuracy).toBeCloseTo(0.75);
    expect(summary.samples.map((sample) => sample.id)).toEqual(['en-tech', 'fr-tech']);
  });
});
