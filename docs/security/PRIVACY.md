# Privacy & Security Baseline

## Data classification

Treat the following as sensitive by default:

- microphone/system audio
- transcripts
- CVs and uploaded documents
- job/opportunity notes
- verified stories and personal history
- screenshots/screen context
- provider/API credentials

## Default retention

- Raw audio: do not persist by default.
- Screen captures: transient unless the user explicitly saves them.
- Transcripts/session history: user-controlled retention.
- Documents/profile: retained only to provide requested context and deletable by the user.
- Operational logs: metadata-first; avoid conversation/document contents.

## Desktop security boundaries

Electron renderer code must run with a narrow privilege boundary:

- `contextIsolation: true`
- `nodeIntegration: false`
- expose only typed, minimal preload APIs
- validate every IPC payload
- never expose secrets/provider keys to renderer state
- restrict navigation/new-window behavior
- explicit permission handling for microphone/screen/system audio

## Backend principles

- TLS for all remote traffic.
- Encryption at rest for persistent sensitive records and objects.
- Short-lived authenticated session tokens.
- Rate limiting and abuse controls on costly AI/STT endpoints.
- Server-side authorization for every user-owned resource.
- Signed/short-lived object access rather than public document URLs.
- Secrets managed outside source control.

## AI provider privacy

Each provider adapter must document:

- which data is sent
- retention/training defaults where relevant
- region/data residency options
- whether zero-retention or equivalent modes exist
- expected failure/fallback behavior

A provider fallback must not silently weaken a user's chosen privacy policy.

## User controls

Product design must include:

- delete session
- delete opportunity
- delete document
- clear history
- export user data
- delete account
- visible retention setting

Deletion behavior needs end-to-end tests for database, vector index and object storage paths.

## Threats to explicitly test

- malicious document content attempting prompt injection
- renderer/XSS leading to IPC escalation
- accidental secret logging
- cross-user resource access / IDOR
- transcript/document leakage through analytics
- unbounded audio buffering during network failure
- stale signed URLs
- local cached sensitive data surviving logout/deletion

## Product trust

The UI must never imply stronger privacy guarantees than the implementation provides. Security/privacy copy is a product requirement and should be reviewed with the same rigor as code.
