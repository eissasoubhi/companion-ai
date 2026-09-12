import { useEffect, useMemo, useRef, useState } from 'react';

import {
  startCaptureSession,
  type CaptureSessionHandle,
} from './capture-session.js';
import {
  initialLiveAnswerState,
  reduceLiveAnswerEvent,
} from './live-answer-state.js';
import {
  runMicrophoneDiagnostic,
  type MicrophoneDiagnosticResult,
  type MicrophoneDiagnosticState,
} from './microphone-diagnostic.js';
import {
  runSystemAudioDiagnostic,
  type SystemAudioDiagnosticResult,
  type SystemAudioDiagnosticState,
} from './system-audio-diagnostic.js';

type CheckState = 'pending' | 'checking' | 'ready' | 'blocked' | 'error';
type LiveState = 'idle' | 'starting' | 'live' | 'stopping' | 'error';

interface PreflightCheck {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly state: CheckState;
  readonly detail?: string | undefined;
  readonly action?: string | undefined;
}

function stateLabel(state: CheckState): string {
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'blocked':
      return 'Needs attention';
    case 'error':
      return 'Failed';
    case 'checking':
      return 'Checking…';
    case 'pending':
      return 'Not checked';
  }
}

function microphoneDescription(
  state: MicrophoneDiagnosticState,
  result: MicrophoneDiagnosticResult | null,
): string {
  if (state === 'checking') return 'Opening the microphone and sampling the input…';
  if (result?.deviceLabel) return `${result.deviceLabel} · ${result.message}`;
  return result?.message ?? 'Your side of the conversation';
}

function systemAudioDescription(
  state: SystemAudioDiagnosticState,
  result: SystemAudioDiagnosticResult | null,
): string {
  if (state === 'checking') {
    return 'Choose a source in the macOS sharing picker so remote audio can be verified…';
  }
  return result?.message ?? 'The other side of the conversation';
}

export function App() {
  const [microphoneState, setMicrophoneState] =
    useState<MicrophoneDiagnosticState>('idle');
  const [microphoneResult, setMicrophoneResult] =
    useState<MicrophoneDiagnosticResult | null>(null);
  const [systemAudioState, setSystemAudioState] =
    useState<SystemAudioDiagnosticState>('idle');
  const [systemAudioResult, setSystemAudioResult] =
    useState<SystemAudioDiagnosticResult | null>(null);
  const [networkState, setNetworkState] = useState<CheckState>('pending');
  const [networkResult, setNetworkResult] = useState<NetworkDiagnosticResult | null>(null);
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [liveError, setLiveError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState(initialLiveAnswerState);
  const [manualQuestion, setManualQuestion] = useState('');
  const [manualAskBusy, setManualAskBusy] = useState(false);
  const captureSessionRef = useRef<CaptureSessionHandle | null>(null);

  useEffect(() => {
    if (activeSessionId === null) return undefined;

    return window.companion.answers.onEvent((event) => {
      setAnswerState((current) => reduceLiveAnswerEvent(current, event, activeSessionId));
    });
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      const session = captureSessionRef.current;
      captureSessionRef.current = null;
      if (session) void session.stop();
    };
  }, []);

  const checks = useMemo<readonly PreflightCheck[]>(
    () => [
      {
        id: 'microphone',
        label: 'Microphone',
        description: microphoneDescription(microphoneState, microphoneResult),
        state: microphoneState === 'idle' ? 'pending' : microphoneState,
        detail:
          microphoneResult?.state === 'ready' && microphoneResult.signalDetected === false
            ? 'The device is usable; signal detection is informational and does not block readiness.'
            : undefined,
        action: microphoneResult?.action,
      },
      {
        id: 'system-audio',
        label: 'Remote audio',
        description: systemAudioDescription(systemAudioState, systemAudioResult),
        state: systemAudioState === 'idle' ? 'pending' : systemAudioState,
        detail:
          systemAudioResult?.state === 'blocked' && systemAudioResult.signalDetected === false
            ? 'A live signal is required here because macOS can expose an audio track that contains no usable samples.'
            : undefined,
        action: systemAudioResult?.action,
      },
      {
        id: 'network',
        label: 'Realtime connection',
        description:
          networkState === 'checking'
            ? 'Checking the realtime provider path…'
            : networkResult?.message ?? 'Streaming transcription and suggestions',
        state: networkState,
        detail:
          networkResult?.state === 'ready'
            ? `${networkResult.host}${networkResult.httpStatus === undefined ? '' : ` · HTTP ${networkResult.httpStatus}`}`
            : undefined,
        action: networkResult?.action,
      },
      {
        id: 'context',
        label: 'Interview context',
        description: 'No verified private context loaded; live answers can still run without it.',
        state: 'ready',
        detail: 'Only verified context is eligible for grounding when context import is added.',
      },
    ],
    [
      microphoneResult,
      microphoneState,
      networkResult,
      networkState,
      systemAudioResult,
      systemAudioState,
    ],
  );

  const criticalReady = checks
    .filter((check) => check.id !== 'context')
    .every((check) => check.state === 'ready');
  const isChecking =
    microphoneState === 'checking' || systemAudioState === 'checking' || networkState === 'checking';
  const isLiveBusy = liveState === 'starting' || liveState === 'stopping';

  async function runDiagnostics(): Promise<void> {
    setMicrophoneState('checking');
    setSystemAudioState('checking');
    setNetworkState('checking');
    setMicrophoneResult(null);
    setSystemAudioResult(null);
    setNetworkResult(null);

    const networkPromise = window.companion.network.runDiagnostic();
    const microphone = await runMicrophoneDiagnostic();
    setMicrophoneResult(microphone);
    setMicrophoneState(microphone.state);

    const systemAudio = await runSystemAudioDiagnostic();
    setSystemAudioResult(systemAudio);
    setSystemAudioState(systemAudio.state);

    const network = await networkPromise;
    setNetworkResult(network);
    setNetworkState(network.state);
  }

  async function startLiveSession(): Promise<void> {
    if (!criticalReady || captureSessionRef.current) return;

    setLiveState('starting');
    setLiveError(null);
    setAnswerState(initialLiveAnswerState);

    try {
      const session = await startCaptureSession({
        onDegraded: (source, reason) => {
          captureSessionRef.current = null;
          setActiveSessionId(null);
          setAnswerState(initialLiveAnswerState);
          setManualQuestion('');
          setManualAskBusy(false);

          if (source === 'local') {
            setMicrophoneState('blocked');
            setMicrophoneResult({
              state: 'blocked',
              message: 'Microphone capture stopped during the live session.',
              action: 'Run diagnostics again before restarting the live session.',
            });
          } else {
            setSystemAudioState('blocked');
            setSystemAudioResult({
              state: 'blocked',
              signalDetected: false,
              message: 'Remote audio capture stopped during the live session.',
              action: 'Run diagnostics again and reselect a source with system audio.',
            });
          }

          setLiveError(`${source === 'local' ? 'Microphone' : 'Remote audio'} degraded: ${reason}. Run diagnostics before restarting.`);
          setLiveState('error');
        },
      });
      captureSessionRef.current = session;
      setActiveSessionId(session.sessionId);
      setLiveState('live');
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : 'Unable to start the live session.');
      setLiveState('error');
    }
  }

  async function stopLiveSession(): Promise<void> {
    const session = captureSessionRef.current;
    if (!session || liveState === 'stopping') return;

    captureSessionRef.current = null;
    setLiveState('stopping');
    try {
      await session.stop();
      setLiveState('idle');
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : 'Unable to stop the live session cleanly.');
      setLiveState('error');
    } finally {
      setActiveSessionId(null);
      setAnswerState(initialLiveAnswerState);
      setManualQuestion('');
      setManualAskBusy(false);
    }
  }

  async function askManually(): Promise<void> {
    const sessionId = activeSessionId;
    const text = manualQuestion.trim();
    if (!sessionId || !text || manualAskBusy) return;

    setManualAskBusy(true);
    setLiveError(null);
    try {
      await window.companion.answers.ask({ sessionId, text });
      setManualQuestion('');
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : 'Unable to submit the manual question.');
    } finally {
      setManualAskBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Companion AI</p>
          <h1>{liveState === 'live' ? 'Live session' : 'Preflight'}</h1>
        </div>
        <span className="platform-pill">{window.companion.platform}</span>
      </header>

      {liveState === 'live' ? (
        <>
          <section className="intro" aria-labelledby="live-title">
            <div>
              <h2 id="live-title">Listening for remote questions.</h2>
              <p>
                Microphone and remote audio stay on independent channels. Suggestions stream here
                when a remote question is detected.
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={isLiveBusy}
              onClick={() => void stopLiveSession()}
            >
              Stop session
            </button>
          </section>

          <section className="check-list" aria-live="polite" aria-label="Live answer">
            <article className="check-card">
              <span
                className={`status-dot status-${answerState.status === 'failed' ? 'error' : 'ready'}`}
                aria-hidden="true"
              />
              <div className="check-copy">
                <div className="check-heading">
                  <h3>Suggested answer</h3>
                  <span className="status-label">
                    {answerState.status === 'idle' ? 'Waiting for a question' : answerState.status}
                  </span>
                </div>
                <p>
                  {answerState.text ||
                    'Ask or wait for a remote question. Streaming text will appear here.'}
                </p>
                {answerState.error ? <p className="check-action">{answerState.error}</p> : null}
              </div>
            </article>
          </section>

          <form
            className="footer-actions"
            onSubmit={(event) => {
              event.preventDefault();
              void askManually();
            }}
          >
            <label htmlFor="manual-question">Detector missed it? Ask manually.</label>
            <input
              id="manual-question"
              type="text"
              maxLength={2_000}
              value={manualQuestion}
              disabled={manualAskBusy}
              onChange={(event) => setManualQuestion(event.target.value)}
              placeholder="Type the question you want answered"
            />
            <button
              className="secondary-button"
              type="submit"
              disabled={manualAskBusy || manualQuestion.trim().length === 0}
            >
              {manualAskBusy ? 'Asking…' : 'Ask'}
            </button>
          </form>

          {liveError ? <p className="check-action">{liveError}</p> : null}
        </>
      ) : (
        <>
          <section className="intro" aria-labelledby="preflight-title">
            <div>
              <h2 id="preflight-title">Make sure the live session can hear and help.</h2>
              <p>
                We check the critical path before the conversation starts so failures are
                fixable now, not during an interview.
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={isChecking || isLiveBusy}
              onClick={() => void runDiagnostics()}
            >
              {isChecking ? 'Checking…' : 'Run diagnostics'}
            </button>
          </section>

          <section className="check-list" aria-label="Preflight checks" aria-live="polite">
            {checks.map((check) => (
              <article className="check-card" key={check.id}>
                <span className={`status-dot status-${check.state}`} aria-hidden="true" />
                <div className="check-copy">
                  <div className="check-heading">
                    <h3>{check.label}</h3>
                    <span className={`status-label status-text-${check.state}`}>
                      {stateLabel(check.state)}
                    </span>
                  </div>
                  <p>{check.description}</p>
                  {check.detail ? <p className="check-detail">{check.detail}</p> : null}
                  {check.action ? <p className="check-action">{check.action}</p> : null}
                </div>
              </article>
            ))}
          </section>

          <aside className="privacy-note">
            <strong>Privacy baseline</strong>
            <span>
              Diagnostic audio is sampled locally for readiness checks and raw audio is not stored.
            </span>
          </aside>

          <footer className="footer-actions">
            <p>
              Live start requires microphone, remote audio and realtime connectivity to pass.
              Verified private context is optional until its dedicated import flow exists.
            </p>
            {liveError ? <p className="check-action">{liveError}</p> : null}
            <button
              className="primary-button"
              type="button"
              disabled={!criticalReady || isChecking || isLiveBusy}
              onClick={() => void startLiveSession()}
            >
              {liveState === 'starting' ? 'Starting…' : 'Start live session'}
            </button>
          </footer>
        </>
      )}
    </main>
  );
}
