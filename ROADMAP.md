# Companion AI — Roadmap

> Working roadmap. Priorities may move as technical spikes validate or invalidate assumptions.

## Product direction

Build a real-time AI conversation companion, starting with interview preparation and live interview assistance, then expanding to technical meetings, general meetings, sales calls, presentations and other professional conversations.

The product should be useful before, during and after a conversation:

1. **Prepare** — understand the user, opportunity and likely questions.
2. **Assist live** — capture context, transcribe, detect questions and surface grounded suggestions with low latency.
3. **Review** — produce transcripts, summaries, feedback and action items.
4. **Improve** — retain approved knowledge, identify weak areas and drive targeted practice.

## Core principles

- Low latency is a product requirement, not an optimization.
- Never invent personal experience when answering on behalf of the user.
- Prefer retrieval of approved/prepared material before free generation.
- Separate system audio and microphone input where the OS permits it.
- Provider abstraction for STT, LLM, embeddings and storage.
- Privacy by design: minimize retained audio and make session/document deletion straightforward.
- Desktop-first for the live experience.
- Build the smallest reliable vertical slice before SaaS infrastructure.
- Keep interview-specific logic separated from the generic conversation engine.

---

# P0 — Technical feasibility spike

**Goal:** prove the end-to-end live loop on macOS before building the product around it.

## Desktop foundation

- [ ] Initialize monorepo.
- [ ] Electron + React + TypeScript desktop app.
- [ ] Minimal always-on-top companion window.
- [ ] Permission handling for microphone, system audio and screen capture.
- [ ] Device selection and audio diagnostics screen.
- [ ] Basic local logging and debug bundle.

## Audio capture

- [ ] Capture microphone audio independently.
- [ ] Capture system/desktop audio independently.
- [ ] Normalize audio format and chunking.
- [ ] Detect silence / voice activity.
- [ ] Reconnect gracefully after device changes or permission failures.
- [ ] Validate with Google Meet.
- [ ] Validate with Microsoft Teams.
- [ ] Validate with Zoom.
- [ ] Validate with browser media such as YouTube.

## Streaming transcription

- [ ] Define `TranscriptionProvider` interface.
- [ ] Implement first streaming STT provider.
- [ ] Support partial and final transcripts.
- [ ] Keep microphone and system transcripts separated.
- [ ] Timestamp transcript segments.
- [ ] Measure transcription latency.
- [ ] Add provider fallback hooks.

## Live question pipeline

- [ ] Detect end-of-turn.
- [ ] Detect spoken questions without relying on punctuation.
- [ ] Classify question type: general / behavioral / technical / coding / system design / recruiter / negotiation.
- [ ] Define confidence threshold and manual fallback.
- [ ] Prevent repeated generation for the same question.

## Streaming answer generation

- [ ] Define `LLMProvider` interface.
- [ ] Stream answer tokens to the desktop UI.
- [ ] Support short / normal / detailed answer modes.
- [ ] Cancel stale generations when a new question supersedes them.
- [ ] Track time from end-of-question to first visible token.

## P0 exit criteria

P0 is complete only when all of the following work reliably on a real call:

- System audio is captured.
- Microphone audio is captured separately.
- Speech appears as a streaming transcript.
- A spoken question is detected automatically.
- A relevant answer starts streaming without manual copy/paste.
- The flow recovers from temporary network/provider failure.
- Latency is measured and recorded rather than guessed.

---

# P1 — Local MVP / Personal Brain

**Goal:** make the assistant useful for a real interview while keeping the product local-first and single-user.

## Profile Brain

- [ ] User profile/preferences model.
- [ ] Import CV from PDF/DOCX/text.
- [ ] Extract structured experience, skills and projects.
- [ ] Allow corrections to extracted facts.
- [ ] AI persona settings: tone, language, length, vocabulary and response style.
- [ ] Explicit list of claims/facts the AI may use.
- [ ] Explicit list of facts the AI must never fabricate.

## Verified Stories

- [ ] Story editor.
- [ ] STAR-like structure without forcing rigid phrasing.
- [ ] Associate stories with skills, competencies and question types.
- [ ] Mark stories as approved / draft / archived.
- [ ] Semantic retrieval of the most relevant approved story.
- [ ] Show the source story behind a generated suggestion.

## Opportunity model

- [ ] Create an opportunity from role + company + job description.
- [ ] Attach a CV version to an opportunity.
- [ ] Attach notes and documents.
- [ ] Extract role requirements and important keywords.
- [ ] Identify likely interview themes.
- [ ] Track interview stages and previous sessions.

## Document/context engine

- [ ] Parse PDF, DOCX, TXT and Markdown.
- [ ] Chunk and embed documents.
- [ ] Store source provenance for every chunk.
- [ ] Local vector search for MVP or PostgreSQL/pgvector if backend is introduced here.
- [ ] Context budget management.
- [ ] Retrieval ranking based on question + opportunity + user profile.

## Hybrid answer engine

- [ ] Generate likely questions before the interview.
- [ ] Pre-generate candidate answers.
- [ ] Let the user edit/approve prepared answers.
- [ ] Retrieve approved answer first when a close semantic match exists.
- [ ] Fall back to grounded generation when no prepared answer matches.
- [ ] Never present unsupported personal experience as fact.
- [ ] Surface provenance internally for debugging/evaluation.

## 90-second prep

- [ ] Quick pre-interview briefing.
- [ ] Most relevant experiences to remember.
- [ ] Likely questions.
- [ ] Questions to ask the interviewer.
- [ ] Role/company/job-description reminders.
- [ ] One-click transition into live session.

## Live UI

- [ ] Current detected question.
- [ ] Streaming suggestion.
- [ ] Quick / normal / deep answer layers.
- [ ] Expand / shorten / regenerate controls.
- [ ] Keyboard-first operation.
- [ ] Adjustable window size and opacity.
- [ ] Multi-monitor support.
- [ ] Session timer and live status.

## P1 exit criteria

- A user can import a CV and job description.
- The app builds a structured opportunity.
- The user can approve personal stories and prepared answers.
- Live answers use that approved context reliably.
- The system can explain internally which source supported an answer.
- A full interview can run without requiring the user to copy/paste questions.

---

# P2 — Practice, coding and post-session intelligence

**Goal:** close the prepare → live → review → practice loop.

## Mock interviews

- [ ] General interview mode.
- [ ] Recruiter screen mode.
- [ ] Behavioral mode.
- [ ] Technical mode.
- [ ] Coding mode.
- [ ] System design mode.
- [ ] Salary negotiation mode.
- [ ] Dynamic follow-up questions based on the user's previous answer.
- [ ] Adjustable difficulty and seniority.

## Re-drill

- [ ] Detect weak answers from completed sessions.
- [ ] Create targeted practice sets automatically.
- [ ] Compare repeated attempts.
- [ ] Track improvement by competency and question type.

## Screen/context understanding

- [ ] User-triggered screenshot/context capture.
- [ ] Vision extraction for coding/problem statements.
- [ ] Detect visible code/language where possible.
- [ ] Generate approach, complexity and explanation.
- [ ] Keep follow-up conversation linked to the same problem context.

## Developer companion

- [ ] VS Code extension prototype.
- [ ] Send selected code to an active companion session.
- [ ] Add current file/snippet as optional session context.
- [ ] Ask for explanation/review of selected code.
- [ ] Keep coding context separate from personal profile facts.

## Post-session report

- [ ] Transcript.
- [ ] Summary.
- [ ] Questions asked.
- [ ] Suggested vs actually spoken answer distinction where available.
- [ ] Strengths and weak points.
- [ ] Missing or weak examples.
- [ ] Topics to revise.
- [ ] Suggested follow-up questions.
- [ ] Action items.

## Communication coach

- [ ] Speaking-time ratio.
- [ ] Average answer length.
- [ ] Speaking rate.
- [ ] Filler-word statistics.
- [ ] Long-monologue detection.
- [ ] Interruption/overlap metrics where reliable.
- [ ] Conciseness score.
- [ ] Structure score.
- [ ] Clarity score.
- [ ] Trend view across practice sessions.

---

# P3 — SaaS, memory and production desktop

**Goal:** turn the validated local product into a reliable multi-user service.

## Backend platform

- [ ] NestJS API.
- [ ] PostgreSQL.
- [ ] pgvector.
- [ ] Redis for ephemeral session/realtime state where needed.
- [ ] S3-compatible storage.
- [ ] WebSocket realtime gateway.
- [ ] Versioned API contracts shared with desktop/web apps.

## Accounts and auth

- [ ] Registration/login.
- [ ] Email verification.
- [ ] Password reset or passwordless auth.
- [ ] Session/device management.
- [ ] Account deletion/export.

## Cross-session memory

- [ ] Opportunity-level memory.
- [ ] Remember previous interview stages and important facts.
- [ ] Extract candidate memories after sessions.
- [ ] Require explicit confirmation for sensitive/personal facts when appropriate.
- [ ] Editable/deletable memory entries.
- [ ] Retrieve previous interview context in later stages.
- [ ] Avoid accidental memory leakage across unrelated opportunities.

## Provider routing

- [ ] Multiple STT providers.
- [ ] Multiple LLM providers.
- [ ] Model selection by task type.
- [ ] Provider health/fallback logic.
- [ ] Cost and latency telemetry per provider/model.
- [ ] Configurable BYOK mode.

## Billing

- [ ] Stripe integration.
- [ ] Usage accounting.
- [ ] Free/trial allowance.
- [ ] Credit-based option.
- [ ] Subscription option.
- [ ] BYOK-compatible plan.
- [ ] Billing portal.

## Desktop productionization

- [ ] Code signing.
- [ ] macOS notarization.
- [ ] Auto-update.
- [ ] Crash reporting.
- [ ] Structured diagnostics.
- [ ] Safe rollback strategy.
- [ ] Windows capture spike.
- [ ] Windows production support.

## Privacy/security

- [ ] Audio retention disabled by default.
- [ ] Clear transcript retention controls.
- [ ] Encryption in transit and at rest.
- [ ] Per-user data isolation tests.
- [ ] Document/session deletion flows.
- [ ] Data export.
- [ ] Configurable retention policy.
- [ ] Audit security-sensitive backend actions.
- [ ] Document third-party AI/STT data flows.

---

# P4 — Expansion beyond interviews

**Goal:** reuse the conversation engine for broader professional workflows.

## General meeting mode

- [ ] Live transcript.
- [ ] Context-aware Q&A.
- [ ] Meeting summary.
- [ ] Decisions.
- [ ] Action items.
- [ ] People and deadlines.

## Technical meeting mode

- [ ] Architecture/document context.
- [ ] Technical question assistance.
- [ ] Code/context handoff from editor.
- [ ] Decision and follow-up extraction.

## Sales/client mode

- [ ] Account/client context.
- [ ] Objection detection.
- [ ] Suggested talking points.
- [ ] Follow-up email notes.
- [ ] CRM integration exploration.

## Presentation mode

- [ ] Speaker notes/context.
- [ ] Live Q&A assistance.
- [ ] Audience-question capture.
- [ ] Post-presentation feedback.

## Mobile companion

- [ ] Evaluate iOS companion architecture.
- [ ] Remote control for active desktop session.
- [ ] Session notes and prep access.
- [ ] Optional mobile-first practice experience.

---

# Architecture target

```text
apps/
  desktop/        Electron + React
  web/            dashboard / account / prep
  api/            NestJS

packages/
  ai/             LLM routing and prompts
  audio/          capture + normalization contracts
  contracts/      shared schemas/types
  context/        retrieval and grounding
  prompts/        prompt templates and policies
  ui/             shared UI primitives where practical
  config/         shared configuration

infra/
  deployment/
  observability/
```

Avoid premature microservices. Keep clear module boundaries inside a modular backend until scaling or operational constraints justify extraction.

---

# Evaluation framework

The project should ship with repeatable evaluations rather than subjective prompt tweaking.

## Live performance metrics

- End-of-question → first transcript finalization.
- End-of-question → question classification.
- End-of-question → first answer token.
- Full answer generation duration.
- STT reconnect rate.
- Failed session rate.

## Answer-quality metrics

- Factual grounding against approved user context.
- Unsupported personal-claim rate.
- Relevant-story retrieval accuracy.
- Prepared-answer retrieval accuracy.
- Question-type classification accuracy.
- Answer usefulness/relevance rating.
- Conciseness relative to configured answer length.

## Product metrics

- Successful session completion rate.
- Prep → live conversion.
- Live → review completion.
- Re-drill usage.
- Return usage across multiple interview stages.

---

# Non-goals / guardrails

- Do not copy competitor code, trademarks, proprietary assets or pixel-identical interfaces.
- Do not make evasion of proctoring, monitoring or platform restrictions a product feature.
- Do not retain raw audio by default unless a clear product need is validated and the user explicitly opts in.
- Do not fine-tune a model before retrieval, prompting and user-approved memory have been evaluated properly.
- Do not build billing, referral systems or extensive growth infrastructure before P0/P1 feasibility is proven.
- Do not couple core conversation logic to one STT or LLM provider.

---

# Immediate execution order

1. Initialize monorepo and desktop shell.
2. Prove macOS microphone + desktop audio capture.
3. Stream both channels to STT.
4. Build turn/question detection.
5. Stream a generated answer into the desktop window.
6. Add instrumentation and establish real latency baselines.
7. Add CV + opportunity grounding.
8. Add Verified Stories and the no-invention policy.
9. Add prepared-answer retrieval and 90-second prep.
10. Only then expand into mock interviews, screen context and SaaS infrastructure.
