# UX / UI Direction

## Design goal

The live interface must reduce cognitive load. During a conversation the user is listening, thinking and speaking; Companion AI must therefore behave like an instrument panel, not a dashboard.

## Principles

- **Glanceable:** the important state is understandable in under one second.
- **Progressive:** hide configuration during the live moment.
- **Keyboard-first:** common live actions need shortcuts.
- **Calm:** avoid unnecessary animation, badges and alerts.
- **Trustworthy:** always show what is being captured and whether AI output is grounded/prepared/generated.
- **Recoverable:** permission/network/provider errors must have a clear next action.
- **Accessible:** target WCAG 2.2 AA for web/desktop renderer interactions where applicable.

## Live window hierarchy

```text
┌────────────────────────────────────────────┐
│ ● Listening    Remote ✓   Mic ✓      12:41 │
├────────────────────────────────────────────┤
│ INTERVIEWER                                │
│ How did you handle a difficult migration? │
├────────────────────────────────────────────┤
│ SUGGESTION · VERIFIED STORY                │
│ Start with the Tailor Corner migration…    │
│                                            │
│ • Situation                               │
│ • What you changed                        │
│ • Result                                  │
├────────────────────────────────────────────┤
│ Short  Detailed  Regenerate        Ask ⌘K │
└────────────────────────────────────────────┘
```

## Suggestion layers

Default suggestions should expose information progressively:

1. **Quick answer** — immediately readable opening.
2. **Key points** — 2–4 bullets.
3. **Evidence/example** — which verified story or source supports it.
4. **Expand** — optional richer answer.

Do not render long paragraphs by default.

## Critical states

### Preflight

Must test and explain:

- microphone permission/device
- system audio permission/capture
- selected language
- network/provider readiness
- opportunity/context loaded

The user should see a single `Ready` state only when critical dependencies pass.

### Listening

Show capture state without visual noise. The UI must distinguish remote and local speech.

### Thinking

Use a subtle state. Do not replace useful transcript content with a blocking spinner.

### Suggestion ready

Place the first usable words at a stable screen position to prevent eye chasing while tokens stream.

### Degraded

Examples: system audio unavailable, STT reconnecting, context missing. Keep unaffected features usable.

### Ended

Immediately offer session review while making transcript retention status explicit.

## Accessibility

- Full keyboard navigation outside OS-native drag regions.
- Visible focus indicator.
- Do not encode capture/error state by color alone.
- Respect reduced-motion setting.
- Minimum readable live text size; no tiny metadata competing with suggestions.
- Screen-reader names for controls even if the visual UI uses icons.

## Design system direction

Use semantic tokens rather than hard-coded component colors:

- surface / elevated / overlay
- text-primary / text-secondary / text-muted
- status-ready / status-warning / status-error
- border-default / border-strong
- focus-ring

Support light and dark themes from the beginning. Density should have a compact live mode and a comfortable setup/review mode.

## UX research checkpoints

Before polishing visual style, test five tasks:

1. Can a first-time user fix missing microphone permission?
2. Can they tell whether remote audio is being captured?
3. Can they start a session without reading docs?
4. Can they read a suggestion while continuing to listen?
5. Can they understand why an answer was suggested and what source supports it?
