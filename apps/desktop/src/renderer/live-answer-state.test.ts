import { describe, expect, it } from 'vitest';

import {
  initialLiveAnswerState,
  reduceLiveAnswerEvent,
} from './live-answer-state.js';

function suggestion(
  sessionId: string,
  text: string,
  status: 'streaming' | 'complete' = 'streaming',
): RendererAnswerEvent {
  return {
    type: 'suggestion',
    suggestion: {
      id: 'suggestion-1',
      sessionId,
      questionId: 'question-1',
      text,
      length: 'normal',
      status,
      grounding: [],
      createdAtMs: 1,
    },
    metrics: {
      providerId: 'fake',
      requestId: 'request-1',
      startedAtMs: 1,
    },
  };
}

describe('reduceLiveAnswerEvent', () => {
  it('assembles the latest streamed suggestion for the active session', () => {
    const streaming = reduceLiveAnswerEvent(
      initialLiveAnswerState,
      suggestion('session-1', 'Constructor'),
      'session-1',
    );
    const complete = reduceLiveAnswerEvent(
      streaming,
      suggestion('session-1', 'Constructor injection.', 'complete'),
      'session-1',
    );

    expect(complete).toEqual({
      sessionId: 'session-1',
      questionId: 'question-1',
      text: 'Constructor injection.',
      status: 'complete',
      error: null,
    });
  });

  it('ignores stale suggestions from an older capture session', () => {
    const current = {
      ...initialLiveAnswerState,
      sessionId: 'session-2',
      text: 'Current answer',
      status: 'streaming' as const,
    };

    expect(
      reduceLiveAnswerEvent(current, suggestion('session-1', 'Stale answer'), 'session-2'),
    ).toBe(current);
  });

  it('surfaces active-session runtime failures without leaking stale failures', () => {
    const activeFailure: RendererAnswerEvent = {
      type: 'runtime-error',
      sessionId: 'session-2',
      questionId: 'question-2',
      code: 'provider-unavailable',
      message: 'Provider unavailable',
    };
    const staleFailure: RendererAnswerEvent = {
      ...activeFailure,
      sessionId: 'session-1',
    };

    const failed = reduceLiveAnswerEvent(
      initialLiveAnswerState,
      activeFailure,
      'session-2',
    );

    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Provider unavailable');
    expect(reduceLiveAnswerEvent(failed, staleFailure, 'session-2')).toBe(failed);
  });
});
