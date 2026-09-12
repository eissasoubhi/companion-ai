import { describe, expect, it, vi } from 'vitest';

import type {
  AnswerGenerationRequest,
  LLMProvider,
  LLMProviderEvent,
} from '@companion-ai/ai';
import type { DetectedQuestion } from '@companion-ai/contracts';

import { AnswerRuntime, type AnswerRuntimeEvent } from './answer-runtime.js';

const question: DetectedQuestion = {
  id: 'question-1',
  sessionId: 'session-1',
  transcriptSegmentIds: ['segment-1'],
  text: 'Explain dependency injection',
  kind: 'technical',
  confidence: 0.94,
  detectedAtMs: 1_000,
};

class FakeProvider implements LLMProvider {
  readonly id = 'fake';
  readonly requests: AnswerGenerationRequest[] = [];

  async *stream(
    request: AnswerGenerationRequest,
    _signal: AbortSignal,
  ): AsyncIterable<LLMProviderEvent> {
    this.requests.push(request);
    yield { type: 'delta', text: 'Use constructor injection.' };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

describe('AnswerRuntime', () => {
  it('maps a detected question to verified-context generation and emits streaming suggestions', async () => {
    const provider = new FakeProvider();
    const events: AnswerRuntimeEvent[] = [];
    const getContextItems = vi.fn(() => []);
    const runtime = new AnswerRuntime({
      createProvider: () => provider,
      getContextItems,
      emit: (event) => events.push(event),
      createRequestId: () => 'request-1',
    });

    await runtime.handleQuestion(question);

    expect(getContextItems).toHaveBeenCalledTimes(1);
    expect(provider.requests).toEqual([
      expect.objectContaining({
        requestId: 'request-1',
        sessionId: 'session-1',
        questionId: 'question-1',
        question: question.text,
        length: 'normal',
        grounding: [],
        groundingContext: [],
      }),
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'suggestion',
          suggestion: expect.objectContaining({
            questionId: 'question-1',
            text: 'Use constructor injection.',
            status: 'streaming',
          }),
        }),
        expect.objectContaining({
          type: 'suggestion',
          suggestion: expect.objectContaining({
            questionId: 'question-1',
            status: 'complete',
          }),
        }),
      ]),
    );
  });

  it('surfaces missing provider configuration without throwing or exposing credentials', async () => {
    const events: AnswerRuntimeEvent[] = [];
    const runtime = new AnswerRuntime({
      createProvider: () => {
        throw new Error('OPENAI_API_KEY is required.');
      },
      getContextItems: () => [],
      emit: (event) => events.push(event),
    });

    await expect(runtime.handleQuestion(question)).resolves.toBeUndefined();
    expect(events).toEqual([
      {
        type: 'runtime-error',
        sessionId: 'session-1',
        questionId: 'question-1',
        code: 'provider-unavailable',
        message: 'OPENAI_API_KEY is required.',
      },
    ]);
  });
});
