import { describe, expect, it, vi } from 'vitest';

import type { AnswerGenerationRequest, LLMProviderEvent } from '@companion-ai/ai';

import {
  createOpenAIProviderFromEnv,
  OpenAILLMProvider,
} from './openai-llm-provider.js';

const request: AnswerGenerationRequest = {
  requestId: 'request-1',
  sessionId: 'session-1',
  questionId: 'question-1',
  question: 'Explain dependency injection',
  length: 'short',
};

function sseResponse(events: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

async function collect(provider: OpenAILLMProvider, signal = new AbortController().signal) {
  const events: LLMProviderEvent[] = [];
  for await (const event of provider.stream(request, signal)) events.push(event);
  return events;
}

describe('OpenAILLMProvider', () => {
  it('streams text deltas and completion through the provider-neutral contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sseResponse([
        { type: 'response.created' },
        { type: 'response.output_text.delta', delta: 'Dependency ' },
        { type: 'response.output_text.delta', delta: 'injection.' },
        { type: 'response.completed', response: { status: 'completed' } },
      ]),
    );
    const provider = new OpenAILLMProvider({
      apiKey: 'main-process-secret',
      fetchImpl,
    });

    await expect(collect(provider)).resolves.toEqual([
      { type: 'delta', text: 'Dependency ' },
      { type: 'delta', text: 'injection.' },
      { type: 'completed', finishReason: 'stop' },
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer main-process-secret',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'gpt-5.6-terra',
      stream: true,
      store: false,
    });
  });

  it('includes verified context in the server-side prompt without changing the shared contract', async () => {
    let body = '';
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = String(init?.body ?? '');
      return sseResponse([{ type: 'response.completed' }]);
    };
    const provider = new OpenAILLMProvider({ apiKey: 'secret', fetchImpl });
    const contextualRequest: AnswerGenerationRequest = {
      ...request,
      groundingContext: [
        {
          source: {
            id: 'source-1',
            kind: 'profile',
            label: 'Verified profile',
          },
          text: 'The candidate has production Symfony experience.',
        },
      ],
    };

    const events: LLMProviderEvent[] = [];
    for await (const event of provider.stream(contextualRequest, new AbortController().signal)) {
      events.push(event);
    }

    const parsed = JSON.parse(body) as { input?: unknown };
    expect(String(parsed.input)).toContain('Verified context');
    expect(String(parsed.input)).toContain('production Symfony experience');
    expect(events).toEqual([{ type: 'completed', finishReason: 'stop' }]);
  });

  it('classifies rate limiting as retryable and authentication errors as terminal', async () => {
    const rateLimited = new OpenAILLMProvider({
      apiKey: 'secret',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 'rate_limit', message: 'slow down' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const unauthorized = new OpenAILLMProvider({
      apiKey: 'secret',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'bad key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    });

    await expect(collect(rateLimited)).resolves.toEqual([
      { type: 'error', code: 'rate_limit', message: 'slow down', retryable: true },
    ]);
    await expect(collect(unauthorized)).resolves.toEqual([
      { type: 'error', code: 'invalid_api_key', message: 'bad key', retryable: false },
    ]);
  });

  it('does not start a network request when already aborted', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new OpenAILLMProvider({ apiKey: 'secret', fetchImpl });
    const controller = new AbortController();
    controller.abort();

    await expect(collect(provider, controller.signal)).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps credentials in main-process configuration and rejects missing keys', () => {
    expect(() => createOpenAIProviderFromEnv({})).toThrow('OPENAI_API_KEY is required.');
    expect(() => new OpenAILLMProvider({ apiKey: '   ' })).toThrow(
      'OPENAI_API_KEY is required.',
    );
  });
});
