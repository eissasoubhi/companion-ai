import { randomUUID } from 'node:crypto';

import type { DetectedQuestion } from '@companion-ai/contracts';

export interface ManualQuestionRequest {
  readonly sessionId: string;
  readonly text: string;
}

export interface ManualQuestionDependencies {
  readonly createId?: () => string;
  readonly now?: () => number;
}

const MAX_MANUAL_QUESTION_LENGTH = 2_000;

export function parseManualQuestionRequest(value: unknown): ManualQuestionRequest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Manual Ask request must be an object.');
  }

  const sessionId = 'sessionId' in value && typeof value.sessionId === 'string'
    ? value.sessionId.trim()
    : '';
  const text = 'text' in value && typeof value.text === 'string'
    ? value.text.trim()
    : '';

  if (!sessionId) throw new Error('Manual Ask requires an active session id.');
  if (!text) throw new Error('Manual Ask text cannot be empty.');
  if (text.length > MAX_MANUAL_QUESTION_LENGTH) {
    throw new Error(`Manual Ask text must be at most ${MAX_MANUAL_QUESTION_LENGTH} characters.`);
  }

  return { sessionId, text };
}

export function createManualQuestion(
  request: ManualQuestionRequest,
  activeSessionId: string | undefined,
  dependencies: ManualQuestionDependencies = {},
): DetectedQuestion {
  if (!activeSessionId || request.sessionId !== activeSessionId) {
    throw new Error('Manual Ask session is not active.');
  }

  const now = dependencies.now ?? Date.now;
  const createId = dependencies.createId ?? randomUUID;

  return {
    id: `manual:${createId()}`,
    sessionId: activeSessionId,
    transcriptSegmentIds: [],
    text: request.text,
    kind: 'general',
    confidence: 1,
    detectedAtMs: now(),
  };
}
