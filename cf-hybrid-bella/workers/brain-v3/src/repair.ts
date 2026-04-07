/**
 * brain-v3/src/repair.ts — Conversational repair directives
 * Chunk 7 — Layer 7 (Intelligence Layers)
 * Repair is a SOFT override — improvisationBand is set to 'narrow'. When speakText is present in TurnPlan, Prompt Worker uses it directly (mandatory:true path); Gemini has limited latitude only when mandatory is false.
 */

import type { IntentType } from './intent';
import type { ConversationState } from './types';

export interface RepairDirective {
  needed: boolean;
  repairSpeak?: string;
}

export function needsRepair(
  intent: IntentType,
  state: ConversationState,
): RepairDirective {
  if (intent === 'confused') {
    return {
      needed: true,
      repairSpeak: `Let me clarify — ${state.currentStage === 'roi_delivery' ? 'the numbers I just mentioned are based on what you told me about your business' : 'I was asking about your current situation so I can show you something relevant'}.`,
    };
  }

  if (intent === 'off_topic' && state.completedStages.length < 3) {
    return {
      needed: true,
      repairSpeak: `Good point — I want to come back to that. First let me quickly show you something specific to your setup.`,
    };
  }

  return { needed: false };
}
