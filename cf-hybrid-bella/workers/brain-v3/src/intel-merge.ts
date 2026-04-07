/**
 * brain-v3/src/intel-merge.ts — Intel merge laws
 * Chunk 8 — Data Relay + Late Intel
 *
 * Merge laws (non-negotiable):
 * 1. Prospect-stated data wins — never overwrite hotMemory prospect facts
 * 2. consultant:false placeholder is BLOCKED — typeof gate required
 * 3. Template contamination → reject entire payload
 * 4. Deep scrape may arrive mid-call — merge immediately, no restart
 * 5. consultantReady = false until valid consultant payload received
 */

import type { ConversationState } from './types';
import type { IntelReadyEvent } from '@bella/contracts';

const TEMPLATE_CONTAMINATION_RE = /\{\{[^}]+\}\}|\[PLACEHOLDER\]|\[INSERT\]/i;

export function isContaminated(obj: unknown): boolean {
  if (typeof obj === 'string') return TEMPLATE_CONTAMINATION_RE.test(obj);
  if (Array.isArray(obj)) return obj.some(isContaminated);
  if (obj && typeof obj === 'object') return Object.values(obj as Record<string, unknown>).some(isContaminated);
  return false;
}

export function mergeIntelEvent(state: ConversationState, payload: IntelReadyEvent): number {
  if (isContaminated(payload)) {
    console.log(`[INTEL_MERGE] REJECTED fast-intel — template contamination lid=${payload.lid}`);
    return 0;
  }
  let merged = 0;
  if (payload.core_identity) {
    if (payload.core_identity.business_name && (state.businessName === 'your business' || !state.businessName)) {
      state.businessName = payload.core_identity.business_name;
      merged++;
    }
    state.fastIntelData = { ...state.fastIntelData, core_identity: payload.core_identity };
    merged++;
  }
  if (payload.flags) {
    state.intelFlags = { ...state.intelFlags, ...payload.flags };
    merged++;
  }
  if (payload.tech_stack) {
    state.fastIntelData = { ...state.fastIntelData, tech_stack: payload.tech_stack };
    merged++;
  }
  if (payload.consultant !== undefined) {
    merged += mergeConsultant(state, payload.consultant);
  }
  console.log(`[INTEL_MERGE] fast-intel merged=${merged} lid=${payload.lid}`);
  return merged;
}

export function mergeConsultant(state: ConversationState, payload: unknown): number {
  if (payload === false || payload === null || typeof payload !== 'object') {
    console.log(`[INTEL_MERGE] BLOCKED consultant — invalid type`);
    return 0;
  }
  if (isContaminated(payload)) {
    console.log(`[INTEL_MERGE] REJECTED consultant — template contamination`);
    return 0;
  }
  const c = payload as Record<string, unknown>;
  let merged = 0;
  if (c.businessIdentity) {
    state.consultantData = { ...state.consultantData, businessIdentity: c.businessIdentity };
    merged++;
  }
  if (c.scriptFills) {
    state.scriptFills = { ...state.scriptFills, ...(c.scriptFills as Record<string, string | null>) };
    merged++;
  }
  if (c.routing) {
    state.consultantData = { ...state.consultantData, routing: c.routing };
    merged++;
  }
  if (c.conversationHooks) {
    state.consultantData = { ...state.consultantData, conversationHooks: c.conversationHooks };
    merged++;
  }
  state.consultantReady = true;
  console.log(`[INTEL_MERGE] consultant merged=${merged} consultantReady=true`);
  return merged;
}

export function mergeDeepScrape(state: ConversationState, deep: Record<string, unknown>): number {
  if (isContaminated(deep)) {
    console.log(`[INTEL_MERGE] REJECTED deep-scrape — template contamination`);
    return 0;
  }
  let merged = 0;
  if (deep.googleMaps) {
    state.deepIntel = { ...state.deepIntel, googlePresence: deep.googleMaps as Record<string, unknown>[] };
    merged++;
  }
  if (deep.ads) {
    state.deepIntel = { ...state.deepIntel, ads: deep.ads };
    merged++;
  }
  if (deep.hiring) {
    state.deepIntel = { ...state.deepIntel, hiringMatches: deep.hiring as string[] };
    merged++;
  }
  if ((deep.googleMaps as Record<string, unknown> | undefined)?.rating != null) {
    state.intelFlags = { ...state.intelFlags, review_signals: true };
  }
  console.log(`[INTEL_MERGE] deep-scrape merged=${merged}`);
  return merged;
}
