import type {
  AnswerGenerationRequest,
  LLMProvider,
  LLMProviderEvent,
} from '@companion-ai/ai';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.2-mini';

export interface OpenAIProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

type OpenAIStreamEvent =
  | { readonly type: 'response.output_text.delta'; readonly delta?: unknown }
  | { readonly type: 'response.completed'; readonly response?: unknown }
  | { readonly type: 'response.failed'; readonly response?: unknown }
  | { readonly type: 'error'; readonly code?: unknown; readonly message?: unknown }
  | { readonly type: string; readonly [key: string]: unknown };

function answerLengthInstruction(length: AnswerGenerationRequest['length']): string {
  switch (length) {
    case 'short':
      return 'Answer in at most 3 concise sentences.';
    case 'normal':
      return 'Answer concisely with enough detail to be immediately useful.';
    case 'detailed':
      return 'Give a structured, detailed answer while avoiding unnecessary repetition.';
  }
}

function buildPrompt(request: AnswerGenerationRequest): string {
  const context = request.groundingContext ?? [];
  const sections = [
    `Question:\n${request.question}`,
    answerLengthInstruction(request.length),
  ];

  if (context.length > 0) {
    sections.push(
      `Verified context (use only when relevant; do not invent missing facts):\n${context
        .map((entry, index) => `[${index + 1}] ${entry.text}`)
        .join('\n\n')}`,
    );
  }

  if (request.instructions?.trim()) {
    sections.push(`Additional instructions:\n${request.instructions.trim()}`);
  }

  return sections.join('\n\n');
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null) {
    if ('message' in value && typeof value.message === 'string') return value.message;
    if ('error' in value && typeof value.error === 'object' && value.error !== null) {
      const nested = value.error;
      if ('message' in nested && typeof nested.message === 'string') return nested.message;
    }
  }
  return fallback;
}

function errorCode(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null) {
    if ('code' in value && typeof value.code === 'string') return value.code;
    if ('error' in value && typeof value.error === 'object' && value.error !== null) {
      const nested = value.error;
      if ('code' in nested && typeof nested.code === 'string') return nested.code;
    }
  }
  return fallback;
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }
}

async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<OpenAIStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = block
          .split(/\r?\n/u)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');

        if (data && data !== '[DONE]') {
          try {
            const parsed: unknown = JSON.parse(data);
            if (
              typeof parsed === 'object' &&
              parsed !== null &&
              'type' in parsed &&
              typeof parsed.type === 'string'
            ) {
              yield parsed as OpenAIStreamEvent;
            }
          } catch {
            yield {
              type: 'error',
              code: 'invalid-sse-json',
              message: 'OpenAI returned malformed streaming JSON.',
            };
          }
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export class OpenAILLMProvider implements LLMProvider {
  readonly id = 'openai-responses';
  readonly #apiKey: string;
  readonly #model: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAIProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY is required.');

    this.#apiKey = apiKey;
    this.#model = options.model?.trim() || DEFAULT_MODEL;
    this.#endpoint = options.endpoint?.trim() || DEFAULT_ENDPOINT;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async *stream(
    request: AnswerGenerationRequest,
    signal: AbortSignal,
  ): AsyncIterable<LLMProviderEvent> {
    if (signal.aborted) return;

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.#model,
          stream: true,
          store: false,
          input: buildPrompt(request),
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) return;
      yield {
        type: 'error',
        code: 'network-error',
        message: error instanceof Error ? error.message : 'OpenAI request failed.',
        retryable: true,
      };
      return;
    }

    if (!response.ok) {
      const body = await readErrorBody(response);
      yield {
        type: 'error',
        code: errorCode(body, `http-${response.status}`),
        message: errorMessage(body, `OpenAI returned HTTP ${response.status}.`),
        retryable: isRetryableStatus(response.status),
      };
      return;
    }

    if (!response.body) {
      yield {
        type: 'error',
        code: 'missing-response-body',
        message: 'OpenAI returned a successful response without a stream body.',
        retryable: true,
      };
      return;
    }

    for await (const event of parseSse(response.body, signal)) {
      if (signal.aborted) return;

      if (event.type === 'response.output_text.delta') {
        if (typeof event.delta === 'string' && event.delta.length > 0) {
          yield { type: 'delta', text: event.delta };
        }
        continue;
      }

      if (event.type === 'response.completed') {
        yield { type: 'completed', finishReason: 'stop' };
        return;
      }

      if (event.type === 'response.failed' || event.type === 'error') {
        yield {
          type: 'error',
          code: errorCode(event, 'provider-error'),
          message: errorMessage(event, 'OpenAI generation failed.'),
          retryable: event.type === 'response.failed',
        };
        return;
      }
    }

    if (!signal.aborted) {
      yield {
        type: 'error',
        code: 'stream-ended',
        message: 'OpenAI stream ended before response.completed.',
        retryable: true,
      };
    }
  }
}

export function createOpenAIProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OpenAILLMProvider {
  return new OpenAILLMProvider({
    apiKey: env.OPENAI_API_KEY ?? '',
    model: env.OPENAI_MODEL,
  });
}
