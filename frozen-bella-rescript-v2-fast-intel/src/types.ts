// types.ts — shared types for fast-intel-sandbox

export interface Env {
  LEADS_KV:          KVNamespace;
  CONSULTANT:        Fetcher;            // service binding → consultant-sandbox-v9
  DEEP_SCRAPE:       Fetcher;            // service binding → deep-scrape-workflow-sandbox
  BIG_SCRAPER:       Fetcher;            // service binding → personalisedaidemofinal-sandbox
  CALL_BRAIN:        Fetcher;            // service binding → call-brain-do (Phase D)
  FIRECRAWL_API_KEY: string;
  SCRAPINGANT_KEY:   string;            // fallback scraper if Firecrawl times out
  GEMINI_API_KEY:    string;             // fallback if CONSULTANT unavailable
  GOOGLE_PLACES_API_KEY?: string;       // Google Places Text Search cross-ref (P2-T1)
}

export interface FastIntelResult {
  status:       "done" | "error";
  ts_done:      string;
  duration_ms:  number;
  source:       "firecrawl" | "stub";
  tech_stack:   Record<string, any>;  // pixel/HTML scan — populated by detectTechStack
  core_identity: {
    first_name:    string;
    business_name: string;
    domain:        string;
    website_url:   string;
    industry:      string;
    location:      string;
    phone:         string;
    tagline:       string;
    model:         string;
  };
  hero: {
    h1:              string;
    h2:              string;
    title:           string;
    meta_description: string;
    og_title:        string;
    og_description:  string;
    og_image:        string;
    tagline:         string;
  };
  page_content: {
    markdown:     string;
    services:     string[];
    ctas:         string[];
    key_benefits: string[];
    has_chat:     boolean;
    has_booking:  boolean;
    links:        string[];
  };
  consultant:       Record<string, any>;
  script_fills: {
    hero_header_quote:        string;
    website_positive_comment: string;
    icp_guess:                string;
    reference_offer:          string;
    campaign_summary:         string | null;
    rep_commentary:           string | null;
    recent_review_snippet:    string | null;
    rep_quality_assessment:   string | null;
    top_2_website_ctas:       string | null;
  };
  routing:           Record<string, any>;
  conversation_hooks: any[];
  most_impressive:    any[];
  red_flags:          any[];
  bella_opener:       string;
  flags: {
    is_running_ads:           boolean;
    speed_to_lead_needed:     boolean;
    call_handling_needed:     boolean;
    database_reactivation:    boolean;
    business_age_established: boolean;
    review_signals:           boolean;
  };
  firstName:  string;
  first_name: string;
}

export interface ConsultantPayload {
  businessName:    string;
  industry:        string;
  industryNiche:   string | null;
  location:        string;
  yearsInBusiness: number | null;
  targetAudience:  string;
  salesTerm:       string;
  businessModel:   string;
  description:     string;
  google:          Record<string, any>;
  competitors:     any[];
  reviews:         any[];
  facebookAds:     Record<string, any>;
  googleAds:       Record<string, any>;
  campaignAnalysis: any;
  techStack:       Record<string, any>;
  landingPage:     Record<string, any>;
  aiExtracted:     Record<string, any>;
  scraped:         Record<string, any>;
  branding:        Record<string, any>;
  websiteContent:  string;
  grades:          Record<string, any>;
}
