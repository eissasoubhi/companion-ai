import { describe, expect, it } from 'vitest';

import { retrieveVerifiedContext, type VerifiedContextItem } from './index.js';

const items: readonly VerifiedContextItem[] = [
  {
    id: 'redis-story',
    kind: 'verified-story',
    label: 'Redis caching migration',
    text: 'I introduced Redis caching to reduce repeated database reads during a PHP migration.',
    status: 'verified',
    tags: ['php', 'redis', 'performance'],
  },
  {
    id: 'rabbit-story',
    kind: 'verified-story',
    label: 'RabbitMQ retries',
    text: 'I configured RabbitMQ retry and dead-letter handling for asynchronous jobs.',
    status: 'verified',
    tags: ['rabbitmq', 'messaging'],
  },
  {
    id: 'draft-secret',
    kind: 'profile-fact',
    label: 'Unapproved draft',
    text: 'Redis Kubernetes RabbitMQ PHP Symfony performance migration.',
    status: 'draft',
  },
  {
    id: 'archived-secret',
    kind: 'prepared-answer',
    label: 'Archived answer',
    text: 'Redis caching performance.',
    status: 'archived',
  },
];

describe('retrieveVerifiedContext', () => {
  it('returns only verified sources with provenance and relevance score', () => {
    const result = retrieveVerifiedContext('How did you improve PHP performance with Redis?', items);

    expect(result[0]).toMatchObject({
      source: {
        id: 'redis-story',
        kind: 'verified-story',
        label: 'Redis caching migration',
      },
    });
    expect(result[0]?.score).toBeGreaterThan(0);
    expect(result.map((entry) => entry.source.id)).not.toContain('draft-secret');
    expect(result.map((entry) => entry.source.id)).not.toContain('archived-secret');
  });

  it('keeps unrelated verified material out when it misses the threshold', () => {
    const result = retrieveVerifiedContext('Explain frontend accessibility testing', items, {
      maxResults: 4,
      maxCharacters: 4_000,
      minimumScore: 0.3,
    });

    expect(result).toEqual([]);
  });

  it('respects result and character budgets without truncating source text', () => {
    const result = retrieveVerifiedContext('Redis RabbitMQ PHP retries caching', items, {
      maxResults: 2,
      maxCharacters: items[0]!.text.length,
      minimumScore: 0.1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe(items[0]?.text);
  });

  it('uses stable IDs as a deterministic tie-breaker', () => {
    const tied: readonly VerifiedContextItem[] = [
      {
        id: 'b',
        kind: 'profile-fact',
        label: 'Redis',
        text: 'Redis',
        status: 'verified',
      },
      {
        id: 'a',
        kind: 'profile-fact',
        label: 'Redis',
        text: 'Redis',
        status: 'verified',
      },
    ];

    expect(retrieveVerifiedContext('Redis', tied).map((entry) => entry.source.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('rejects invalid budgets and thresholds', () => {
    expect(() =>
      retrieveVerifiedContext('Redis', items, {
        maxResults: 0,
        maxCharacters: 100,
        minimumScore: 0.1,
      }),
    ).toThrow(/maxResults/);

    expect(() =>
      retrieveVerifiedContext('Redis', items, {
        maxResults: 1,
        maxCharacters: 0,
        minimumScore: 0.1,
      }),
    ).toThrow(/maxCharacters/);
  });
});
