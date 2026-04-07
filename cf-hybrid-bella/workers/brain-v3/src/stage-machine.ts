/**
 * brain-v3/src/stage-machine.ts — Stage transition logic
 * Chunk 1 — V3
 *
 * processFlow() advances the stage machine based on the current turn.
 * Returns true if a stage transition occurred.
 */

import type {
  StageId,
  CoreAgent,
  ConversationState,
  AlexRoiInputs,
  ChrisRoiInputs,
  MaddieRoiInputs,
  ResponseSpeedBand,
} from './types';
import { getFact } from './facts';
import { shouldForceAdvance, maxQuestionsReached } from './gate';
import { nextChannelFromQueue } from './queue';
import { computeAlexRoi, computeChrisRoi, computeMaddieRoi } from './roi';

/**
 * Process a turn through the stage machine.
 * Mutates state in place. Returns true if stage advanced.
 */
export function processFlow(
  state: ConversationState,
  utterance: string,
  speakerFlag: 'prospect' | 'bella' | 'unknown',
): boolean {
  let advanced = false;

  // Increment stall counter on every turn (used by WOW gate)
  state.stall++;

  switch (state.currentStage) {
    // ── Greeting ──────────────────────────────────────────────────────
    case 'greeting': {
      if (state.turnIndex > 0 && speakerFlag === 'prospect') {
        state.completedStages.push('greeting');
        state.currentStage = 'wow_1';
        state.wowStep = 1;
        advanced = true;
        console.log('[ADVANCE] greeting → wow_1');
      }
      break;
    }

    // ── WOW Steps ─────────────────────────────────────────────────────
    case 'wow_1': case 'wow_2': case 'wow_3': case 'wow_4':
    case 'wow_5': case 'wow_6': case 'wow_7': case 'wow_8': {
      const currentWow = state.wowStep;

      // WOW 1-2: auto-advance after Bella speaks
      // WOW 3+: advance after prospect reply, BUT gate requires stall >= 3
      const canAdvance = currentWow <= 2
        ? speakerFlag === 'bella'
        : speakerFlag === 'prospect';

      if (!canAdvance) break;

      // Stall gate: minimum 3 turns before advancing past WOW section
      if (currentWow >= 3 && state.stall < 3) {
        console.log(`[WOW_GATE] wow_${currentWow} stall=${state.stall} < 3 — holding`);
        break;
      }

      state.completedStages.push(state.currentStage);
      if (currentWow < 8) {
        state.wowStep = currentWow + 1;
        state.currentStage = `wow_${state.wowStep}` as StageId;
        console.log(`[ADVANCE] wow_${currentWow} → wow_${state.wowStep}`);
      } else {
        state.currentStage = 'recommendation';
        console.log('[ADVANCE] wow_8 → recommendation');
      }
      advanced = true;
      break;
    }

    // ── Recommendation ────────────────────────────────────────────────
    case 'recommendation': {
      if (speakerFlag === 'prospect' && utterance.length > 0) {
        state.completedStages.push('recommendation');
        state.currentStage = 'anchor_acv';
        advanced = true;
        console.log('[ADVANCE] recommendation → anchor_acv');
      }
      break;
    }

    // ── Anchor ACV ────────────────────────────────────────────────────
    case 'anchor_acv': {
      const acv = getFact('acv', state.hotMemory, state.warmFacts);
      // Increment question count on prospect reply (anchor_acv not in STAGE_POLICIES)
      if (speakerFlag === 'prospect') {
        state.questionCounts['anchor_acv'] = (state.questionCounts['anchor_acv'] ?? 0) + 1;
      }
      // Advance if ACV captured OR prospect has replied once (1-question budget)
      if (acv != null || (state.questionCounts['anchor_acv'] ?? 0) >= 1) {
        state.completedStages.push('anchor_acv');
        const firstChannel = nextChannelFromQueue(state);
        state.currentStage = firstChannel;
        advanced = true;
        console.log(`[ADVANCE] anchor_acv → ${firstChannel}${acv == null ? ' (no ACV)' : ''}`);
      }
      break;
    }

    // ── Channel Stages ────────────────────────────────────────────────
    case 'ch_alex':
    case 'ch_chris':
    case 'ch_maddie': {
      if (speakerFlag !== 'prospect' || utterance.length === 0) break;

      const chStage = state.currentStage;
      state.questionCounts[chStage] = (state.questionCounts[chStage] ?? 0) + 1;
      console.log(`[CHANNEL] ${chStage} qCount=${state.questionCounts[chStage]}`);

      const forceAdv = shouldForceAdvance(chStage, state.hotMemory, state.warmFacts);
      const budgetDone = maxQuestionsReached(chStage, state.questionCounts);

      if (forceAdv || budgetDone) {
        // Compute ROI if we have enough data
        if (forceAdv) {
          computeRoiForStage(chStage, state);
        }

        const reason = forceAdv ? 'minimum_data' : 'max_questions';
        state.completedStages.push(chStage);
        const nextStage = nextChannelFromQueue(state);
        state.currentStage = nextStage;
        advanced = true;
        console.log(`[ADVANCE] ${chStage} → ${nextStage} (${reason})`);
      }
      break;
    }

    // ── ROI Delivery ──────────────────────────────────────────────────
    case 'roi_delivery': {
      if (speakerFlag === 'prospect' && utterance.length > 0) {
        state.completedStages.push('roi_delivery');
        state.currentStage = 'optional_side_agents';
        advanced = true;
        console.log('[ADVANCE] roi_delivery → optional_side_agents');
      }
      break;
    }

    // ── Optional Side Agents (Chunk 1 stub) ───────────────────────────
    case 'optional_side_agents': {
      // Chunk 1 stub: auto-advance to close
      state.completedStages.push('optional_side_agents');
      state.currentStage = 'close';
      advanced = true;
      console.log('[ADVANCE] optional_side_agents → close (Chunk 1 stub)');
      break;
    }

    // ── Close ─────────────────────────────────────────────────────────
    case 'close': {
      // Terminal state — no further advancement
      break;
    }
  }

  return advanced;
}

// ─── ROI Computation Helper ─────────────────────────────────────────────────

function computeRoiForStage(stage: StageId, state: ConversationState): void {
  const hot = state.hotMemory;
  const warm = state.warmFacts;

  const acvRaw = getFact('acv', hot, warm);
  const acv = acvRaw != null ? Number(acvRaw) : 0;
  if (acv <= 0) return;

  switch (stage) {
    case 'ch_alex': {
      const leads = Number(getFact('inboundLeads', hot, warm) ?? 0);
      const conv = getFact('inboundConversions', hot, warm);
      const rate = getFact('inboundConversionRate', hot, warm);
      const band = (getFact('responseSpeedBand', hot, warm) ?? 'unknown') as ResponseSpeedBand;

      if (leads > 0) {
        const input: AlexRoiInputs = {
          leads,
          conversions: conv != null ? Number(conv) : null,
          conversionRate: rate != null ? Number(rate) : null,
          responseSpeedBand: band,
          acv,
        };
        state.calculatorResults.alex = computeAlexRoi(input);
        console.log(`[ROI] alex weeklyValue=${state.calculatorResults.alex.weeklyValue}`);
      }
      break;
    }
    case 'ch_chris': {
      const leads = Number(
        getFact('webLeads', hot, warm) ?? getFact('inboundLeads', hot, warm) ?? 0
      );
      const conv = getFact('webConversions', hot, warm) ?? getFact('inboundConversions', hot, warm);
      const rate = getFact('webConversionRate', hot, warm) ?? getFact('inboundConversionRate', hot, warm);

      if (leads > 0) {
        const input: ChrisRoiInputs = {
          leads,
          conversions: conv != null ? Number(conv) : null,
          conversionRate: rate != null ? Number(rate) : null,
          acv,
        };
        state.calculatorResults.chris = computeChrisRoi(input);
        console.log(`[ROI] chris weeklyValue=${state.calculatorResults.chris.weeklyValue}`);
      }
      break;
    }
    case 'ch_maddie': {
      const vol = Number(getFact('phoneVolume', hot, warm) ?? 0);
      const missed = getFact('missedCalls', hot, warm);
      const missedRate = getFact('missedCallRate', hot, warm);

      if (vol > 0) {
        const input: MaddieRoiInputs = {
          phoneVolume: vol,
          missedCalls: missed != null ? Number(missed) : null,
          missedCallRate: missedRate != null ? Number(missedRate) : null,
          acv,
        };
        state.calculatorResults.maddie = computeMaddieRoi(input);
        console.log(`[ROI] maddie weeklyValue=${state.calculatorResults.maddie.weeklyValue}`);
      }
      break;
    }
  }
}
