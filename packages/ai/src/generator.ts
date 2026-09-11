import type { AnswerSuggestion } from '@companion-ai/contracts';

import type {
  AnswerGenerationEventHandler,
  AnswerGenerationMetrics,
  AnswerGenerationRequest,
  LLMProvider,
} from './types.js';

export type GenerationClock = () => number;

function suggestionFor(
  request: AnswerGenerationRequest,
  text: string,
  status: AnswerSuggestion['status'],
  createdAtMs: number,
): AnswerSuggestion {
  return {
    id: `suggestion:${request.requestId}`,
    sessionId: request.sessionId,
    questionId: request.questionId,
    text,
    length: request.length,
    status,
    grounding: request.grounding ?? [],
    createdAtMs,
  };
}

function metricsFor(
  providerId: string,
  requestId: string,
  startedAtMs: number,
  firstTokenAtMs?: number,
  completedAtMs?: number,
): AnswerGenerationMetrics {
  return {
    providerId,
    requestId,
    startedAtMs,
    ...(firstTokenAtMs === undefined
      ? {}
      : {
          firstTokenAtMs,
          timeToFirstTokenMs: Math.max(0, firstTokenAtMs - startedAtMs),
        }),
    ...(completedAtMs === undefined
      ? {}
      : {
          completedAtMs,
          totalDurationMs: Math.max(0, completedAtMs - startedAtMs),
        }),
  };
}

export async function streamAnswerSuggestion(
  provider: LLMProvider,
  request: AnswerGenerationRequest,
  emit: AnswerGenerationEventHandler,
  signal: AbortSignal,
  clock: GenerationClock = () => Date.now(),
): Promise<AnswerSuggestion> {
  const startedAtMs = clock();
  let firstTokenAtMs: number | undefined;
  let text = '';

  const emitSuggestion = (
    status: AnswerSuggestion['status'],
    completedAtMs?: number,
  ): AnswerSuggestion => {
    const suggestion = suggestionFor(request, text, status, startedAtMs);
    emit({
      type: 'suggestion',
      suggestion,
      metrics: metricsFor(
        provider.id,
        request.requestId,
        startedAtMs,
        firstTokenAtMs,
        completedAtMs,
      ),
    });
    return suggestion;
  };

  if (signal.aborted) {
    return emitSuggestion('cancelled', startedAtMs);
  }

  try {
    for await (const event of provider.stream(request, signal)) {
      if (signal.aborted) {
        return emitSuggestion('cancelled', clock());
      }

      switch (event.type) {
        case 'delta': {
          if (!event.text) break;
          if (firstTokenAtMs === undefined) firstTokenAtMs = clock();
          text += event.text;
          emitSuggestion('streaming');
          break;
        }

        case 'completed': {
          return emitSuggestion('complete', clock());
        }

        case 'error': {
          emit({
            type: 'provider-error',
            providerId: provider.id,
            requestId: request.requestId,
            code: event.code,
            message: event.message,
            retryable: event.retryable,
          });
          return emitSuggestion('failed', clock());
        }
      }
    }

    if (signal.aborted) {
      return emitSuggestion('cancelled', clock());
    }

    emit({
      type: 'provider-error',
      providerId: provider.id,
      requestId: request.requestId,
      code: 'provider-stream-ended',
      message: 'The provider stream ended without an explicit completion event.',
      retryable: true,
    });
    return emitSuggestion('failed', clock());
  } catch (error) {
    if (signal.aborted) {
      return emitSuggestion('cancelled', clock());
    }

    const message = error instanceof Error ? error.message : 'Unknown provider failure';
    emit({
      type: 'provider-error',
      providerId: provider.id,
      requestId: request.requestId,
      code: 'provider-exception',
      message,
      retryable: true,
    });
    return emitSuggestion('failed', clock());
  }
}

export class AnswerGenerationCoordinator {
  #active:
    | {
        readonly requestId: string;
        readonly controller: AbortController;
      }
    | undefined;

  get activeRequestId(): string | null {
    return this.#active?.requestId ?? null;
  }

  cancelActive(): void {
    this.#active?.controller.abort();
    this.#active = undefined;
  }

  async start(
    provider: LLMProvider,
    request: AnswerGenerationRequest,
    emit: AnswerGenerationEventHandler,
    clock: GenerationClock = () => Date.now(),
  ): Promise<AnswerSuggestion> {
    this.cancelActive();

    const controller = new AbortController();
    this.#active = {
      requestId: request.requestId,
      controller,
    };

    const guardedEmit: AnswerGenerationEventHandler = (event) => {
      if (this.#active?.requestId === request.requestId) emit(event);
    };

    try {
      return await streamAnswerSuggestion(
        provider,
        request,
        guardedEmit,
        controller.signal,
        clock,
      );
    } finally {
      if (this.#active?.requestId === request.requestId) {
        this.#active = undefined;
      }
    }
  }
}
