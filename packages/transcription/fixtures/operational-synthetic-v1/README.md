# Operational synthetic STT corpus v1

This fixture set exists to exercise the live operational STT scenarios without sending real interview audio to any provider.

## Provenance

- Audio is synthetic speech generated locally with eSpeak 1.48.15.
- Source phrase: `Hello.`.
- The generated WAV was normalized with FFmpeg 7.1.5 to mono 16 kHz signed 16-bit little-endian PCM.
- The PCM bytes were gzip-compressed and base64-encoded only so the fixture can be stored as text. Runtime hashing is performed on the decoded PCM, not the stored text.
- No user recording, interview recording, credential, or other personal data is present.

Reference generation flow:

```sh
espeak -v en-us -s 250 -w hello.wav 'Hello.'
ffmpeg -i hello.wav -ac 1 -ar 16000 -f s16le hello.pcm
gzip -9 -c hello.pcm | base64 -w0 > pause-before.pcm.gz.b64
sha256sum hello.pcm
```

Decoded PCM SHA-256:

```text
0739a241f17316e1fa97079b5016298f9c5d8f32683d1d22b1681b9cc867c1ce
```

## Scenario mapping

The same verified speech asset is intentionally reused by three case IDs. These are operational timing scenarios, not transcript-accuracy cases:

- `endpoint-en-question`: measure finalization after audio ends.
- `pause-before-en-question`: speech before the controlled natural pause.
- `pause-after-en-question`: speech sent after the pause to prove the stream stayed usable.

Reusing one asset keeps this operational fixture small. The manifest validator only permits path reuse when source, hash, audio format, and storage encoding are identical.

## Live run

After building `@companion-ai/transcription`, and only in an environment where the live provider credentials are intentionally configured:

```sh
pnpm --filter @companion-ai/transcription benchmark:stt:operational \
  packages/transcription/fixtures/operational-synthetic-v1/manifest.json \
  ./operational-results.json \
  operational-synthetic-en-v1-run-001 \
  endpoint-en-question \
  pause-before-en-question \
  pause-after-en-question \
  1200
```

The live CLI still requires the configured Deepgram, AssemblyAI, and OpenAI credentials. Those credentials remain Node-side and are not part of this fixture set.

## Scope limit

This corpus is deliberately enough only for the endpoint/reconnect/false-finalization operational path. It does **not** satisfy the complete provider benchmark in issue #9: accuracy, French, EN/FR code-switching, technical vocabulary breadth, accents, noise, interrupted turns, cost, and residency evidence still need a broader versioned corpus and live measurements.
