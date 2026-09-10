type CheckState = 'pending' | 'ready' | 'blocked';

interface PreflightCheck {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly state: CheckState;
}

const checks: readonly PreflightCheck[] = [
  {
    id: 'microphone',
    label: 'Microphone',
    description: 'Your side of the conversation',
    state: 'pending',
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
];

function stateLabel(state: CheckState): string {
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'blocked':
      return 'Needs attention';
    case 'pending':
      return 'Not checked';
  }
}

export function App() {
  const allReady = checks.every((check) => check.state === 'ready');

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
        <button className="secondary-button" type="button" disabled>
          Run diagnostics
        </button>
      </section>

      <section className="check-list" aria-label="Preflight checks">
        {checks.map((check) => (
          <article className="check-card" key={check.id}>
            <span
              className={`status-dot status-${check.state}`}
              aria-hidden="true"
            />
            <div className="check-copy">
              <div className="check-heading">
                <h3>{check.label}</h3>
                <span className={`status-label status-text-${check.state}`}>
                  {stateLabel(check.state)}
                </span>
              </div>
              <p>{check.description}</p>
            </div>
          </article>
        ))}
      </section>

      <aside className="privacy-note">
        <strong>Privacy baseline</strong>
        <span>Raw audio is not stored by default.</span>
      </aside>

      <footer className="footer-actions">
        <p>
          Diagnostics are the next P0 implementation step. The live action remains
          disabled until critical checks pass.
        </p>
        <button className="primary-button" type="button" disabled={!allReady}>
          Start live session
        </button>
      </footer>
    </main>
  );
}
