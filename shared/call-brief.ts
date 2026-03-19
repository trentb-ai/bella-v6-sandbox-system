// CallBriefV1 — Typed schema for lead:{lid}:call_brief KV value
// This is the target shape for the unified intel blob that bridge reads.
// The bridge currently reads this via loadCallBrief() and treats it as the intel object.
// NO runtime code uses this yet — type definition only (Phase 3 migration target).

export interface CallBriefV1 {
  schemaVersion: 1;
  status: "starter" | "fast" | "full" | "deep" | "done";
  readiness: CallBriefReadiness;

  // ── Identity ──
  lid: string;
  v: number;
  ts: string;                         // ISO timestamp
  first_name: string;
  firstName: string;                   // compat alias
  business_name: string;
  websiteUrl: string;
  bella_opener: string;

  // ── Core Identity ──
  core_identity: CoreIdentity;

  // ── Flags (derived from tech_stack) ──
  flags: IntelFlags;

  // ── Tech Stack ──
  tech_stack: TechStack;

  // ── Consultant Output ──
  consultant: ConsultantOutput;

  // ── Deep Scrape Data ──
  deep: DeepData;

  // ── Hero (raw fallback when scriptFills empty) ──
  hero: HeroData;

  // ── Fast Context (slim bridge payload) ──
  fast_context: FastContext;

  // ── Synthesised Fields (bridge computes if missing) ──
  top_fix?: TopFix;
  pitch_hook?: string;
  close_strategies?: string[];
  recent_reviews?: ReviewSample[];
  hiring_agent_matches?: HiringAgentMatch[];

  // ── Legacy Compat (bridge checks these as fallbacks) ──
  google_ads_running?: boolean;
  facebook_ads_running?: boolean;
  star_rating?: number | null;
  review_count?: number | null;
  full_scrape?: { status: string };
  site_content_blob?: string;
  scrapeStatus?: "phase_a" | "phase_b" | "done";
  phase_a_ts?: string;

  // ── Backward Compat (old schema nesting) ──
  intel?: {
    grade?: string;
    bella_opener?: string;
    deep?: DeepData;
    phaseA?: { marketing_intelligence?: ConsultantOutput };
  };
  fast_intel?: FastIntelPayload;
}

// ── Readiness Flags ──

export interface CallBriefReadiness {
  hasFastConsultant: boolean;
  hasFullConsultant: boolean;
  hasDeepFlags: boolean;
  hasPlaces: boolean;
}

// ── Core Identity ──

export interface CoreIdentity {
  business_name: string;
  first_name: string;
  industry: string;
  industry_key?: string;
  location: string;
  tagline?: string;
  model?: string;
  phone?: string;
  business_hours?: string;
  domain?: string;
  website_url?: string;
}

// ── Intel Flags ──

export interface IntelFlags {
  is_running_ads: boolean;
  is_retargeting?: boolean;
  has_fb_pixel: boolean;
  has_google_ads: boolean;
  has_tiktok_ads?: boolean;
  has_multi_platform_ads?: boolean;
  speed_to_lead_needed?: boolean;
  call_handling_needed?: boolean;
  no_crm?: boolean;
  no_chat?: boolean;
  no_booking_tool?: boolean;
  database_reactivation?: boolean;
  business_age_established?: boolean;
  review_signals?: boolean;
}

// ── Tech Stack ──

export interface TechStack {
  is_running_ads: boolean;
  ads_pixels: string[];
  social_channels: string[];
  has_crm?: boolean;
  crm_name?: string;
  has_chat?: boolean;
  chat_tool?: string;
  is_non_ai_chat?: boolean;
  chat_likely_basic?: boolean;
  has_booking?: boolean;
  booking_tool?: string;
  has_email_marketing?: boolean;
  email_tool?: string;
  payment_tool?: string;
  ecommerce_platform?: string;
  site_platform?: string;
}

// ── Consultant Output ──

export interface ConsultantOutput {
  scriptFills: ScriptFills;
  routing: ConsultantRouting;
  copyAnalysis?: { bellaLine?: string };
  valuePropAnalysis?: { bellaLine?: string };
  icpAnalysis?: IcpAnalysis;
  conversionEventAnalysis?: ConversionEventAnalysis;
  hiringAnalysis?: { topHiringWedge?: string };
  conversationHooks?: ConversationHook[];
  mostImpressive?: MostImpressive[];
  websiteCompliments?: Array<{ bellaLine?: string }>;
}

export interface ScriptFills {
  hero_header_quote: string;
  website_positive_comment: string;
  icp_guess: string;
  top_2_website_ctas: string;
  reference_offer: string;
  recent_review_snippet?: string;
}

export interface ConsultantRouting {
  priority_agents: string[];
  skip_agents?: string[];
  reasoning?: string;
}

export interface IcpAnalysis {
  whoTheyTarget?: string;
  icpProblems?: string[];
  icpSolutions?: string[];
}

export interface ConversionEventAnalysis {
  ctaType?: string;
  primaryCTA?: string;
  agentTrainingLine?: string;
  allConversionEvents?: string[];
  ctaBreakdown?: CtaBreakdownEntry[];
  ctaAgentMapping?: string;
  conversionNarrative?: string;
}

export interface CtaBreakdownEntry {
  cta: string;
  type: string;
  agent: string;
  reason: string;
}

export interface ConversationHook {
  how?: string;
  topic?: string;
}

export interface MostImpressive {
  finding?: string;
  bellaLine?: string;
  source?: string;
}

// ── Deep Scrape Data ──

export interface DeepData {
  status: "processing" | "done";
  googleMaps?: GoogleMapsData;
  ads?: DeepAdsData;
  hiring?: HiringData;
  linkedin?: Record<string, unknown>;
}

export interface GoogleMapsData {
  rating?: number;
  review_count?: number;
  recent_reviews?: ReviewSample[];
  reviews_sample?: ReviewSample[];
}

export interface ReviewSample {
  name?: string;
  stars?: number;
  text?: string;
}

export interface DeepAdsData {
  is_running_google_ads?: boolean;
  google_ads_count?: number;
  fb_ads_count?: number;
  google_search_count?: number;
  fb_ads_sample?: Array<Record<string, unknown>>;
  google_ads_sample?: Array<Record<string, unknown>>;
  ad_landing_pages?: Array<Record<string, unknown>>;
}

export interface HiringData {
  is_hiring?: boolean;
  hiring_agent_matches?: HiringAgentMatch[];
  indeed_count?: number;
  seek_count?: number;
  top_hiring_wedge?: string;
}

export interface HiringAgentMatch {
  role: string;
  title: string;
  agents: string[];
  wedge: string;
}

// ── Hero (Raw Fallback) ──

export interface HeroData {
  h1?: string;
  h2?: string;
  title?: string;
  meta_description?: string;
  og_title?: string;
  og_description?: string;
  og_image?: string;
  tagline?: string;
}

// ── Fast Context ──

export interface FastContext {
  v?: number;
  lid?: string;
  ts?: string;
  business?: { name?: string; domain?: string; location?: string; rating?: number; review_count?: number };
  hero?: HeroData;
  person?: { first_name?: string; source?: string };
  ads?: { is_running_ads?: boolean; pixels?: string[]; estimated_monthly_spend_aud?: number };
  flags?: IntelFlags;
}

// ── Top Fix (Synthesised) ──

export interface TopFix {
  copyHeadline: string;
  copyBody: string;
}

// ── Fast Intel Payload (nested under fast_intel key) ──

export interface FastIntelPayload {
  status?: string;
  ts_done?: string;
  duration_ms?: number;
  source?: string;
  tech_stack?: TechStack;
  page_content?: {
    markdown: string;
    services?: string[];
    ctas?: string[];
    key_benefits?: string[];
    has_chat?: boolean;
    has_booking?: boolean;
    links?: string[];
  };
  core_identity?: CoreIdentity;
  hero?: HeroData;
  script_fills?: ScriptFills;
  consultant?: Record<string, unknown>;
  routing?: ConsultantRouting;
  conversation_hooks?: unknown[];
  most_impressive?: unknown[];
  red_flags?: unknown[];
  bella_opener?: string;
  flags?: IntelFlags;
}
