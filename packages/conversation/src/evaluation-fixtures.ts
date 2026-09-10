import type { QuestionKind } from '@companion-ai/contracts';

export interface QuestionFixture {
  readonly id: string;
  readonly text: string;
  readonly expectedQuestion: boolean;
  readonly expectedKind?: QuestionKind;
}

export const questionFixtures: readonly QuestionFixture[] = [
  {
    id: 'en-direct-general',
    text: 'What are you looking for in your next role',
    expectedQuestion: true,
    expectedKind: 'general',
  },
  {
    id: 'en-behavioral-no-punctuation',
    text: 'Tell me about a time you had a conflict with a teammate',
    expectedQuestion: true,
    expectedKind: 'behavioral',
  },
  {
    id: 'en-technical',
    text: 'Could you explain how you have used RabbitMQ in production',
    expectedQuestion: true,
    expectedKind: 'technical',
  },
  {
    id: 'en-indirect',
    text: "So I'd like to understand how you handled that migration",
    expectedQuestion: true,
    expectedKind: 'general',
  },
  {
    id: 'en-tag',
    text: 'That deployment happened during the release window, right?',
    expectedQuestion: true,
    expectedKind: 'general',
  },
  {
    id: 'en-conversational-question-mark',
    text: 'You worked with AWS?',
    expectedQuestion: true,
    expectedKind: 'technical',
  },
  {
    id: 'en-coding',
    text: 'Can you implement a function that finds the first duplicate value',
    expectedQuestion: true,
    expectedKind: 'coding',
  },
  {
    id: 'en-system-design',
    text: 'How would you design a scalable notification system',
    expectedQuestion: true,
    expectedKind: 'system-design',
  },
  {
    id: 'en-negotiation',
    text: "What's your expected salary range",
    expectedQuestion: true,
    expectedKind: 'negotiation',
  },
  {
    id: 'en-recruiter',
    text: 'Why this company and why this role',
    expectedQuestion: true,
    expectedKind: 'recruiter',
  },
  {
    id: 'fr-direct',
    text: 'Comment avez-vous géré cette migration',
    expectedQuestion: true,
    expectedKind: 'general',
  },
  {
    id: 'fr-technical',
    text: 'Pouvez-vous expliquer votre expérience avec Symfony',
    expectedQuestion: true,
    expectedKind: 'technical',
  },
  {
    id: 'fr-behavioral',
    text: 'Donnez-moi un exemple de situation difficile avec votre équipe',
    expectedQuestion: true,
    expectedKind: 'behavioral',
  },
  {
    id: 'fr-indirect',
    text: "J'aimerais comprendre comment vous avez pris cette décision",
    expectedQuestion: true,
    expectedKind: 'general',
  },
  {
    id: 'fr-negotiation',
    text: 'Quelles sont vos prétentions salariales',
    expectedQuestion: true,
    expectedKind: 'negotiation',
  },
  {
    id: 'false-statement',
    text: 'Our team currently uses React and TypeScript',
    expectedQuestion: false,
  },
  {
    id: 'false-feedback',
    text: 'That is a useful example, thank you',
    expectedQuestion: false,
  },
  {
    id: 'false-incomplete-turn',
    text: 'How did you handle the migration and',
    expectedQuestion: false,
  },
  {
    id: 'false-short-how',
    text: 'How',
    expectedQuestion: false,
  },
  {
    id: 'false-short-can',
    text: 'Can',
    expectedQuestion: false,
  },
  {
    id: 'false-fr-statement',
    text: 'Notre équipe utilise Symfony et React',
    expectedQuestion: false,
  },
  {
    id: 'false-fr-incomplete',
    text: 'Comment avez-vous travaillé avec',
    expectedQuestion: false,
  },
  {
    id: 'false-transition',
    text: 'So moving on to the next part',
    expectedQuestion: false,
  },
  {
    id: 'false-acknowledgement',
    text: 'Okay that makes sense',
    expectedQuestion: false,
  },
];
