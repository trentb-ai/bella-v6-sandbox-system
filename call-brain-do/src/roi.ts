/**
 * call-brain-do/src/roi.ts — v2.0.0-do-alpha.1
 * ROI calculation engine. Ported from bridge lines ~566-684.
 */

import type { CallBrainState } from './types';

export interface AgentCalc {
  agent: string;
  weekly: number;
  precise: boolean;
  why: string;
}

// ─── Run all ROI calculations from extracted values ──────────────────────────

export function runCalcs(state: CallBrainState): AgentCalc[] {
  const e = state.extracted;
  if (!e.acv) return [];

  const wf = e.timeframe === 'monthly' ? 1 / 4.3 : 1;
  const out: AgentCalc[] = [];

  // Alex — ads speed-to-lead
  if (e.ads_leads !== null && e.ads_conversions !== null) {
    const tiers: Record<string, number> = { '>24h': 3.91, '3h_to_24h': 2.0, '30m_to_3h': 1.0, '<30m': 0.5 };
    const rate = tiers[e.ads_followup_speed ?? '>24h'] ?? 3.91;
    const weekly = Math.round(e.ads_conversions * wf * rate * e.acv / 52);
    out.push({
      agent: 'Alex', weekly, precise: true,
      why: `${e.ads_leads} ad leads, ${e.ads_conversions} conversions, ${(rate * 100).toFixed(0)}% uplift from speed-to-lead`,
    });
  }

  // Chris — website conversion uplift
  if (e.web_leads !== null && e.web_conversions !== null) {
    const extra = e.web_conversions * wf * 0.23;
    const weekly = Math.round(extra * e.acv / 52);
    out.push({
      agent: 'Chris', weekly, precise: true,
      why: `${e.web_leads} web enquiries, 23% conversion uplift`,
    });
  }

  // Maddie — missed calls
  if (e.phone_volume !== null && e.missed_call_handling !== null) {
    const has247 = ['24/7', '24-7', 'always', 'call centre', 'call center']
      .some(x => (e.missed_call_handling ?? '').toLowerCase().includes(x));
    if (!has247) {
      const missed = Math.round(e.phone_volume * 0.3);
      const rate = 0.3;
      const weekly = Math.round(missed * wf * rate * e.acv / 52);
      out.push({
        agent: 'Maddie', weekly, precise: false,
        why: `~${missed} missed calls, ${(rate * 100).toFixed(0)}% conversion`,
      });
    }
  }

  // Sarah — database reactivation
  if (e.old_leads !== null) {
    const weekly = Math.round(e.old_leads * 0.05 * e.acv / 52);
    out.push({
      agent: 'Sarah', weekly, precise: true,
      why: `${e.old_leads} dormant leads × 5% reactivation`,
    });
  }

  // James — reviews uplift
  if (e.has_review_system === false) {
    if (e.new_customers !== null) {
      const annualRevBase = e.new_customers * (e.timeframe === 'monthly' ? 12 : 52) * e.acv;
      const weekly = Math.round(annualRevBase * 0.09 / 52);
      out.push({
        agent: 'James', weekly, precise: true,
        why: `${e.new_customers} new ${e.timeframe === 'monthly' ? 'monthly' : 'weekly'} × $${e.acv.toLocaleString()} ACV → 9% revenue uplift`,
      });
    } else {
      out.push({
        agent: 'James', weekly: 0, precise: false,
        why: '9% revenue uplift from 1-star improvement (directional)',
      });
    }
  }

  return out.sort((a, b) => b.weekly - a.weekly);
}

// ─── Per-agent ROI ───────────────────────────────────────────────────────────

export function calcAgentROI(
  agent: 'Alex' | 'Chris' | 'Maddie' | 'Sarah' | 'James',
  state: CallBrainState,
): AgentCalc | null {
  const e = state.extracted;
  if (!e.acv) return null;
  const wf = e.timeframe === 'monthly' ? 1 / 4.3 : 1;

  switch (agent) {
    case 'Alex': {
      if (e.ads_leads == null || e.ads_conversions == null) return null;
      const tiers: Record<string, number> = { '>24h': 3.91, '3h_to_24h': 2.0, '30m_to_3h': 1.0, '<30m': 0.5 };
      const rate = tiers[e.ads_followup_speed ?? '>24h'] ?? 3.91;
      const weekly = Math.round(e.ads_conversions * wf * rate * e.acv / 52);
      return { agent: 'Alex', weekly, precise: true, why: `${e.ads_leads} ad leads → ${e.ads_conversions} close, ${(rate * 100).toFixed(0)}% uplift` };
    }
    case 'Chris': {
      if (e.web_leads == null || e.web_conversions == null) return null;
      const extra = e.web_conversions * wf * 0.23;
      const weekly = Math.round(extra * e.acv / 52);
      return { agent: 'Chris', weekly, precise: true, why: `${e.web_leads} web leads → 23% conversion uplift` };
    }
    case 'Maddie': {
      if (e.phone_volume == null || !e.missed_call_handling) return null;
      const has247 = ['24/7', '24-7', 'always', 'call centre', 'call center']
        .some(x => e.missed_call_handling!.toLowerCase().includes(x));
      if (has247) return null;
      const missed = Math.round(e.phone_volume * 0.3);
      const weekly = Math.round(missed * wf * 0.3 * e.acv / 52);
      return { agent: 'Maddie', weekly, precise: false, why: `~${missed} missed → 30% conversion` };
    }
    case 'Sarah': {
      if (e.old_leads == null) return null;
      const weekly = Math.round(e.old_leads * 0.05 * e.acv / 52);
      return { agent: 'Sarah', weekly, precise: true, why: `${e.old_leads} dormant leads × 5% reactivation` };
    }
    case 'James': {
      if (e.has_review_system === true) return null;
      if (e.new_customers != null) {
        const annualRevBase = e.new_customers * (e.timeframe === 'monthly' ? 12 : 52) * e.acv;
        const weekly = Math.round(annualRevBase * 0.09 / 52);
        return { agent: 'James', weekly, precise: true, why: `${e.new_customers} new → 9% revenue uplift` };
      }
      return { agent: 'James', weekly: 0, precise: false, why: '9% revenue uplift (need customer volume)' };
    }
  }
}

// ─── ROI readiness check ─────────────────────────────────────────────────────

export type RoiStatus = 'not_ready' | 'partial' | 'ready';

export function roiDeliveryCheck(state: CallBrainState): RoiStatus {
  const calcs = runCalcs(state);
  if (calcs.length === 0) return 'not_ready';
  if (calcs.length >= 2 && calcs.some(c => c.precise)) return 'ready';
  if (calcs.length >= 1) return 'partial';
  return 'not_ready';
}

// ─── Compute and store ROI in state ──────────────────────────────────────────

export function computeROI(state: CallBrainState): void {
  const calcs = runCalcs(state);
  if (calcs.length === 0) return;

  const agentValues: Record<string, number> = {};
  let total = 0;
  for (const c of calcs) {
    agentValues[c.agent] = c.weekly;
    total += c.weekly;
  }

  state.roi.agentValues = agentValues;
  state.roi.totalValue = total;
  state.flags.roiComputed = true;
}
