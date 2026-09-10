# Architecture

## Objective

Companion AI is a desktop-first real-time conversation system. The first vertical is interview preparation and assistance, but interview-specific behavior must remain outside the reusable live conversation pipeline.

## System boundaries

```text
Desktop client
  ├─ Audio capture
  ├─ Screen context
  ├─ Session UI
  └─ Local permissions / diagnostics
          │
          ▼
Realtime gateway
  ├─ Session orchestration
  ├─ Transcript events
  └─ Answer streaming
          │
   ┌──────┼───────────┐
   ▼      ▼           ▼
STT     Context      LLM
        engine       router
          │
          ▼
PostgreSQL + pgvector
```

## Monorepo target

```text
apps/
  desktop/        Electron + React
  api/            NestJS API/realtime gateway
  web/            public site + account/dashboard (later)
packages/
  contracts/      versioned cross-boundary types/events
  audio/          audio normalization/VAD abstractions
  ai/             LLM/STT/embedding provider interfaces
  context/        retrieval, stories, opportunities
  observability/  metrics/logging helpers
  ui/             reusable design primitives
```

## Live pipeline

1. Capture microphone and system audio as independent channels where supported.
2. Normalize and chunk audio locally.
3. Stream chunks to an STT adapter.
4. Emit partial/final transcript events with source and timestamps.
5. Detect turn boundaries and candidate questions.
6. Retrieve approved/prepared context before generation.
7. Route generation to the appropriate model/provider.
8. Stream suggestions immediately to the desktop client.
9. Persist only the data allowed by the user's retention settings.

## Non-negotiable architecture rules

- Domain code must not depend directly on a specific AI vendor SDK.
- All external providers sit behind interfaces and adapters.
- Transcript events distinguish `user`, `remote`, and `unknown` sources.
- Generated personal claims require supporting context; absent evidence must never be converted into invented experience.
- A stale generation must be cancellable when the conversation moves on.
- The live path must avoid unnecessary database round trips.
- Audio retention defaults to off.
- Provider keys and secrets never cross into the renderer process.

## Performance budgets

Initial engineering targets, to be validated during P0:

- Audio chunk dispatch: p95 < 150 ms after chunk readiness.
- Transcript partial display: p95 < 800 ms behind speech.
- End-of-turn detection: target < 600 ms after actual turn end.
- First visible answer token: target p50 < 1.5 s and p95 < 3 s after detected question completion.
- UI interaction: no blocking task > 100 ms on the renderer main thread.

## Failure strategy

The product must degrade gracefully:

- System audio unavailable → show actionable diagnostics, keep microphone path usable.
- STT disconnect → buffer a bounded amount and reconnect; never buffer indefinitely.
- LLM timeout → allow retry/manual ask without restarting the session.
- Provider degradation → support fallback provider policy later.
- Network loss → preserve local session state and explain which capabilities are offline.

## Decision log

Architectural choices that are expensive to reverse should be recorded under `docs/adr/` before implementation.
