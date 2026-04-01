/**
 * CallBrief — The Single Source of Truth
 *
 * Written by: bella-scrape-workflow-v9 ONLY
 * Read by: deepgram-bridge-v9, bella-voice-agent-v9
 */

export interface CallBrief {
  // ── Schema & Identity ─────────────────────────────────────────────────────
  v: 1;
  lid: string;
  ts: string;
  status: "pending" | "phase_a" | "ready";

  // ── Lead Basics ───────────────────────────────────────────────────────────
  firstName: string;
  websiteUrl: string;
  email?: string;

  // ── Core Identity (from fast-intel extraction) ────────────────────────────
  business_name: string;
  industry: string;
  industry_key: string;
  tagline?: string;
  location?: string;
  phone?: string;
  business_hours?: string;
  model?: "B2B" | "B2C" | "Both";
  customer_term: string;
  timeframe: "weekly" | "monthly";

  // ── Flags (derived from tech_stack + deep analysis) ───────────────────────
  flags: CallBriefFlags;

  // ── Tech Stack Detail ─────────────────────────────────────────────────────
  tech_stack: TechStack;

  // ── Agent Routing ─────────────────────────────────────────────────────────
  agent_slots: AgentSlot[];        // Ordered slots with rank + descriptor + proof_point
  agent_ranking: string[];         // Legacy compat: ["Alex", "Chris", ...] extracted from agent_slots
  bella_opener: string;
  pitch_hook: string;

  // ── Apify Highlights (for Bella to quote directly) ────────────────────────
  apify_highlights?: ApifyHighlights;

  // ── Deep Intel (null until phase_b) ───────────────────────────────────────
  deep_intel?: DeepIntel;

  // ── Consultant Analysis (null until phase_b) ──────────────────────────────
  consultant?: ConsultantOutput;

  // ── 22 Stage Scripts (null until phase_b) ─────────────────────────────────
  stages?: StageScripts;

  // ── Flux Configs per Stage (for adaptive STT) ─────────────────────────────
  flux_configs?: Record<string, FluxConfig>;

  // ── Think Configs per Stage (for UpdateThink) ─────────────────────────────
  think_configs?: Record<string, ThinkConfig>;
}

export interface CallBriefFlags {
  // Tech gaps
  no_crm: boolean;
  no_chat: boolean;
  no_booking: boolean;

  // Advertising
  is_running_ads: boolean;
  is_retargeting: boolean;
  has_fb_pixel: boolean;
  has_google_ads: boolean;
  has_tiktok_ads: boolean;
  has_multi_platform_ads: boolean;

  // Agent routing signals
  speed_to_lead_needed: boolean;
  call_handling_needed: boolean;
  database_reactivation: boolean;
  review_signals: boolean;
  business_age_established: boolean;

  // ── Use Case Trigger Flags (V8 Supergod) ──────────────────────────────
  // Computed by calculateTriggers() — drive agent_ranking and stage activation
  trigger_alex: boolean;   // Ads running → speed to lead is critical
  trigger_chris: boolean;  // Ads + weak landing page → conversion rate problem
  trigger_maddie: boolean; // Missed calls risk (no chat/booking, or hiring receptionist)
  trigger_sarah: boolean;  // Old leads / database reactivation signal
  trigger_james: boolean;  // Review gap (low rating or low count)
}

export interface TechStack {
  has_crm: boolean;
  has_chat: boolean;
  has_booking: boolean;
  crm_name?: string;
  chat_tool?: string;
  booking_tool?: string;
  is_running_ads: boolean;
  is_retargeting?: boolean;
  ads_pixels: string[];
  social_channels: string[];
  flags_tech?: Record<string, boolean>;
}

export interface DeepIntel {
  googleMaps?: {
    rating: number | null;
    review_count: number;
    address?: string;
    recent_reviews: string[];
  };
  ads?: {
    fb: { running: boolean; count: number; ctas?: string[]; creatives_sample?: string[] };
    google: { running: boolean; count: number; headlines_sample?: string[] };
  };
  linkedin?: {
    employee_count: number | null;
    industry?: string;
    description_snippet?: string;
  };
  hiring?: {
    is_hiring: boolean;
    roles: string[];
    count: number;
  };
}

// Apify-sourced highlights that Bella can quote directly in conversation
export interface ApifyHighlights {
  // Specific ad campaigns Bella can name (e.g. "your Free Quote campaign on Facebook")
  ad_campaigns: string[];
  // Specific hiring role if detected (e.g. "receptionist", "sales rep")
  hiring_role: string | null;
  // Category of hiring role for trigger routing
  hiring_role_category: "receptionist" | "sales" | "marketing" | "other" | null;
  // Google Maps data for Bella to quote
  google_rating: number | null;
  google_review_count: number;
  // Most recent review snippet Bella can reference
  recent_review_snippet: string | null;
  // Social profile URLs (scraped from fast-intel, analysis in Phase 2)
  social_profiles: { platform: string; url: string }[];
}

// An agent slot in the ranking — includes the power descriptor for Bella's pitch
export interface AgentSlot {
  name: "Alex" | "Chris" | "Maddie" | "Sarah" | "James";
  rank: 1 | 2 | 3 | 4 | 5;
  // How this agent is presented: 1-2 get full crunch, 3 gets descriptor pitch only (unless prospect asks)
  presentation: "full_crunch" | "descriptor_only";
  // One-sentence power descriptor for Bella to say
  descriptor: string;
  // The specific trigger that activated this agent
  trigger: keyof CallBriefFlags | null;
  // Apify-sourced proof point to personalise pitch (e.g. "I can see you're running a Free Quote campaign")
  proof_point: string | null;
}

export interface ConsultantOutput {
  scriptFills: {
    website_positive_comment?: string;
    hero_header_quote?: string;
    reference_offer?: string;
    icp_guess?: string;
    campaign_summary?: string;
    rep_commentary?: string;
    recent_review_snippet?: string;
    rep_quality_assessment?: string;
    top_2_website_ctas?: string;
  };
  routing: {
    priority_agents: string[];
    skip_agents: string[];
    reasoning: Record<string, string>;
  };
  conversationHooks: Array<{ topic: string; how: string }>;
  landingPageVerdict?: {
    verdictLine: string;
    verdictLine2?: string;
    conversionBarriers?: string[];
  };
  websiteCompliments?: Array<{ finding: string; bellaLine: string; source?: string }>;
  redFlags?: string[];
  businessIdentity?: {
    correctedName?: string;
    industry?: string;
    serviceArea?: string;
    businessModel?: string;
  };
}

// A single stage in the 22-stage script
export interface Stage {
  id: number;
  key: string;
  agent: "Alex" | "Chris" | "Maddie" | "Sarah" | "James" | "Bella" | null;
  // Whether this stage runs for this lead (false = skipped silently)
  active: boolean;
  // The script Bella reads at this stage
  script: string;
  // What data point to capture at this stage (used by Bridge regex engine)
  capture?: string;
  // Advance to next stage when this phrase/intent is detected
  advance_on?: string;
}

export interface StageScripts {
  stages: Stage[];

  // ── Objection handlers (triggered from any stage) ──────────────────────
  objection_price: string;
  objection_timing: string;
  objection_not_interested: string;
  objection_competitor: string;
  objection_need_to_think: string;

  // ── Fallbacks ──────────────────────────────────────────────────────────
  fallback_no_data: string;
  fallback_confused: string;
  fallback_off_topic: string;

  // ── Edge cases ─────────────────────────────────────────────────────────
  warm_handoff: string;
  booking_cta: string;
  goodbye: string;
}
export interface FluxConfig {
  eot_timeout_ms: number;
  eot_threshold: number;
  keyterms: string[];
}

export interface ThinkConfig {
  model: string;
  temperature: number;
  prompt_template: string;
}

export interface ScrapeParams {
  lid: string;
  websiteUrl: string;
  firstName: string;
  email?: string;
}

export interface Env {
  LEADS_KV: KVNamespace;
  BIG_SCRAPER: Fetcher;
  CONSULTANT: Fetcher;
  SCRAPE_PIPELINE: Workflow;
  FIRECRAWL_API_KEY: string;
  GEMINI_API_KEY: string;
  APIFY_API_KEY: string;
  SCRAPINGANT_KEY?: string;
}

export interface FastIntelResult {
  status: string;
  ts_done: string;
  duration_ms: number;
  source: string;
  core_identity: {
    first_name: string;
    business_name: string;
    domain: string;
    website_url: string;
    industry: string;
    location: string;
    phone: string;
    tagline: string;
    model: string;
  };
  tech_stack: TechStack;
  hero: {
    h1: string;
    h2: string;
    title: string;
    meta_description: string;
    og_title: string;
    og_description: string;
    og_image: string;
    tagline: string;
  };
  page_content: {
    markdown: string;
    services: string[];
    ctas: string[];
    key_benefits: string[];
    has_chat: boolean;
    has_booking: boolean;
    links: string[];
  };
  consultant: ConsultantOutput | Record<string, never>;
  script_fills: Record<string, string | null>;
  routing: {
    priority_agents: string[];
    skip_agents: string[];
    reasoning: Record<string, string>;
  };
  conversation_hooks: Array<{ topic: string; how: string }>;
  most_impressive: string[];
  red_flags: string[];
  bella_opener: string;
  flags: CallBriefFlags;
  firstName: string;
  first_name: string;
}
