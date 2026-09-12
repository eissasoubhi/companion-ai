import { describe, expect, it } from 'vitest';

import { createManualQuestion, parseManualQuestionRequest } from './manual-question.js';

describe('manual Ask fallback', () => {
  it('normalizes a bounded request and binds it to the active session', () => {
    const request = parseManualQuestionRequest({
      sessionId: ' session-1 ',
      text: ' Explain optimistic locking ',
    });

    const question = createManualQuestion(request, 'session-1', {
      createId: () => 'question-1',
      now: () => 1_234,
    });

    expect(question).toEqual({
      id: 'manual:question-1',
      sessionId: 'session-1',
      transcriptSegmentIds: [],
      text: 'Explain optimistic locking',
      kind: 'general',
      confidence: 1,
      detectedAtMs: 1_234,
    });
  });

  it('rejects stale sessions, empty text and oversized payloads', () => {
    expect(() =>
      createManualQuestion({ sessionId: 'session-old', text: 'Question' }, 'session-live'),
    ).toThrow(/not active/);

    expect(() => parseManualQuestionRequest({ sessionId: 'session-1', text: '   ' })).toThrow(
      /cannot be empty/,
    );

    expect(() =>
      parseManualQuestionRequest({ sessionId: 'session-1', text: 'x'.repeat(2_001) }),
    ).toThrow(/at most 2000/);
  });
});
