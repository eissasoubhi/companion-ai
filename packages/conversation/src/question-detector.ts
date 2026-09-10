import type { QuestionKind } from '@companion-ai/contracts';

export interface QuestionDetectionConfig {
  readonly threshold: number;
  readonly minimumWords: number;
}

export interface QuestionDetection {
  readonly isQuestion: boolean;
  readonly confidence: number;
  readonly kind: QuestionKind;
  readonly reasons: readonly string[];
}

export const defaultQuestionDetectionConfig: QuestionDetectionConfig = {
  threshold: 0.62,
  minimumWords: 2,
};

const directQuestionPatterns: readonly RegExp[] = [
  /^(what|why|how|when|where|who|which|whose)\b/i,
  /^(can|could|would|will|do|does|did|have|has|had|are|is|was|were|should|may|might)\b/i,
  /^(tell me|walk me through|describe|explain|give me an example|talk me through)\b/i,
  /^(qu(?:e|’|')est-ce|pourquoi|comment|quand|où|qui|quel(?:le)?s?)\b/i,
  /^(peux-tu|pouvez-vous|pourrais-tu|pourriez-vous|as-tu|avez-vous|est-ce que)\b/i,
  /^(parle-moi|parlez-moi|décris|décrivez|explique|expliquez|donne-moi|donnez-moi)\b/i,
];

const indirectQuestionPatterns: readonly RegExp[] = [
  /\b(?:i(?:['’]d| would) like to (?:know|understand|hear)|i(?:['’]m| am) curious (?:about|to know)|i wonder)\b/i,
  /\b(?:j['’]aimerais (?:savoir|comprendre)|je voudrais (?:savoir|comprendre)|je me demande)\b/i,
];

const incompletePatterns: readonly RegExp[] = [
  /\b(?:and|or|but|because|so|with|about|for|to)$/i,
  /\b(?:et|ou|mais|parce que|donc|avec|sur|pour|de)$/i,
];

const kindPatterns: readonly [QuestionKind, readonly RegExp[]][] = [
  [
    'coding',
    [
      /\b(code|coding|algorithm|leetcode|complexity|big[- ]?o|data structure|implement|function)\b/i,
      /\b(coder|algorithme|complexité|structure de données|implémenter|fonction)\b/i,
    ],
  ],
  [
    'system-design',
    [
      /\b(system design|architecture|scalab(?:le|ility)|distributed system|high availability|load balanc)/i,
      /\b(conception système|architecture|scalabilité|système distribué|haute disponibilité)/i,
    ],
  ],
  [
    'negotiation',
    [
      /\b(salary|compensation|pay range|expected pay|offer|negotiat)/i,
      /\b(salaire|rémunération|prétentions salariales|fourchette|négoci)/i,
    ],
  ],
  [
    'behavioral',
    [
      /\b(tell me about a time|give me an example|conflict|failure|failed|challenge|difficult situation|leadership|feedback)\b/i,
      /\b(parle(?:z)?-moi d(?:'|’)une fois|donne(?:z)?-moi un exemple|conflit|échec|difficulté|situation difficile|leadership|retour)\b/i,
    ],
  ],
  [
    'recruiter',
    [
      /\b(why (?:this|our) (?:company|role)|why are you leaving|notice period|availability|relocat|work authorization)\b/i,
      /\b(pourquoi (?:ce|notre) (?:poste|entreprise)|disponibilit|préavis|mobilité|autorisation de travail)\b/i,
    ],
  ],
  [
    'technical',
    [
      /\b(api|database|framework|react|vue|angular|php|symfony|java|python|typescript|javascript|sql|aws|docker|kubernetes|cache|queue|rabbitmq|redis|testing|ci\/cd)\b/i,
      /\b(base de données|framework|test|déploiement|mise en cache|file de messages)\b/i,
    ],
  ],
];

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(2))));
}

export function classifyQuestionKind(text: string): QuestionKind {
  for (const [kind, patterns] of kindPatterns) {
    if (patterns.some((pattern) => pattern.test(text))) {
      return kind;
    }
  }

  return 'general';
}

export function detectQuestion(
  rawText: string,
  config: QuestionDetectionConfig = defaultQuestionDetectionConfig,
): QuestionDetection {
  const text = rawText.trim();
  const words = text.split(/\s+/u).filter(Boolean);
  const reasons: string[] = [];
  let confidence = 0.08;

  if (text.endsWith('?')) {
    confidence += 0.55;
    reasons.push('question-mark');
  }

  if (directQuestionPatterns.some((pattern) => pattern.test(text))) {
    confidence += 0.58;
    reasons.push('direct-question-form');
  }

  if (indirectQuestionPatterns.some((pattern) => pattern.test(text))) {
    confidence += 0.58;
    reasons.push('indirect-question-form');
  }

  if (/\b(?:right|correct|isn(?:'t|’t) it|don(?:'t|’t) you|n'est-ce pas|d'accord)\??$/i.test(text)) {
    confidence += 0.42;
    reasons.push('tag-question');
  }

  if (words.length < config.minimumWords) {
    confidence -= 0.28;
    reasons.push('too-short');
  }

  if (incompletePatterns.some((pattern) => pattern.test(text))) {
    confidence -= 0.3;
    reasons.push('likely-incomplete-turn');
  }

  const normalizedConfidence = clampConfidence(confidence);

  return {
    isQuestion: normalizedConfidence >= config.threshold,
    confidence: normalizedConfidence,
    kind: classifyQuestionKind(text),
    reasons,
  };
}
