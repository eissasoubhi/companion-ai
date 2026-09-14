import type { VerifiedContextItem } from '@companion-ai/grounding';

import { loadVerifiedContextFromEnv } from './verified-context.js';

export type VerifiedContextRuntimeStatus = {
  readonly state: 'ready' | 'empty' | 'error';
  readonly totalItemCount: number;
  readonly verifiedItemCount: number;
  readonly message: string;
  readonly action?: string | undefined;
};

export type VerifiedContextRuntime = {
  readonly status: VerifiedContextRuntimeStatus;
  readonly getItems: () => readonly VerifiedContextItem[];
};

export function createVerifiedContextRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): VerifiedContextRuntime {
  try {
    const items = loadVerifiedContextFromEnv(environment);
    const verifiedItemCount = items.filter((item) => item.status === 'verified').length;

    if (items.length === 0) {
      return {
        status: {
          state: 'empty',
          totalItemCount: 0,
          verifiedItemCount: 0,
          message: 'No private interview context is configured.',
        },
        getItems: () => items,
      };
    }

    if (verifiedItemCount === 0) {
      return {
        status: {
          state: 'empty',
          totalItemCount: items.length,
          verifiedItemCount: 0,
          message: 'Context is loaded, but no items are verified for grounding.',
          action: 'Mark at least one context item as verified before relying on private grounding.',
        },
        getItems: () => items,
      };
    }

    return {
      status: {
        state: 'ready',
        totalItemCount: items.length,
        verifiedItemCount,
        message: `${verifiedItemCount} verified context item${verifiedItemCount === 1 ? '' : 's'} available for grounding.`,
      },
      getItems: () => items,
    };
  } catch {
    return {
      status: {
        state: 'error',
        totalItemCount: 0,
        verifiedItemCount: 0,
        message: 'Configured private interview context could not be loaded safely.',
        action: 'Fix or remove COMPANION_VERIFIED_CONTEXT_PATH, then restart Companion AI.',
      },
      getItems: () => {
        throw new Error('Configured verified context is unavailable.');
      },
    };
  }
}
