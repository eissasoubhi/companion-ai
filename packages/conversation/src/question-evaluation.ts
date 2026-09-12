import { detectQuestion, type QuestionDetectionConfig } from './question-detector.js';
import type { QuestionFixture } from './evaluation-fixtures.js';

export interface QuestionEvaluationMetrics {
  readonly total: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly trueNegatives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly accuracy: number;
  readonly kindAccuracy: number;
  readonly failures: readonly string[];
}

export interface QuestionEvaluationThresholds {
  readonly minimumPrecision: number;
  readonly minimumRecall: number;
  readonly minimumKindAccuracy: number;
}

export const defaultQuestionEvaluationThresholds: QuestionEvaluationThresholds = {
  minimumPrecision: 0.9,
  minimumRecall: 0.9,
  minimumKindAccuracy: 0.8,
};

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function evaluateQuestionDetector(
  fixtures: readonly QuestionFixture[],
  config?: QuestionDetectionConfig,
): QuestionEvaluationMetrics {
  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;
  let expectedKindCount = 0;
  let correctKindCount = 0;
  const failures: string[] = [];

  for (const fixture of fixtures) {
    const result = config === undefined
      ? detectQuestion(fixture.text)
      : detectQuestion(fixture.text, config);

    if (fixture.expectedQuestion && result.isQuestion) truePositives += 1;
    if (!fixture.expectedQuestion && result.isQuestion) falsePositives += 1;
    if (!fixture.expectedQuestion && !result.isQuestion) trueNegatives += 1;
    if (fixture.expectedQuestion && !result.isQuestion) falseNegatives += 1;

    if (fixture.expectedQuestion !== result.isQuestion) {
      failures.push(`${fixture.id}: expected question=${fixture.expectedQuestion}, got ${result.isQuestion} (${result.confidence})`);
    }

    if (fixture.expectedQuestion && fixture.expectedKind !== undefined) {
      expectedKindCount += 1;
      if (result.kind === fixture.expectedKind) {
        correctKindCount += 1;
      } else {
        failures.push(`${fixture.id}: expected kind=${fixture.expectedKind}, got ${result.kind}`);
      }
    }
  }

  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  const total = fixtures.length;

  return {
    total,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    precision,
    recall,
    accuracy: ratio(truePositives + trueNegatives, total),
    kindAccuracy: ratio(correctKindCount, expectedKindCount),
    failures,
  };
}

export function assertQuestionEvaluationThresholds(
  metrics: QuestionEvaluationMetrics,
  thresholds: QuestionEvaluationThresholds = defaultQuestionEvaluationThresholds,
): void {
  const violations: string[] = [];
  if (metrics.precision < thresholds.minimumPrecision) {
    violations.push(`precision ${metrics.precision.toFixed(3)} < ${thresholds.minimumPrecision.toFixed(3)}`);
  }
  if (metrics.recall < thresholds.minimumRecall) {
    violations.push(`recall ${metrics.recall.toFixed(3)} < ${thresholds.minimumRecall.toFixed(3)}`);
  }
  if (metrics.kindAccuracy < thresholds.minimumKindAccuracy) {
    violations.push(`kind accuracy ${metrics.kindAccuracy.toFixed(3)} < ${thresholds.minimumKindAccuracy.toFixed(3)}`);
  }

  if (violations.length > 0) {
    const details = metrics.failures.length > 0 ? `\n${metrics.failures.join('\n')}` : '';
    throw new Error(`Question detector evaluation failed: ${violations.join(', ')}${details}`);
  }
}
