# Engineering Quality

## Definition of done

A change is not complete because it compiles. For production-facing behavior it should have an explicit acceptance criterion, automated coverage at the appropriate level, observability for meaningful failures, and no regression against privacy/performance budgets.

## Test pyramid

### Unit

Use for deterministic domain behavior: transcript segmentation, question deduplication, retrieval scoring, prompt/context selection, retention policies and transformations.

### Contract

All external provider adapters must be tested against provider-neutral contracts. A vendor swap must not require rewriting domain tests.

### Integration

Cover WebSocket/realtime events, persistence, session lifecycle and provider adapters with recorded/synthetic fixtures rather than paid live calls in normal CI.

### Desktop E2E

Cover preflight, session start/stop, permission/degraded states and streaming UI behavior. OS audio capture needs dedicated macOS/Windows smoke suites because it cannot be validated meaningfully on generic Linux CI.

## Required quality gates

- TypeScript strict mode.
- No unchecked secrets in renderer bundles/logs.
- Unit/contract tests for new domain behavior.
- Deterministic test fixtures for transcript/question scenarios.
- Performance instrumentation for the live path.
- Accessibility checks for setup/review surfaces.
- Dependency/security scanning before production releases.

## Evaluation suites

Traditional tests are insufficient for AI behavior. Maintain versioned datasets for:

- spoken questions with conversational fillers and no punctuation
- follow-up questions
- statements that must not trigger generation
- duplicate/rephrased questions
- questions requiring a verified personal story
- questions where no supporting personal evidence exists
- French/English/code-switching
- technical vocabulary and company/product names

Track precision/recall for question detection and a zero-tolerance metric for invented personal claims.

## Observability

Every live session should expose technical timings without logging sensitive content by default:

- audio_chunk_ready → audio_chunk_sent
- audio_chunk_sent → transcript_partial
- final_transcript → turn_detected
- question_detected → retrieval_complete
- generation_started → first_token
- generation_started → completed/cancelled/failed

Use correlation IDs scoped to sessions and requests. Never put raw CV text, transcripts or API keys into routine logs.

## Review checklist

Before merge, reviewers should ask:

- Does this make the live path slower or more fragile?
- Does it introduce a provider-specific dependency into domain code?
- Does it persist more user data than necessary?
- Is the failure state understandable to a user?
- Is personal experience generated only from evidence?
- Is there a cheaper/simpler design with the same reliability?

## CI evolution

Baseline CI starts with install, typecheck, test and build. Add lint, formatting checks, coverage thresholds, dependency review, secret scanning and artifact smoke tests as the corresponding packages are introduced. Avoid fake green checks that do not exercise real code.
