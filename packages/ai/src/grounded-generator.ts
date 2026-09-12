import type { GroundingSource } from '@companion-ai/contracts';
import {
  retrieveVerifiedContext,
  type VerifiedContextItem,
  type VerifiedContextRetrievalConfig,
} from '@companion-ai/grounding';

import { AnswerGenerationCoordinator, type GenerationClock } from './generator.js';
import type {
  AnswerGenerationEventHandler,
  AnswerGenerationRequest,
  LLMProvider,
} from './types.js';

export interface GroundedAnswerGenerationRequest
  extends Omit<AnswerGenerationRequest, 'grounding' | 'groundingContext'> {
  readonly contextItems: readonly VerifiedContextItem[];
  readonly retrievalConfig?: VerifiedContextRetrievalConfig | undefined;
}

export interface GroundedAnswerGenerationResult {
  readonly request: AnswerGenerationRequest;
  readonly grounding: readonly GroundingSource[];
}

export function buildVerifiedAnswerRequest(
  input: GroundedAnswerGenerationRequest,
): GroundedAnswerGenerationResult {
  const { contextItems, retrievalConfig, ...baseRequest } = input;
  const retrieved = retrieveVerifiedContext(
    input.question,
    contextItems,
    retrievalConfig,
  );
  const grounding = retrieved.map((entry) => entry.source);

  return {
    request: {
      ...baseRequest,
      grounding,
      groundingContext: retrieved.map((entry) => ({
        source: entry.source,
        text: entry.text,
      })),
    },
    grounding,
  };
}

/**
 * P0 boundary joining verified retrieval to provider-neutral streaming generation.
 * Only text returned by @companion-ai/grounding is allowed into provider context.
 */
export class VerifiedAnswerGenerationCoordinator {
  readonly #generation = new AnswerGenerationCoordinator();

  get activeRequestId(): string | null {
    return this.#generation.activeRequestId;
  }

  cancelActive(): void {
    this.#generation.cancelActive();
  }

  async start(
    provider: LLMProvider,
    input: GroundedAnswerGenerationRequest,
    emit: AnswerGenerationEventHandler,
    clock?: GenerationClock,
  ) {
    const { request } = buildVerifiedAnswerRequest(input);
    return this.#generation.start(provider, request, emit, clock);
  }
}
