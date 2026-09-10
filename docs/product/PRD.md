# Product Requirements — V1

## Problem

Professionals preparing for interviews or high-stakes conversations often have useful knowledge scattered across CVs, job descriptions, personal notes and prior conversations. Existing AI copilots tend to either generate generic answers, require too much manual interaction, or produce suggestions that are not sufficiently grounded in the user's real experience.

## V1 promise

Companion AI helps a user prepare for a specific opportunity, understand live questions and surface concise suggestions grounded in approved personal context with very low latency.

## Primary user journey

1. Create an opportunity.
2. Add job description and company context.
3. Import CV and optional documents.
4. Review extracted facts and verified stories.
5. Generate likely questions and prepared answers.
6. Run a short pre-interview warm-up.
7. Start a live session.
8. Receive transcript and grounded suggestions.
9. Review the session and weak areas.
10. Re-practice weak questions.

## Core entities

### Profile
Stable user context: preferences, skills, response style and approved facts.

### Verified Story
A real example with situation, actions, result, evidence/source and tags. Stories can be edited or disabled by the user.

### Opportunity
A role/company-specific workspace containing job description, company context, interview stages, prepared questions and sessions.

### Session
A live or practice conversation with transcript, detected questions, suggestions, metrics and retention settings.

### Prepared Answer
A user-editable answer linked to one or more semantic question intents. Retrieval should be preferred over fresh generation when the fit is strong.

## V1 live capabilities

- Separate microphone and remote/system audio when supported.
- Streaming transcription with partial/final segments.
- Automatic end-of-turn and question detection.
- Manual `Ask` fallback.
- Short, normal and detailed suggestion modes.
- Retrieval-first answer selection.
- Streaming generation when prepared content is insufficient.
- Cancel/regenerate suggestion.
- Keyboard-first controls.
- Clear capture/connection/permission state.

## Grounding policy

Suggestions about personal history must be based on approved profile facts, verified stories, CV content or user-provided documents. The system may restructure or shorten facts but must not invent employers, metrics, responsibilities, projects or outcomes.

For insufficient evidence, the assistant should either:

- give a generic strategy that does not claim personal experience, or
- explicitly mark a detail as something the user should supply.

## UX success criteria

- A new user can reach a working audio diagnostic without reading documentation.
- Starting/stopping a live session is understandable in one glance.
- The user can distinguish remote speech, their own speech and AI suggestions.
- Suggestions are scannable while listening; default output should not resemble an essay.
- Failure states explain the fix, not only the error.

## Product metrics

P0/P1 metrics:

- successful system-audio capture rate by OS/app
- successful microphone capture rate
- transcription lag p50/p95
- detected-question precision/recall on evaluation recordings
- end-of-question → first-token latency p50/p95
- suggestion acceptance/usefulness score
- hallucinated personal-claim rate (target: zero in evaluation suite)
- session crash-free rate

Later funnel metrics:

- opportunity setup completion
- first live session activation
- weekly active users
- practice → live conversion
- 7/30-day retention
- free → paid conversion

## Explicit non-goals for P0/P1

- Full CRM/sales platform.
- Mobile-first live capture.
- Building proprietary foundation models.
- Complex team administration.
- A marketplace of prompts.
- Attempting to bypass proctoring, monitoring or platform restrictions.

## Release gates

P0 exits only when the macOS loop `system audio → STT → question → grounded streamed answer` works reliably across representative scenarios and latency is instrumented.

P1 exits only when a real user can create an opportunity, prepare context, run a complete live session and review it without developer intervention.
