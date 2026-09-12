export type BenchmarkLocale = 'en' | 'fr' | 'mixed';

export type BenchmarkUtteranceKind =
  | 'recruiter'
  | 'behavioral'
  | 'technical'
  | 'follow-up'
  | 'incomplete';

export interface TranscriptBenchmarkCorpusCase {
  readonly id: string;
  readonly locale: BenchmarkLocale;
  readonly kind: BenchmarkUtteranceKind;
  readonly reference: string;
  readonly keyTerms: readonly string[];
  readonly tags: readonly string[];
}

export const requiredTechnicalTerms = [
  'PHP',
  'Symfony',
  'React',
  'AWS',
  'Docker',
  'Kubernetes',
  'RabbitMQ',
  'CQRS',
  'OAuth',
  'OIDC',
] as const;

export const transcriptBenchmarkCorpus = [
  {
    id: 'en-recruiter-stack',
    locale: 'en',
    kind: 'recruiter',
    reference: 'Can you walk me through your experience with Symfony and React',
    keyTerms: ['Symfony', 'React'],
    tags: ['interview', 'recruiter', 'technical-vocabulary'],
  },
  {
    id: 'en-behavioral-incident',
    locale: 'en',
    kind: 'behavioral',
    reference: 'Tell me about a time you handled a production incident under pressure',
    keyTerms: [],
    tags: ['interview', 'behavioral'],
  },
  {
    id: 'fr-recruiter-parcours',
    locale: 'fr',
    kind: 'recruiter',
    reference: 'Pouvez-vous me présenter votre parcours avec PHP et Symfony',
    keyTerms: ['PHP', 'Symfony'],
    tags: ['interview', 'recruiter', 'technical-vocabulary'],
  },
  {
    id: 'fr-behavioral-desaccord',
    locale: 'fr',
    kind: 'behavioral',
    reference: "Parlez-moi d'une situation où vous avez dû gérer un désaccord dans l'équipe",
    keyTerms: [],
    tags: ['interview', 'behavioral'],
  },
  {
    id: 'mixed-architecture-messaging',
    locale: 'mixed',
    kind: 'technical',
    reference: 'How would you design une architecture avec RabbitMQ CQRS et OAuth OIDC',
    keyTerms: ['RabbitMQ', 'CQRS', 'OAuth', 'OIDC'],
    tags: ['interview', 'technical', 'code-switching', 'technical-vocabulary'],
  },
  {
    id: 'en-cloud-deployment',
    locale: 'en',
    kind: 'technical',
    reference: 'How would you deploy a Docker service on AWS with Kubernetes',
    keyTerms: ['Docker', 'AWS', 'Kubernetes'],
    tags: ['interview', 'technical', 'technical-vocabulary'],
  },
  {
    id: 'fr-authentication',
    locale: 'fr',
    kind: 'technical',
    reference: "Quelle est la différence entre OAuth et OIDC pour l'authentification",
    keyTerms: ['OAuth', 'OIDC'],
    tags: ['interview', 'technical', 'technical-vocabulary'],
  },
  {
    id: 'en-follow-up-outcome',
    locale: 'en',
    kind: 'follow-up',
    reference: 'And what changed after that',
    keyTerms: [],
    tags: ['interview', 'follow-up', 'short-utterance'],
  },
  {
    id: 'fr-follow-up-metrics',
    locale: 'fr',
    kind: 'follow-up',
    reference: "Et ensuite qu'est-ce que vous avez mesuré",
    keyTerms: [],
    tags: ['interview', 'follow-up', 'short-utterance'],
  },
  {
    id: 'mixed-incomplete-migration',
    locale: 'mixed',
    kind: 'incomplete',
    reference: 'So when you migrated from Symfony five to',
    keyTerms: ['Symfony'],
    tags: ['interview', 'code-switching', 'incomplete-turn'],
  },
] as const satisfies readonly TranscriptBenchmarkCorpusCase[];

export interface BenchmarkCorpusCoverage {
  readonly totalCases: number;
  readonly locales: Readonly<Record<BenchmarkLocale, number>>;
  readonly kinds: Readonly<Record<BenchmarkUtteranceKind, number>>;
  readonly coveredTechnicalTerms: readonly string[];
  readonly missingTechnicalTerms: readonly string[];
}

export function summarizeBenchmarkCorpusCoverage(
  corpus: readonly TranscriptBenchmarkCorpusCase[],
): BenchmarkCorpusCoverage {
  const locales: Record<BenchmarkLocale, number> = { en: 0, fr: 0, mixed: 0 };
  const kinds: Record<BenchmarkUtteranceKind, number> = {
    recruiter: 0,
    behavioral: 0,
    technical: 0,
    'follow-up': 0,
    incomplete: 0,
  };
  const covered = new Set<string>();

  for (const sample of corpus) {
    locales[sample.locale] += 1;
    kinds[sample.kind] += 1;
    for (const term of sample.keyTerms) {
      covered.add(term.toLocaleLowerCase('en-US'));
    }
  }

  const coveredTechnicalTerms = requiredTechnicalTerms.filter((term) =>
    covered.has(term.toLocaleLowerCase('en-US')),
  );
  const missingTechnicalTerms = requiredTechnicalTerms.filter(
    (term) => !covered.has(term.toLocaleLowerCase('en-US')),
  );

  return {
    totalCases: corpus.length,
    locales,
    kinds,
    coveredTechnicalTerms,
    missingTechnicalTerms,
  };
}

export function validateBenchmarkCorpus(
  corpus: readonly TranscriptBenchmarkCorpusCase[],
): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const sample of corpus) {
    if (sample.id.trim().length === 0) {
      errors.push('case id must not be empty');
    } else if (ids.has(sample.id)) {
      errors.push(`duplicate case id: ${sample.id}`);
    } else {
      ids.add(sample.id);
    }

    if (sample.reference.trim().length === 0) {
      errors.push(`${sample.id || '<empty-id>'}: reference must not be empty`);
    }

    const normalizedReference = sample.reference.toLocaleLowerCase('en-US');
    for (const term of sample.keyTerms) {
      if (term.trim().length === 0) {
        errors.push(`${sample.id || '<empty-id>'}: key term must not be empty`);
      } else if (!normalizedReference.includes(term.toLocaleLowerCase('en-US'))) {
        errors.push(`${sample.id || '<empty-id>'}: key term not present in reference: ${term}`);
      }
    }
  }

  return errors;
}
