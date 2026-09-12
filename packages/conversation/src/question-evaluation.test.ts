import { describe, expect, it } from 'vitest';

import { questionFixtures } from './evaluation-fixtures.js';
import {
  assertQuestionEvaluationThresholds,
  evaluateQuestionDetector,
} from './question-evaluation.js';

describe('question detector evaluation', () => {
  it('meets the versioned precision, recall and kind thresholds', () => {
    const metrics = evaluateQuestionDetector(questionFixtures);

    expect(() => assertQuestionEvaluationThresholds(metrics)).not.toThrow();
    expect(metrics.total).toBe(questionFixtures.length);
  });

  it('reports regressions with fixture details', () => {
    const metrics = evaluateQuestionDetector(questionFixtures, {
      threshold: 1,
      minimumWords: 2,
    });

    expect(() => assertQuestionEvaluationThresholds(metrics)).toThrow(/recall/);
    expect(metrics.failures.some((failure) => failure.includes('en-direct-general'))).toBe(true);
  });
});
