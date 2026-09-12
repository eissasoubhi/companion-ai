export interface LiveAnswerState {
  readonly sessionId: string | null;
  readonly questionId: string | null;
  readonly text: string;
  readonly status: 'idle' | 'streaming' | 'complete' | 'cancelled' | 'failed';
  readonly error: string | null;
}

export const initialLiveAnswerState: LiveAnswerState = {
  sessionId: null,
  questionId: null,
  text: '',
  status: 'idle',
  error: null,
};

export function reduceLiveAnswerEvent(
  state: LiveAnswerState,
  event: RendererAnswerEvent,
  activeSessionId: string | null,
): LiveAnswerState {
  if (activeSessionId === null) return state;

  if (event.type === 'suggestion') {
    if (event.suggestion.sessionId !== activeSessionId) return state;

    return {
      sessionId: event.suggestion.sessionId,
      questionId: event.suggestion.questionId,
      text: event.suggestion.text,
      status: event.suggestion.status,
      error: null,
    };
  }

  if (event.type === 'runtime-error') {
    if (event.sessionId !== activeSessionId) return state;

    return {
      ...state,
      sessionId: event.sessionId,
      questionId: event.questionId,
      status: 'failed',
      error: event.message,
    };
  }

  return {
    ...state,
    status: 'failed',
    error: event.message,
  };
}
