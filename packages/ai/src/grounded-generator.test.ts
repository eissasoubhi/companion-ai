import { describe, expect, it } from 'vitest';

import type { LLMProvider } from './types.js';
import {
  buildVerifiedAnswerRequest,
  VerifiedAnswerGenerationCoordinator,
} from './grounded-generator.js';

const baseInput = {
  requestId: 'request-1',
  sessionId: 'session-1',
  questionId: 'question-1',
  question: 'How did you improve PHP performance with Redis?',
  length: 'normal' as const,
  contextItems: [
    {
      id: 'verified-redis',
      kind: 'verified-story' as const,
      label: 'Redis migration',
      text: 'I introduced Redis caching to reduce repeated database reads in PHP.',
      status: 'verified' as const,
      tags: ['php', 'redis'],
    },
    {
      id: 'draft-secret',
      kind: 'profile-fact' as const,
      label: 'Draft',
      text: 'Redis PHP secret draft content.',
      status: 'draft' as const,
    },
  ],
};

describe('buildVerifiedAnswerRequest', () => {
  it('passes only verified retrieved text and provenance to the provider request', () => {
    const result = buildVerifiedAnswerRequest(baseInput);

    expect(result.request.grounding).toEqual([
      expect.objectContaining({ id: 'verified-redis' }),
    ]);
    expect(result.request.groundingContext).toEqual([
      {
        source: expect.objectContaining({ id: 'verified-redis' }),
        text: 'I introduced Redis caching to reduce repeated database reads in PHP.',
      },
    ]);
    expect(JSON.stringify(result.request)).not.toContain('secret draft content');
  });

  it('keeps generation valid when no verified context is relevant', () => {
    const result = buildVerifiedAnswerRequest({
      ...baseInput,
      question: 'Explain frontend accessibility testing',
      retrievalConfig: {
        maxResults: 4,
        maxCharacters: 4_000,
        minimumScore: 0.3,
      },
    });

    expect(result.request.grounding).toEqual([]);
    expect(result.request.groundingContext).toEqual([]);
  });
});

describe('VerifiedAnswerGenerationCoordinator', () => {
  it('streams a grounded request without leaking unverified text', async () => {
    let providerRequest: Parameters<LLMProvider['stream']>[0] | undefined;
    const provider: LLMProvider = {
      id: 'fake',
      async *stream(request) {
        providerRequest = request;
        yield { type: 'delta', text: 'Use Redis caching.' };
        yield { type: 'completed', finishReason: 'stop' };
      },
    };
    const events: unknown[] = [];
    const coordinator = new VerifiedAnswerGenerationCoordinator();

    const result = await coordinator.start(provider, baseInput, (event) => events.push(event));

    expect(result.status).toBe('complete');
    expect(result.text).toBe('Use Redis caching.');
    expect(providerRequest?.groundingContext?.map((entry) => entry.source.id)).toEqual([
      'verified-redis',
    ]);
    expect(JSON.stringify(providerRequest)).not.toContain('secret draft content');
    expect(events.length).toBeGreaterThan(0);
  });

  it('cancels stale generation when a newer grounded request starts', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const provider: LLMProvider = {
      id: 'fake',
      async *stream(request, signal) {
        if (request.requestId === 'request-1') {
          await firstBlocked;
          if (signal.aborted) return;
        }
        yield { type: 'delta', text: request.requestId };
        yield { type: 'completed', finishReason: 'stop' };
      },
    };
    const coordinator = new VerifiedAnswerGenerationCoordinator();
    const firstEvents: unknown[] = [];
    const secondEvents: unknown[] = [];

    const first = coordinator.start(provider, baseInput, (event) => firstEvents.push(event));
    const second = coordinator.start(
      provider,
      { ...baseInput, requestId: 'request-2', questionId: 'question-2' },
      (event) => secondEvents.push(event),
    );
    releaseFirst?.();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.status).toBe('cancelled');
    expect(firstEvents).toEqual([]);
    expect(secondResult.status).toBe('complete');
    expect(secondResult.text).toBe('request-2');
    expect(secondEvents.length).toBeGreaterThan(0);
  });
});
