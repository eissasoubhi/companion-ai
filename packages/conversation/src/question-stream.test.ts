import type { TranscriptSegment } from '@companion-ai/contracts';
import { describe, expect, it } from 'vitest';

import { QuestionStream } from './question-stream.js';

function segment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: 'segment-1',
    sessionId: 'session-1',
    source: 'remote',
    text: 'Could you explain how Redis caching works',
    isFinal: true,
    startedAtMs: 1_000,
    endedAtMs: 1_500,
    ...overrides,
  };
}

describe('QuestionStream', () => {
  it('emits only finalized remote questions', () => {
    const stream = new QuestionStream({}, { now: () => 2_000 });

    expect(stream.process(segment({ source: 'local' }))).toBeUndefined();
    expect(stream.process(segment({ isFinal: false }))).toBeUndefined();
    expect(stream.process(segment({ text: 'I used Redis for caching.' }))).toBeUndefined();

    expect(stream.process(segment())).toMatchObject({
      sessionId: 'session-1',
      transcriptSegmentIds: ['segment-1'],
      kind: 'technical',
      text: 'Could you explain how Redis caching works',
      detectedAtMs: 2_000,
    });
  });

  it('suppresses exact duplicates and close reformulations inside the bounded window', () => {
    let now = 2_000;
    const stream = new QuestionStream({}, { now: () => now });

    expect(stream.process(segment())).toBeDefined();
    expect(stream.process(segment({ id: 'segment-2' }))).toBeUndefined();
    expect(
      stream.process(
        segment({ id: 'segment-3', text: 'Can you explain how Redis cache works?' }),
      ),
    ).toBeUndefined();

    now = 123_000;
    expect(stream.process(segment({ id: 'segment-4' }))).toBeDefined();
  });

  it('does not let duplicate history leak across sessions', () => {
    const stream = new QuestionStream({}, { now: () => 2_000 });

    expect(stream.process(segment())).toBeDefined();
    expect(
      stream.process(segment({ id: 'segment-2', sessionId: 'session-2' })),
    ).toBeDefined();
  });

  it('keeps distinct questions with overlapping interview boilerplate', () => {
    const stream = new QuestionStream({}, { now: () => 2_000 });

    expect(
      stream.process(segment({ text: 'Could you explain how Redis caching works?' })),
    ).toBeDefined();
    expect(
      stream.process(
        segment({ id: 'segment-2', text: 'Could you explain how RabbitMQ retries work?' }),
      ),
    ).toBeDefined();
  });

  it('can be reset explicitly', () => {
    const stream = new QuestionStream({}, { now: () => 2_000 });

    expect(stream.process(segment())).toBeDefined();
    expect(stream.process(segment({ id: 'segment-2' }))).toBeUndefined();

    stream.reset();

    expect(stream.process(segment({ id: 'segment-3' }))).toBeDefined();
  });
});
