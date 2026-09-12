import type {
  AnswerSuggestion,
  GroundingSource,
  SuggestionLength,
} from '@companion-ai/contracts';

export interface GroundingContextSnippet {
  readonly source: GroundingSource;
  readonly text: string;
}

export interface AnswerGenerationRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly questionId: string;
  readonly question: string;
  readonly length: SuggestionLength;
  readonly grounding?: readonly GroundingSource[] | undefined;
  readonly groundingContext?: readonly GroundingContextSnippet[] | undefined;
  readonly instructions?: string | undefined;
}

export interface LLMDeltaEvent {
  readonly type: 'delta';
  readonly text: string;
}

export interface LLMCompletedEvent {
  readonly type: 'completed';
  readonly finishReason: 'stop' | 'length' | 'content-filter' | 'unknown';
}

export interface LLMErrorEvent {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type LLMProviderEvent = LLMDeltaEvent | LLMCompletedEvent | LLMErrorEvent;

export interface LLMProvider {
  readonly id: string;
  stream(
    request: AnswerGenerationRequest,
    signal: AbortSignal,
  ): AsyncIterable<LLMProviderEvent>;
}

export interface AnswerGenerationMetrics {
  readonly providerId: string;
  readonly requestId: string;
  readonly startedAtMs: number;
  readonly firstTokenAtMs?: number | undefined;
  readonly completedAtMs?: number | undefined;
  readonly timeToFirstTokenMs?: number | undefined;
  readonly totalDurationMs?: number | undefined;
}

export type AnswerGenerationEvent =
  | {
      readonly type: 'suggestion';
      readonly suggestion: AnswerSuggestion;
      readonly metrics: AnswerGenerationMetrics;
    }
  | {
      readonly type: 'provider-error';
      readonly providerId: string;
      readonly requestId: string;
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    };

export type AnswerGenerationEventHandler = (event: AnswerGenerationEvent) => void;
