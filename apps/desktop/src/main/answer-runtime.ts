import {
  VerifiedAnswerGenerationCoordinator,
  type AnswerGenerationEvent,
  type GroundedAnswerGenerationRequest,
  type LLMProvider,
} from '@companion-ai/ai';
import type { DetectedQuestion } from '@companion-ai/contracts';

export type AnswerRuntimeEvent =
  | AnswerGenerationEvent
  | {
      readonly type: 'runtime-error';
      readonly sessionId: string;
      readonly questionId: string;
      readonly code: string;
      readonly message: string;
    };

export interface AnswerRuntimeDependencies {
  readonly createProvider: () => LLMProvider;
  readonly getContextItems: () => GroundedAnswerGenerationRequest['contextItems'];
  readonly emit: (event: AnswerRuntimeEvent) => void;
  readonly createRequestId?: (question: DetectedQuestion) => string;
}

/**
 * Main-process boundary for the P0 question -> verified context -> streaming answer loop.
 * Provider credentials and raw verified context never cross into the renderer.
 */
export class AnswerRuntime {
  readonly #coordinator = new VerifiedAnswerGenerationCoordinator();
  readonly #dependencies: AnswerRuntimeDependencies;
  #requestSequence = 0;

  constructor(dependencies: AnswerRuntimeDependencies) {
    this.#dependencies = dependencies;
  }

  async handleQuestion(question: DetectedQuestion): Promise<void> {
    let provider: LLMProvider;
    try {
      provider = this.#dependencies.createProvider();
    } catch (error) {
      this.#dependencies.emit({
        type: 'runtime-error',
        sessionId: question.sessionId,
        questionId: question.id,
        code: 'provider-unavailable',
        message: error instanceof Error ? error.message : 'Answer provider is unavailable.',
      });
      return;
    }

    const requestId =
      this.#dependencies.createRequestId?.(question) ??
      `answer:${question.sessionId}:${++this.#requestSequence}`;

    try {
      await this.#coordinator.start(
        provider,
        {
          requestId,
          sessionId: question.sessionId,
          questionId: question.id,
          question: question.text,
          length: 'normal',
          contextItems: this.#dependencies.getContextItems(),
        },
        this.#dependencies.emit,
      );
    } catch (error) {
      this.#dependencies.emit({
        type: 'runtime-error',
        sessionId: question.sessionId,
        questionId: question.id,
        code: 'generation-runtime-error',
        message: error instanceof Error ? error.message : 'Answer generation failed.',
      });
    }
  }

  stop(): void {
    this.#coordinator.cancelActive();
  }
}
