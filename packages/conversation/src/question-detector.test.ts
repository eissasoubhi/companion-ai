import { describe, expect, it } from 'vitest';

import { questionFixtures } from './evaluation-fixtures.js';
import { detectQuestion } from './question-detector.js';

interface EvaluationMetrics {
  readonly precision: number;
  readonly recall: number;
  readonly kindAccuracy: number;
}

function evaluate(): EvaluationMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let kindCorrect = 0;
  let kindTotal = 0;

  for (const fixture of questionFixtures) {
    const result = detectQuestion(fixture.text);
    if (result.isQuestion && fixture.expectedQuestion) truePositive += 1;
    else if (result.isQuestion && !fixture.expectedQuestion) falsePositive += 1;
    else if (!result.isQuestion && fixture.expectedQuestion) falseNegative += 1;

    if (fixture.expectedQuestion && fixture.expectedKind) {
      kindTotal += 1;
      if (result.kind === fixture.expectedKind) kindCorrect += 1;
    }
  }

  return {
    precision: truePositive / Math.max(1, truePositive + falsePositive),
    recall: truePositive / Math.max(1, truePositive + falseNegative),
    kindAccuracy: kindCorrect / Math.max(1, kindTotal),
  };
}

describe('question detection evaluation baseline', () => {
  it('meets the initial deterministic precision and recall gates', () => {
    const metrics = evaluate();
    expect(metrics.precision).toBeGreaterThanOrEqual(0.9);
    expect(metrics.recall).toBeGreaterThanOrEqual(0.85);
    expect(metrics.kindAccuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('exposes reasons and confidence for tuning/debugging', () => {
    const result = detectQuestion('Could you explain how Redis caching worked?');
    expect(result.isQuestion).toBe(true);
    expect(result.kind).toBe('technical');
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.reasons).toContain('direct-question-form');
  });

  it('does not fire on an incomplete direct question', () => {
    const result = detectQuestion('How did you handle the migration and');
    expect(result.isQuestion).toBe(false);
    expect(result.reasons).toContain('likely-incomplete-turn');
  });

  it('rejects thresholds that can silently disable or force question detection', () => {
    expect(() => detectQuestion('How?', { threshold: Number.NaN, minimumWords: 1 })).toThrow(RangeError);
    expect(() => detectQuestion('How?', { threshold: Number.POSITIVE_INFINITY, minimumWords: 1 })).toThrow(RangeError);
    expect(() => detectQuestion('How?', { threshold: -0.01, minimumWords: 1 })).toThrow(RangeError);
    expect(() => detectQuestion('How?', { threshold: 1.01, minimumWords: 1 })).toThrow(RangeError);
  });

  it('requires minimumWords to be a positive safe integer', () => {
    for (const minimumWords of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => detectQuestion('How?', { threshold: 0.62, minimumWords })).toThrow(RangeError);
    }
    expect(() => detectQuestion('How?', { threshold: 0, minimumWords: 1 })).not.toThrow();
    expect(() => detectQuestion('How?', { threshold: 1, minimumWords: 1 })).not.toThrow();
  });
});
