import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createVerifiedContextRuntime } from './verified-context-runtime.js';

function writeContext(items: readonly unknown[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'companion-context-runtime-'));
  const filePath = join(directory, 'context.json');
  writeFileSync(filePath, JSON.stringify({ version: 1, items }));
  return filePath;
}

const verified = {
  id: 'verified-1',
  kind: 'profile-fact',
  label: 'Verified fact',
  text: 'A verified fact.',
  status: 'verified',
} as const;

const draft = {
  id: 'draft-1',
  kind: 'profile-fact',
  label: 'Draft fact',
  text: 'A draft fact.',
  status: 'draft',
} as const;

describe('createVerifiedContextRuntime', () => {
  it('reports empty when no context path is configured', () => {
    const runtime = createVerifiedContextRuntime({});
    expect(runtime.status).toMatchObject({ state: 'empty', totalItemCount: 0, verifiedItemCount: 0 });
    expect(runtime.getItems()).toEqual([]);
  });

  it('reports only verified item counts without exposing context text', () => {
    const runtime = createVerifiedContextRuntime({
      COMPANION_VERIFIED_CONTEXT_PATH: writeContext([verified, draft]),
    });

    expect(runtime.status).toEqual({
      state: 'ready',
      totalItemCount: 2,
      verifiedItemCount: 1,
      message: '1 verified context item available for grounding.',
    });
    expect(JSON.stringify(runtime.status)).not.toContain('A verified fact.');
    expect(runtime.getItems()).toHaveLength(2);
  });

  it('keeps a draft-only context non-ready for private grounding', () => {
    const runtime = createVerifiedContextRuntime({
      COMPANION_VERIFIED_CONTEXT_PATH: writeContext([draft]),
    });

    expect(runtime.status).toMatchObject({ state: 'empty', totalItemCount: 1, verifiedItemCount: 0 });
  });

  it('fails closed when configured context is invalid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'companion-context-runtime-'));
    const filePath = join(directory, 'context.json');
    writeFileSync(filePath, '{invalid');

    const runtime = createVerifiedContextRuntime({ COMPANION_VERIFIED_CONTEXT_PATH: filePath });
    expect(runtime.status).toMatchObject({ state: 'error', totalItemCount: 0, verifiedItemCount: 0 });
    expect(() => runtime.getItems()).toThrow('Configured verified context is unavailable.');
  });
});
