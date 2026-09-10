import { describe, expect, it } from 'vitest';

import {
  isConfidence,
  normalizeQuestionText,
  questionFingerprint,
} from './session.js';

describe('live session contracts', () => {
  it('normalizes equivalent spoken question text consistently', () => {
    expect(questionFingerprint('  Tell me about React? ')).toBe(
      questionFingerprint('tell me about react'),
    );
  });

  it('keeps multilingual letters while removing punctuation noise', () => {
    expect(normalizeQuestionText('Parlez-moi de Symfony !')).toBe(
      'parlez moi de symfony',
    );
  });

  it('accepts only finite confidence scores in the 0..1 range', () => {
    expect(isConfidence(0)).toBe(true);
    expect(isConfidence(0.75)).toBe(true);
    expect(isConfidence(1)).toBe(true);
    expect(isConfidence(-0.1)).toBe(false);
    expect(isConfidence(1.01)).toBe(false);
    expect(isConfidence(Number.NaN)).toBe(false);
  });
});
