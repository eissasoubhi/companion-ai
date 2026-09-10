# ADR 001 — Desktop audio capture strategy

Status: accepted for P0 spike

## Context

Companion AI needs two logically independent audio channels whenever the operating system allows it:

- local microphone audio
- remote/system audio

Treating them separately reduces speaker-attribution ambiguity and gives the transcription pipeline a stable source label.

## Decision

Use platform-specific capture adapters behind one product-level audio contract instead of assuming a single Electron capture mechanism behaves the same across operating systems.

### macOS

- Target macOS 13+ for the first system-audio implementation.
- Use the Electron/Chromium desktop capture path backed by modern macOS audio APIs.
- Include `NSAudioCaptureUsageDescription` for macOS 14.2+ and `NSMicrophoneUsageDescription` in packaged builds.
- Preflight must validate that samples contain a usable signal; stream creation alone is not sufficient because permission/configuration failures can yield a dead audio stream without a useful runtime error.
- Do not depend on Electron's string `loopback` display-media option for macOS; that option is Windows-specific.

### Windows

- Implement the Windows adapter after the macOS P0 path is proven.
- Electron's supported loopback capture can be evaluated first; native WASAPI remains an escape hatch only if product reliability requires it.

### Older macOS

macOS versions before 13 are outside the first system-audio support target because reliable native desktop-audio capture would require a materially different approach such as a virtual audio device.

## UX consequence

The UI exposes capabilities, not implementation details. `Remote audio` can be `ready`, `blocked`, `unsupported`, or `failed`, with an actionable remediation message. A microphone-only session may remain useful later, but interview live mode must not present full readiness when the remote channel is unavailable.

## Privacy consequence

Capture is transient by default. The live pipeline may stream audio to the configured transcription provider, but raw audio is not persisted unless a future explicit user-controlled recording feature is introduced.

## Follow-up validation

P0 manual matrix:

1. Browser media playback
2. Google Meet
3. Microsoft Teams
4. Zoom
5. device/output changes during an active session
6. permission denied → permission restored → application restart path
