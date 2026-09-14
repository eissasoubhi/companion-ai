import { describe, expect, it } from 'vitest';

import { transcriptBenchmarkCorpus } from './benchmark-corpus.js';
import {
  assessBenchmarkCorpusReadiness,
  requiredBenchmarkCorpusTags,
} from './benchmark-corpus-readiness.js';

describe('benchmark corpus readiness', () => {
  it('fails closed while noise and accent coverage are still missing', () => {
    const result = assessBenchmarkCorpusReadiness(transcriptBenchmarkCorpus);

    expect(result.ready).toBe(false);
    expect(result.missingTags).toEqual(['background-noise', 'accent-variation']);
    expect(result.reasons).toContain(
      'missing benchmark condition coverage: background-noise',
    );
    expect(result.reasons).toContain(
      'missing benchmark condition coverage: accent-variation',
    );
  });

  it('becomes ready only when all required benchmark conditions are represented', () => {
    const corpus = transcriptBenchmarkCorpus.map((sample, index) => ({
      ...sample,
      tags:
        index === 0
          ? [...sample.tags, 'background-noise']
          : index === 1
            ? [...sample.tags, 'accent-variation']
            : sample.tags,
    }));

    const result = assessBenchmarkCorpusReadiness(corpus);

    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.missingTags).toEqual([]);
    expect(requiredBenchmarkCorpusTags).toEqual([
      'code-switching',
      'background-noise',
      'accent-variation',
      'short-utterance',
      'incomplete-turn',
    ]);
  });

  it('reports structural, language, utterance and technical vocabulary gaps', () => {
    const result = assessBenchmarkCorpusReadiness([
      {
        id: 'only-case',
        locale: 'en',
        kind: 'recruiter',
        reference: 'Tell me about React',
        keyTerms: ['React'],
        tags: [],
      },
    ]);

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('missing locale coverage: fr');
    expect(result.reasons).toContain('missing locale coverage: mixed');
    expect(result.reasons).toContain('missing utterance kind coverage: behavioral');
    expect(result.reasons).toContain('missing utterance kind coverage: technical');
    expect(result.reasons).toContain('missing utterance kind coverage: follow-up');
    expect(result.reasons).toContain('missing utterance kind coverage: incomplete');
    expect(result.reasons).toContain(
      'missing required technical terms: PHP, Symfony, AWS, Docker, Kubernetes, RabbitMQ, CQRS, OAuth, OIDC',
    );
  });

  it('never marks an empty corpus ready', () => {
    const result = assessBenchmarkCorpusReadiness([]);

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('benchmark corpus must not be empty');
  });
});
