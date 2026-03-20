/**
 * call-brain-do/src/intel.ts — v2.0.0-do-alpha.1
 * Intel merging and IndustryLanguagePack resolution.
 */

import type { CallBrainState, BrainEvent, IndustryLanguagePack } from './types';
import { buildQueue, rebuildFutureQueue } from './gate';

// ─── Deep merge utility ─────────────────────────────────────────────────────

function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source ?? target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return source;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (srcVal !== null && srcVal !== undefined) {
      if (
        srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
        tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
      ) {
        result[key] = deepMerge(tgtVal, srcVal);
      } else {
        result[key] = srcVal;
      }
    }
  }
  return result;
}

// ─── Merge intel event into state ────────────────────────────────────────────

export function mergeIntel(
  state: CallBrainState,
  event: Extract<BrainEvent, { type: 'fast_intel_ready' | 'consultant_ready' | 'deep_ready' }>,
): void {
  const { type, payload } = event;

  switch (type) {
    case 'fast_intel_ready':
      state.intel.fast = deepMerge(state.intel.fast ?? {}, payload);
      break;
    case 'consultant_ready':
      state.intel.consultant = deepMerge(state.intel.consultant ?? {}, payload);
      break;
    case 'deep_ready':
      state.intel.deep = deepMerge(state.intel.deep ?? {}, payload);
      state.flags.apifyDone = true;
      break;
  }

  state.intel.mergedVersion++;

  // Rebuild IndustryLanguagePack from latest intel
  const allIntel = {
    ...(state.intel.fast as any ?? {}),
    consultant: state.intel.consultant,
    deep: state.intel.deep,
  };
  state.intel.industryLanguage = buildIndustryLanguagePack(allIntel);

  // Rebuild future queue from latest signals
  const flags = (state.intel.fast as any)?.flags ?? {};
  rebuildFutureQueue(state, flags, allIntel);
}

// ─── Build initial queue from intel ──────────────────────────────────────────

export function initQueueFromIntel(state: CallBrainState): void {
  const allIntel = {
    ...(state.intel.fast as any ?? {}),
    consultant: state.intel.consultant,
    deep: state.intel.deep,
  };
  const flags = (state.intel.fast as any)?.flags ?? {};
  const { queue } = buildQueue(flags, allIntel);
  state.currentQueue = queue;
}

// ─── IndustryLanguagePack resolution ─────────────────────────────────────────

const INDUSTRY_PACKS: Record<string, IndustryLanguagePack> = {
  legal: {
    industryLabel: 'legal',
    singularOutcome: 'client',
    pluralOutcome: 'clients',
    leadNoun: 'enquiry',
    conversionVerb: 'retain',
    revenueEvent: 'retained matter',
    kpiLabel: 'client value',
    missedOpportunity: 'missed consult',
    tone: 'formal',
    examples: ['retained matter', 'initial consult', 'matter value'],
  },
  dental: {
    industryLabel: 'dental',
    singularOutcome: 'patient',
    pluralOutcome: 'patients',
    leadNoun: 'booking request',
    conversionVerb: 'book',
    revenueEvent: 'booked appointment',
    kpiLabel: 'patient value',
    missedOpportunity: 'missed booking',
    tone: 'friendly',
    examples: ['new patient', 'appointment booking', 'treatment plan'],
  },
  medical: {
    industryLabel: 'medical',
    singularOutcome: 'patient',
    pluralOutcome: 'patients',
    leadNoun: 'appointment request',
    conversionVerb: 'book',
    revenueEvent: 'booked consult',
    kpiLabel: 'patient value',
    missedOpportunity: 'missed appointment',
    tone: 'formal',
    examples: ['new patient', 'consult booking', 'referral'],
  },
  trades: {
    industryLabel: 'trades',
    singularOutcome: 'job',
    pluralOutcome: 'jobs',
    leadNoun: 'quote request',
    conversionVerb: 'win',
    revenueEvent: 'paid job',
    kpiLabel: 'job value',
    missedOpportunity: 'missed quote',
    tone: 'practical',
    examples: ['new job', 'quote request', 'callout'],
  },
  'real estate': {
    industryLabel: 'real estate',
    singularOutcome: 'listing',
    pluralOutcome: 'listings',
    leadNoun: 'appraisal request',
    conversionVerb: 'win',
    revenueEvent: 'signed listing',
    kpiLabel: 'commission value',
    missedOpportunity: 'missed appraisal',
    tone: 'strategic',
    examples: ['new listing', 'appraisal', 'vendor lead'],
  },
  accounting: {
    industryLabel: 'accounting',
    singularOutcome: 'client',
    pluralOutcome: 'clients',
    leadNoun: 'enquiry',
    conversionVerb: 'sign',
    revenueEvent: 'signed engagement',
    kpiLabel: 'client value',
    missedOpportunity: 'missed consultation',
    tone: 'formal',
    examples: ['new client', 'tax return', 'advisory engagement'],
  },
  agency: {
    industryLabel: 'agency',
    singularOutcome: 'client',
    pluralOutcome: 'clients',
    leadNoun: 'lead',
    conversionVerb: 'sign',
    revenueEvent: 'signed retainer',
    kpiLabel: 'retainer value',
    missedOpportunity: 'missed pitch',
    tone: 'strategic',
    examples: ['new retainer', 'campaign launch', 'client onboarding'],
  },
  fitness: {
    industryLabel: 'fitness',
    singularOutcome: 'member',
    pluralOutcome: 'members',
    leadNoun: 'trial request',
    conversionVerb: 'sign up',
    revenueEvent: 'new membership',
    kpiLabel: 'member value',
    missedOpportunity: 'missed trial',
    tone: 'friendly',
    examples: ['new member', 'free trial', 'PT session'],
  },
  hospitality: {
    industryLabel: 'hospitality',
    singularOutcome: 'booking',
    pluralOutcome: 'bookings',
    leadNoun: 'reservation request',
    conversionVerb: 'book',
    revenueEvent: 'confirmed booking',
    kpiLabel: 'booking value',
    missedOpportunity: 'missed reservation',
    tone: 'friendly',
    examples: ['table booking', 'event enquiry', 'function booking'],
  },
  insurance: {
    industryLabel: 'insurance',
    singularOutcome: 'policy',
    pluralOutcome: 'policies',
    leadNoun: 'quote request',
    conversionVerb: 'bind',
    revenueEvent: 'bound policy',
    kpiLabel: 'premium value',
    missedOpportunity: 'missed quote',
    tone: 'formal',
    examples: ['new policy', 'renewal', 'quote comparison'],
  },
};

const GENERIC_PACK: IndustryLanguagePack = {
  industryLabel: 'business',
  singularOutcome: 'client',
  pluralOutcome: 'clients',
  leadNoun: 'lead',
  conversionVerb: 'convert',
  revenueEvent: 'new client',
  kpiLabel: 'client value',
  missedOpportunity: 'missed opportunity',
  tone: 'practical',
  examples: ['new client', 'enquiry', 'conversion'],
};

// Keyword → industry mapping for fuzzy resolution
const KEYWORD_MAP: Record<string, string> = {
  law: 'legal', lawyer: 'legal', solicitor: 'legal', barrister: 'legal', attorney: 'legal',
  dentist: 'dental', orthodont: 'dental',
  doctor: 'medical', gp: 'medical', clinic: 'medical', physio: 'medical', chiro: 'medical', health: 'medical',
  plumb: 'trades', electric: 'trades', build: 'trades', construct: 'trades', hvac: 'trades', roof: 'trades', landscap: 'trades',
  'real estate': 'real estate', property: 'real estate', realestate: 'real estate',
  account: 'accounting', tax: 'accounting', bookkeep: 'accounting', cpa: 'accounting',
  agency: 'agency', market: 'agency', digital: 'agency', seo: 'agency', ppc: 'agency',
  gym: 'fitness', fitness: 'fitness', 'personal train': 'fitness', yoga: 'fitness', pilates: 'fitness',
  restaurant: 'hospitality', cafe: 'hospitality', hotel: 'hospitality', bar: 'hospitality', catering: 'hospitality',
  insurance: 'insurance', broker: 'insurance', underwrite: 'insurance',
  consult: 'agency', advisory: 'accounting', financial: 'accounting',
};

export function buildIndustryLanguagePack(intel: Record<string, unknown>): IndustryLanguagePack {
  // Priority 1: explicit consultant industry
  const consultant = intel.consultant as any;
  const bi = consultant?.businessIdentity ?? {};
  const explicitIndustry = (bi.industry ?? '').toLowerCase().trim();

  if (explicitIndustry && INDUSTRY_PACKS[explicitIndustry]) {
    return INDUSTRY_PACKS[explicitIndustry];
  }

  // Priority 2: keyword match from industry string
  if (explicitIndustry) {
    for (const [keyword, industry] of Object.entries(KEYWORD_MAP)) {
      if (explicitIndustry.includes(keyword)) {
        const pack = INDUSTRY_PACKS[industry];
        if (pack) return { ...pack, industryLabel: explicitIndustry };
      }
    }
  }

  // Priority 3: keyword match from core_identity
  const coreIndustry = ((intel as any).core_identity?.industry ?? '').toLowerCase();
  if (coreIndustry) {
    for (const [keyword, industry] of Object.entries(KEYWORD_MAP)) {
      if (coreIndustry.includes(keyword)) {
        const pack = INDUSTRY_PACKS[industry];
        if (pack) return { ...pack, industryLabel: coreIndustry };
      }
    }
  }

  // Priority 4: generic fallback
  return { ...GENERIC_PACK, industryLabel: explicitIndustry || coreIndustry || 'business' };
}
