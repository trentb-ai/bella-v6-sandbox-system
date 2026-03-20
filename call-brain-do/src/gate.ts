/**
 * call-brain-do/src/gate.ts — v2.0.0-do-alpha.1
 * Stage gating, advancement, and queue building.
 * Ported from bridge lines ~396-565, tightened to 9-stall WOW.
 */

import type { CallBrainState, Stage, ChannelStage } from './types';

// ─── Gate: can the current stage advance? ────────────────────────────────────

export function gateOpen(state: CallBrainState): boolean {
  const { stage, extracted: e, wowStall, flags } = state;
  switch (stage) {
    case 'wow':              return wowStall >= 10; // 9 stalls, gate at 10
    case 'anchor_acv':       return e.acv !== null;
    case 'anchor_timeframe': return e.timeframe !== null;
    case 'ch_website':       return e.web_leads !== null && e.web_conversions !== null;
    case 'ch_ads':           return e.ads_leads !== null && e.ads_conversions !== null;
    case 'ch_phone':         return e.phone_volume !== null && e.missed_call_handling !== null;
    case 'ch_old_leads':     return e.old_leads !== null;
    case 'ch_reviews':       return e.new_customers !== null && e.has_review_system !== null;
    case 'roi_delivery':     return flags.roiDelivered;
    case 'close':            return false; // terminal
  }
}

// ─── Advance: move to next stage ─────────────────────────────────────────────

export function advance(state: CallBrainState): void {
  state.completedStages.push(state.stage);
  state.wowStall = 0;

  // Just Demo — skip remaining channel stages, go to roi_delivery
  if (state.flags.justDemo && (state.stage === 'anchor_timeframe' || state.stage.startsWith('ch_'))) {
    state.stage = 'roi_delivery';
    return;
  }

  const transitions: Partial<Record<Stage, Stage>> = {
    wow: 'anchor_acv',
    anchor_acv: 'anchor_timeframe',
    roi_delivery: 'close',
  };

  state.stage = transitions[state.stage] ?? state.currentQueue.shift() ?? 'roi_delivery';
}

// ─── Advance if gate is open ─────────────────────────────────────────────────

export function advanceIfGateOpen(state: CallBrainState): boolean {
  if (gateOpen(state)) {
    advance(state);
    return true;
  }
  return false;
}

// ─── Queue building from intel signals ───────────────────────────────────────

const AGENT_TO_CHANNEL: Record<string, ChannelStage> = {
  alex: 'ch_ads',
  chris: 'ch_website',
  maddie: 'ch_phone',
  sarah: 'ch_old_leads',
  james: 'ch_reviews',
};

export interface QueueResult {
  queue: Stage[];
  tease: ChannelStage | null;
}

export function buildQueue(
  flags: Record<string, unknown>,
  intel: Record<string, unknown>,
): QueueResult {
  const deep = (intel as any).intel?.deep ?? (intel as any).deep ?? {};
  const ts = (intel as any).tech_stack ?? {};
  const routing = (intel as any).consultant?.routing ?? {};

  // Signal detection
  const adsOrInbound = !!(
    (flags as any).is_running_ads || (flags as any).has_fb_pixel || (flags as any).has_google_ads
    || deep.ads?.is_running_google_ads
    || (deep.ads?.google_ads_count ?? 0) > 0 || (deep.ads?.fb_ads_count ?? 0) > 0
    || ts.is_running_ads || (intel as any).google_ads_running || (intel as any).facebook_ads_running
    || (ts.social_channels?.length > 0) || ts.has_email_marketing
  );

  const cea = (intel as any).consultant?.conversionEventAnalysis ?? {};
  const ctaType: string = cea.ctaType ?? '';
  const phoneDominantCta = ctaType === 'call' || ctaType === 'phone'
    || /\bcall\b/i.test(cea.primaryCTA ?? '');

  let queue: Stage[];
  let tease: ChannelStage | null;

  if (adsOrInbound) {
    queue = ['ch_website', 'ch_ads'];
    tease = 'ch_phone';
  } else {
    queue = ['ch_website'];
    if (phoneDominantCta) {
      queue.push('ch_phone');
      tease = 'ch_ads';
    } else {
      queue.push('ch_ads');
      tease = 'ch_phone';
    }
  }

  // Consultant swap: if top priority agent maps to slot 2, swap slots 1 & 2
  const topAgent = ((routing.priority_agents?.[0] ?? '') as string).toLowerCase();
  const topChannel = AGENT_TO_CHANNEL[topAgent];
  if (topChannel && queue.length >= 2 && topChannel === queue[1]) {
    [queue[0], queue[1]] = [queue[1], queue[0]];
  }

  return { queue, tease };
}

// ─── Rebuild future queue when late data arrives ─────────────────────────────

export function rebuildFutureQueue(
  state: CallBrainState,
  flags: Record<string, unknown>,
  intel: Record<string, unknown>,
): void {
  if (state.stage === 'roi_delivery' || state.stage === 'close') return;

  const { queue: newChannels } = buildQueue(flags, intel);
  const locked = new Set<string>([...state.completedStages, state.stage]);
  state.currentQueue = newChannels.filter(ch => !locked.has(ch)) as Stage[];
}
