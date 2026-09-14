import { describe, expect, it } from 'vitest';

import { AnswerGenerationCoordinator, streamAnswerSuggestion } from './generator.js';
import type {
  AnswerGenerationEvent,
  AnswerGenerationRequest,
  LLMProvider,
} from './types.js';

function request(requestId: string): AnswerGenerationRequest {
  return {
    requestId,
    sessionId: 'session-1',
    questionId: `question:${requestId}`,
    question: 'Tell me about your most relevant project.',
    length: 'normal',
  };
}

describe('streamAnswerSuggestion', () => {
  it('assembles deltas and measures provider plus trigger-to-first-token latency', async () => {
    const provider: LLMProvider = {
      id: 'fake-llm',
      async *stream() {
        yield { type: 'delta', text: 'I led ' } as const;
        yield { type: 'delta', text: 'a migration.' } as const;
        yield { type: 'completed', finishReason: 'stop' } as const;
      },
    };
    const events: AnswerGenerationEvent[] = [];
    const times = [1_000, 1_120, 1_300];
    const clock = () => times.shift() ?? 1_300;

    const suggestion = await streamAnswerSuggestion(
      provider,
      { ...request('r1'), triggeredAtMs: 900 },
      (event) => events.push(event),
      new AbortController().signal,
      clock,
    );

    expect(suggestion.status).toBe('complete');
    expect(suggestion.text).toBe('I led a migration.');

    const finalEvent = events.at(-1);
    expect(finalEvent).toMatchObject({
      type: 'suggestion',
      suggestion: {
        status: 'complete',
        text: 'I led a migration.',
      },
      metrics: {
        triggeredAtMs: 900,
        timeToFirstTokenMs: 120,
        triggerToFirstTokenMs: 220,
        totalDurationMs: 300,
      },
    });
  });

  it('omits trigger latency when the trigger timestamp is not finite', async () => {
    const provider: LLMProvider = {
      id: 'fake-llm',
      async *stream() {
        yield { type: 'delta', text: 'answer' } as const;
        yield { type: 'completed', finishReason: 'stop' } as const;
      },
    };
    const events: AnswerGenerationEvent[] = [];
    const times = [1_000, 1_050, 1_100];
    const clock = () => times.shift() ?? 1_100;

    await streamAnswerSuggestion(
      provider,
      { ...request('invalid-trigger'), triggeredAtMs: Number.NaN },
      (event) => events.push(event),
      new AbortController().signal,
      clock,
    );

    const suggestionEvent = events.find((event) => event.type === 'suggestion');
    expect(suggestionEvent).toMatchObject({
      type: 'suggestion',
      metrics: { timeToFirstTokenMs: 50 },
    });
    if (suggestionEvent?.type === 'suggestion') {
      expect(suggestionEvent.metrics.triggeredAtMs).toBeUndefined();
      expect(suggestionEvent.metrics.triggerToFirstTokenMs).toBeUndefined();
    }
  });

  it('fails closed if a provider ends without an explicit completion event', async () => {
    const provider: LLMProvider = {
      id: 'fake-llm',
      async *stream() {
        yield { type: 'delta', text: 'partial' } as const;
      },
    };
    const events: AnswerGenerationEvent[] = [];

    const suggestion = await streamAnswerSuggestion(
      provider,
      request('r2'),
      (event) => events.push(event),
      new AbortController().signal,
    );

    expect(suggestion.status).toBe('failed');
    expect(events.some((event) => event.type === 'provider-error')).toBe(true);
  });
});

describe('AnswerGenerationCoordinator', () => {
  it('cancels an older generation and suppresses its stale events', async () => {
    const provider: LLMProvider = {
      id: 'fake-llm',
      async *stream(currentRequest, signal) {
        if (currentRequest.requestId === 'old') {
          yield { type: 'delta', text: 'old-start' } as const;
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          yield { type: 'delta', text: '-stale' } as const;
          yield { type: 'completed', finishReason: 'stop' } as const;
          return;
        }

        yield { type: 'delta', text: 'new-answer' } as const;
        yield { type: 'completed', finishReason: 'stop' } as const;
      },
    };
    const coordinator = new AnswerGenerationCoordinator();
    const events: AnswerGenerationEvent[] = [];

    const oldPromise = coordinator.start(
      provider,
      request('old'),
      (event) => events.push(event),
    );

    await Promise.resolve();

    const newPromise = coordinator.start(
      provider,
      request('new'),
      (event) => events.push(event),
    );

    const [oldSuggestion, newSuggestion] = await Promise.all([oldPromise, newPromise]);

    expect(oldSuggestion.status).toBe('cancelled');
    expect(newSuggestion).toMatchObject({
      status: 'complete',
      text: 'new-answer',
    });
    expect(
      events.some(
        (event) =>
          event.type === 'suggestion' &&
          event.suggestion.questionId === 'question:old' &&
          event.suggestion.status === 'cancelled',
      ),
    ).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: 'suggestion',
      suggestion: {
        questionId: 'question:new',
        status: 'complete',
      },
    });
  });
});
