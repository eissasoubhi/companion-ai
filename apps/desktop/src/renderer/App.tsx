import { useMemo, useState } from 'react';

import {
  runMicrophoneDiagnostic,
  type MicrophoneDiagnosticResult,
  type MicrophoneDiagnosticState,
} from './microphone-diagnostic.js';

type CheckState = 'pending' | 'checking' | 'ready' | 'blocked' | 'error';

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
  if (state === 'checking') {
    return 'Opening the microphone and sampling the input…';
  }

  if (result?.deviceLabel) {
    return `${result.deviceLabel} · ${result.message}`;
  }

  return result?.message ?? 'Your side of the conversation';
}

export function App() {
  const [microphoneState, setMicrophoneState] =
    useState<MicrophoneDiagnosticState>('idle');
  const [microphoneResult, setMicrophoneResult] =
    useState<MicrophoneDiagnosticResult | null>(null);

  const checks = useMemo<readonly PreflightCheck[]>(
    () => [
      {
        id: 'microphone',
        label: 'Microphone',
        description: microphoneDescription(microphoneState, microphoneResult),
        state: microphoneState === 'idle' ? 'pending' : microphoneState,
        detail:
          microphoneResult?.state === 'ready' &&
          microphoneResult.signalDetected === false
            ? 'The device is usable; signal detection is informational and does not block readiness.'
            : undefined,
        action: microphoneResult?.action,
      },
      {
        id: 'system-audio',
        label: 'Remote audio',
        description: 'The other side of the conversation',
        state: 'pending',
      },
      {
        id: 'network',
        label: 'Realtime connection',
        description: 'Streaming transcription and suggestions',
        state: 'pending',
      },
      {
        id: 'context',
        label: 'Interview context',
        description: 'Opportunity, CV and verified stories',
        state: 'pending',
      },
    ],
    [microphoneResult, microphoneState],
  );

  const allReady = checks.every((check) => check.state === 'ready');
  const isChecking = microphoneState === 'checking';

  async function runDiagnostics(): Promise<void> {
    setMicrophoneState('checking');
    setMicrophoneResult(null);

    const result = await runMicrophoneDiagnostic();
    setMicrophoneResult(result);
    setMicrophoneState(result.state);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Companion AI</p>
          <h1>Preflight</h1>
        </div>
        <span className="platform-pill">{window.companion.platform}</span>
      </header>

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
          disabled={isChecking}
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
        <span>The microphone sample is processed locally and raw audio is not stored.</span>
      </aside>

      <footer className="footer-actions">
        <p>
          Microphone diagnostics are live. Remote audio, realtime connection and
          interview context checks remain P0 work, so live start stays locked until
          the complete path is ready.
        </p>
        <button className="primary-button" type="button" disabled={!allReady}>
          Start live session
        </button>
      </footer>
    </main>
  );
}
