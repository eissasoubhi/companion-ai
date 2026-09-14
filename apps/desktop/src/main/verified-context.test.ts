import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadVerifiedContextFromEnv,
  loadVerifiedContextFromFile,
  parseVerifiedContextDocument,
} from './verified-context.js';

function validDocument() {
  return {
    version: 1,
    items: [
      {
        id: 'story-idgarages',
        kind: 'verified-story',
        label: 'IDGARAGES migration',
        text: 'Migrated a PHP stack while keeping delivery incremental.',
        status: 'verified',
        tags: ['php', 'migration'],
      },
      {
        id: 'draft-note',
        kind: 'profile-fact',
        label: 'Draft note',
        text: 'This remains unverified and must be filtered by grounding retrieval.',
        status: 'draft',
      },
    ],
  };
}

describe('verified context loading', () => {
  it('parses bounded verified-context documents without promoting draft content', () => {
    expect(parseVerifiedContextDocument(validDocument())).toEqual(validDocument());
  });

  it('normalizes surrounding whitespace on controlled text fields', () => {
    const parsed = parseVerifiedContextDocument({
      version: 1,
      items: [
        {
          id: '  item-1  ',
          kind: 'cv',
          label: '  CV  ',
          text: '  Symfony experience  ',
          status: 'verified',
          tags: ['  symfony  '],
        },
      ],
    });

    expect(parsed.items[0]).toEqual({
      id: 'item-1',
      kind: 'cv',
      label: 'CV',
      text: 'Symfony experience',
      status: 'verified',
      tags: ['symfony'],
    });
  });

  it('rejects duplicate IDs, unsupported kinds and unsupported statuses', () => {
    expect(() =>
      parseVerifiedContextDocument({
        version: 1,
        items: [validDocument().items[0], validDocument().items[0]],
      }),
    ).toThrow(/duplicate item IDs/i);

    expect(() =>
      parseVerifiedContextDocument({
        version: 1,
        items: [{ ...validDocument().items[0], kind: 'secret' }],
      }),
    ).toThrow(/kind is not supported/i);

    expect(() =>
      parseVerifiedContextDocument({
        version: 1,
        items: [{ ...validDocument().items[0], status: 'trusted-ish' }],
      }),
    ).toThrow(/status is not supported/i);
  });

  it('rejects oversized documents before reading their contents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'companion-context-'));
    const filePath = join(directory, 'context.json');
    writeFileSync(filePath, JSON.stringify(validDocument()));

    expect(() => loadVerifiedContextFromFile(filePath, 8)).toThrow(/byte limit/i);
  });

  it('loads from an explicit main-process environment path and defaults to no context', () => {
    const directory = mkdtempSync(join(tmpdir(), 'companion-context-'));
    const filePath = join(directory, 'context.json');
    writeFileSync(filePath, JSON.stringify(validDocument()));

    expect(loadVerifiedContextFromEnv({ COMPANION_VERIFIED_CONTEXT_PATH: filePath })).toHaveLength(2);
    expect(loadVerifiedContextFromEnv({})).toEqual([]);
  });

  it('fails closed on malformed JSON instead of accepting partial context', () => {
    const directory = mkdtempSync(join(tmpdir(), 'companion-context-'));
    const filePath = join(directory, 'context.json');
    writeFileSync(filePath, '{"version":1,"items":[');

    expect(() => loadVerifiedContextFromFile(filePath)).toThrow(/not valid JSON/i);
  });
});
